import { createDutchAbbrevDayParser, extractTime, createIdBuilder } from '../lib/normalize.js';
import { normalizeGenreFromList, isBekendGenre } from '../lib/genre.js';
import { pasTitelConventieToe, isWervend } from '../lib/titels.js';
import { vervallenStatus } from '../lib/beschikbaarheid.js';
import { blokkeerZwareBronnen } from '../lib/zwareBronnen.js';
import { gaNaar } from '../lib/diagnose.js';

const AGENDA_PATH = '/programma';
const MAX_PAGINAS = 30;

// Podiumpas bij De Nieuwe Vorst (bron: https://denieuwevorst.nl/bezoekinfo/
// ticketinfo, 6 okt 2026): "De Podiumpas is geldig bij De Nieuwe Vorst" voor
// reguliere voorstellingen; geen uitsluitingen genoemd. De agenda geeft geen
// prijs, dus ook geen uitzondering voor gratis voorstellingen.

// Geen voorstelling (akkoord 6 okt 2026, open vraag 6): debat/lezing,
// workshops, masterclasses, schrijf- en leesgroepen, makerssessies en de
// lancering van het seizoenszine.
const GEEN_VOORSTELLING_GENRE = /lezing|debat/i;
const GEEN_VOORSTELLING_TEKST = /\b(workshops?|masterclass(es)?|shut up and write|leesgroep|makerssessies?|seizoenszine)\b/i;

// Draait in de browser.
function leesNieuweVorst() {
  const tekst = (el) => el?.textContent.replace(/\s+/g, ' ').trim() || null;
  return {
    volgende: document.querySelector('ul.pagination li.next a')?.getAttribute('href') ?? null,
    items: [...document.querySelectorAll('a.event_item')].map((a) => {
      const spans = [...a.querySelectorAll('.date span')].map((s) => tekst(s));
      return {
        href: a.getAttribute('href'),
        titel: tekst(a.querySelector('h3.title')),
        datumTekst: spans[0] ?? null,
        tijdTekst: spans[1] ?? null,
        maker: tekst(a.querySelector('.subtitel')),
        genres: (tekst(a.querySelector('.genre')) ?? '').split(',').map((g) => g.trim()).filter(Boolean),
        labels: [...a.querySelectorAll('.label')].map((l) => tekst(l)).filter(Boolean),
      };
    }),
  };
}

/**
 * Theater De Nieuwe Vorst (Tilburg).
 *
 * Structuur (geïnspecteerd op https://denieuwevorst.nl/programma, 6 okt
 * 2026): Craft CMS, 9 speeldata per pagina (op pagina 1 nog 2 uitgelichte,
 * die verderop terugkomen), ~11 pagina's via /programma/p2, /p3, … (we
 * volgen de link "Volgende"). Per speeldatum (a.event_item): titel, "za 31
 * okt" en tijd (zonder jaar), maker, genres en labels (Première, Dansdagen
 * Tilburg). Geen prijs en geen status: beschikbaarheid "onbekend", tenzij
 * een label het zegt. Geen detailpagina's. ~12 verzoeken per run.
 *
 * Titels: titel = voorstelling, ondertitel = maker ("Mystiek lichaam" /
 * "Toneelschuur producties"); bij cabaret "Voorstelling – Maker".
 */
export async function scrapeDeNieuweVorst({ page, theater, robots, waitForTurn, log, warn = log }) {
  if (!robots.isAllowed(AGENDA_PATH)) {
    log(`robots.txt verbiedt ${AGENDA_PATH} op ${theater.baseUrl} — sla over.`);
    return [];
  }
  const zwaar = await blokkeerZwareBronnen(page, { ookScripts: true, ookOverig: true });
  const items = [];
  const gezien = new Set();
  let url = theater.agendaUrl;
  let paginas = 0;
  while (url && paginas < MAX_PAGINAS) {
    const pad = new URL(url, theater.baseUrl).pathname;
    if (!robots.isAllowed(pad)) {
      log(`robots.txt verbiedt ${pad} — stop met pagineren.`);
      break;
    }
    await waitForTurn();
    paginas++;
    try {
      await gaNaar(page, new URL(url, theater.baseUrl).toString(), { timeout: 45000 });
    } catch (err) {
      if (paginas === 1) throw err;
      log(`kon pagina ${paginas} niet laden: ${err.message} — stop.`);
      break;
    }
    const { items: deze, volgende } = await page.evaluate(leesNieuweVorst);
    // Sanity check: pagina 1 van een geldige agenda heeft speeldata.
    if (paginas === 1 && deze.length === 0) throw new Error(`geen voorstellingen (a.event_item) op ${page.url()} — site veranderd of geblokkeerd?`);
    const nieuw = deze.filter((it) => {
      const k = `${it.href}|${it.datumTekst}|${it.tijdTekst}`;
      if (gezien.has(k)) return false;
      gezien.add(k);
      return true;
    });
    log(`pagina ${paginas}: ${deze.length} speeldata (${nieuw.length} nieuw)`);
    items.push(...nieuw);
    if (nieuw.length === 0) break;
    url = volgende;
  }
  if (paginas >= MAX_PAGINAS && url) warn(`bovengrens van ${MAX_PAGINAS} pagina's bereikt — paginering waarschijnlijk stuk.`);

  const parseDay = createDutchAbbrevDayParser();
  const buildId = createIdBuilder();
  const opgehaaldOp = new Date().toISOString();
  const shows = [];
  const weg = {};
  const onbekend = {};
  for (const it of items) {
    if (!it.titel || !it.datumTekst) continue;
    const datum = parseDay(it.datumTekst); // ook voor de jaar-rollover (weekdag beslist)
    if (it.genres.some((g) => GEEN_VOORSTELLING_GENRE.test(g)) || GEEN_VOORSTELLING_TEKST.test(`${it.titel} ${it.maker ?? ''}`)) {
      weg[it.titel] = (weg[it.titel] ?? 0) + 1;
      continue;
    }
    if (!datum) {
      log(`kon datum niet lezen: "${it.datumTekst}" (${it.titel}) — overgeslagen.`);
      continue;
    }
    for (const g of it.genres) if (!isBekendGenre(g)) onbekend[g] = (onbekend[g] ?? 0) + 1;
    const labelStatus = it.labels.map((l) => vervallenStatus(l) ?? (/uitverkocht/i.test(l) ? 'uitverkocht' : /wachtlijst/i.test(l) ? 'wachtlijst' : null)).find(Boolean);
    const tijd = extractTime(it.tijdTekst);
    const makerOk = it.maker && !isWervend(it.maker);
    const show = {
      id: buildId(theater.id, it.titel, datum, tijd),
      titel: it.titel,
      theaterId: theater.id,
      theaterNaam: theater.naam,
      stad: theater.stad,
      podiumpas: theater.podiumpas,
      datum,
      tijd,
      genre: normalizeGenreFromList(it.genres) ?? (it.genres.length ? 'Overig' : null),
      genreRuw: it.genres.join(', ') || null,
      beschikbaarheid: labelStatus ?? 'onbekend',
      beschrijving: makerOk ? null : it.maker,
      maker: makerOk ? it.maker : null,
      prijs: null,
      reserverenUrl: new URL(it.href, theater.baseUrl).toString(),
      bron: new URL(it.href, theater.baseUrl).toString(),
      opgehaaldOp,
    };
    shows.push(pasTitelConventieToe(show, { artiest: it.maker, voorstelling: it.titel, makerWordtLeeg: true }));
  }
  const lijst = (o) => Object.entries(o).map(([k, n]) => `${k} (${n})`).join(', ');
  if (Object.keys(weg).length) log(`weggelaten (geen voorstelling): ${lijst(weg)}`);
  if (Object.keys(onbekend).length) warn(`onbekende brongenres (nu Overig): ${lijst(onbekend)}`);
  log(`${zwaar.verzoeken()} verzoek(en) naar de site (plus robots.txt); ${zwaar.geblokkeerd()} afbeeldingen/scripts/fonts niet geladen`);
  return shows;
}
