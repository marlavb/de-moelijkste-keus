import { createDutchAbbrevDayParser, extractTime, createIdBuilder } from '../lib/normalize.js';
import { normalizeGenreVoor, isBekendGenre } from '../lib/genre.js';
import { titelUitKopEnOndertitel, pasTitelConventieToe } from '../lib/titels.js';
import { vervallenStatus } from '../lib/beschikbaarheid.js';
import { laagstePrijs } from '../lib/peppered.js';
import { blokkeerZwareBronnen } from '../lib/zwareBronnen.js';
import { gaNaar } from '../lib/diagnose.js';

const AGENDA_PATH = '/agenda';
const MAX_DETAILS = 60;

// Kop/ondertitel: bij cabaret, special en komedie staat de artiest bovenaan
// ("Kor Hoebe" / "KORDAAT"); bij muziek en show is de ondertitel bijna altijd
// een tagline ("BEACH BOYS' BEST" / "Greatest Hits from the Kings of
// Harmony"), die gaat naar de beschrijving; anders de voorstelling bovenaan
// ("Carmen" / "Opera Compact").
const MAKER_EERST = /^(cabaret|special|komedie)$/i;
const TAGLINE_ONDER = /^(muziek|show)$/i;

/** Label of knopclass → beschikbaarheid. */
export function oranjerieStatus(label, knop) {
  const t = `${label ?? ''} ${knop ?? ''}`.toLowerCase();
  const vervallen = vervallenStatus(label) ?? (/geannuleerd/.test(knop ?? '') ? 'afgelast' : null);
  if (vervallen) return vervallen;
  if (/uitverkocht/.test(t)) return 'uitverkocht';
  if (/wachtlijst/.test(t)) return 'wachtlijst';
  if (/beschikbaar|laatste/.test(t)) return 'beschikbaar';
  return 'onbekend';
}

// Draait in de browser.
function leesAgenda() {
  const tekst = (el) => el?.textContent.replace(/\s+/g, ' ').trim() || null;
  return [...document.querySelectorAll('.event-col')].map((col) => ({
    href: col.querySelector('a.event-image')?.getAttribute('href') ?? null,
    datum: tekst(col.querySelector('.event-date .date')),
    kop: tekst(col.querySelector('.event-title')),
    ondertitel: tekst(col.querySelector('.subtitle')),
    genre: tekst(col.querySelector('.event-genre')) ?? tekst(col.querySelector('.overlay-genre')),
    labels: [...col.querySelectorAll('.overlay-label')].map((l) => tekst(l)).filter(Boolean),
    knop: [...(col.querySelector('.btn.d-block')?.classList ?? [])].find((c) => /^btn-(?!black|inactive)/.test(c) && c !== 'btn') ?? null,
    prijs: tekst(col.querySelector('.event-price')),
  }));
}

// Draait in de browser: alle speeldata op een productiepagina.
function leesDetail() {
  const tekst = (el) => el?.textContent.replace(/\s+/g, ' ').trim() || null;
  return [...document.querySelectorAll('.event-sticky-menu .event-date li')].map((li) => ({
    datum: tekst(li.querySelector('.left-side')),
    knop: [...(li.querySelector('a.event-tickets, .event-tickets')?.classList ?? [])].find((c) => /^btn-/.test(c) && !/^btn-(primary)$/.test(c)) ?? null,
    knopTekst: tekst(li.querySelector('.event-tickets')),
  }));
}

/**
 * Theater De Oranjerie (Roermond), van Van der Valk Theaterhotel De
 * Oranjerie; de agenda staat op theaterroermond.nl.
 *
 * Structuur (geïnspecteerd 6 okt 2026, inventarisatie §2.4): Laravel/Livewire,
 * alle ~107 producties op /agenda (één kaart per productie): "Za 14 nov om
 * 20:00" (geen jaar), genre, prijs "vanaf", labels (Wachtlijst, Laatste
 * kaarten, Geannuleerd, Verhuring, Op locatie, …) en een knop met
 * statusclass. Bij "+ Meer data" halen we de productiepagina op (~19), met
 * alle speeldata en per datum een knop. ~20 verzoeken per run. robots.txt
 * staat alles toe.
 */
export async function scrapeOranjerie({ page, theater, robots, waitForTurn, log, warn = log }) {
  if (!robots.isAllowed(AGENDA_PATH)) {
    log(`robots.txt verbiedt ${AGENDA_PATH} op ${theater.baseUrl} — sla over.`);
    return [];
  }
  const zwaar = await blokkeerZwareBronnen(page, { ookScripts: true, ookOverig: true });
  await waitForTurn();
  await gaNaar(page, theater.agendaUrl, { timeout: 45000 });
  const kaarten = await page.evaluate(leesAgenda);
  // Sanity check: een geldige agenda heeft producties.
  if (kaarten.length === 0) throw new Error(`geen producties (.event-col) op ${page.url()} — site veranderd of geblokkeerd?`);

  const speeldata = [];
  let details = 0;
  for (const k of kaarten) {
    if (!k.kop || !k.datum) continue;
    const meer = /meer data/i.test(k.datum);
    const detailUrl = k.href ? new URL(k.href, theater.baseUrl) : null;
    // Alleen eigen productiepagina's; verhuringen linken soms naar een
    // externe kaartverkoop (ticketshop.nl), daar gaan we niet heen.
    const eigen = detailUrl && detailUrl.host === new URL(theater.baseUrl).host;
    if (meer && eigen && details < MAX_DETAILS && robots.isAllowed(detailUrl.pathname)) {
      await waitForTurn();
      details++;
      try {
        await gaNaar(page, new URL(k.href, theater.baseUrl).toString(), { timeout: 45000 });
        const data = await page.evaluate(leesDetail);
        if (data.length) {
          for (const d of data) speeldata.push({ ...k, datum: d.datum, knop: d.knop ?? k.knop, labels: k.labels.filter((l) => !/wachtlijst|laatste|uitverkocht/i.test(l)) });
          continue;
        }
        warn(`geen speeldata op ${k.href} — alleen de eerste datum.`);
      } catch (err) {
        warn(`kon ${k.href} niet laden: ${err.message} — alleen de eerste datum.`);
      }
    }
    speeldata.push({ ...k, datum: k.datum.replace(/\+\s*meer data/i, '').trim() });
  }
  log(`${kaarten.length} producties, ${details} productiepagina's, ${speeldata.length} speeldata`);

  const parseDay = createDutchAbbrevDayParser();
  const buildId = createIdBuilder();
  const opgehaaldOp = new Date().toISOString();
  const shows = [];
  const onbekend = {};
  const weg = {};
  for (const s of speeldata) {
    // Besloten verhuur (besluit 7 okt 2026): een verhuring zonder
    // kaartverkoop (geen link en geen prijs) weglaten; een openbare verhuring
    // met kaartverkoop (bv. via ticketshop.nl) blijft, als Overig.
    if (/verhuur|verhuring/i.test(s.genre ?? '') && !s.href && !laagstePrijs(s.prijs)) {
      weg['besloten verhuur'] = (weg['besloten verhuur'] ?? 0) + 1;
      continue;
    }
    const datum = parseDay(s.datum);
    if (!datum) {
      log(`kon datum niet lezen: "${s.datum}" (${s.kop}) — overgeslagen.`);
      continue;
    }
    const tijd = extractTime(s.datum.replace(/^.*\bom\b/i, ''));
    if (s.genre && !isBekendGenre(s.genre)) onbekend[s.genre] = (onbekend[s.genre] ?? 0) + 1;
    const label = s.labels.join(' ');
    const url = s.href ? new URL(s.href, theater.baseUrl).toString() : theater.agendaUrl;
    const basis = {
      id: buildId(theater.id, s.kop, datum, tijd),
      titel: s.kop,
      theaterId: theater.id,
      theaterNaam: theater.naam,
      stad: theater.stad,
      ...(s.labels.some((l) => /op locatie/i.test(l)) ? { locatie: 'Op locatie' } : {}),
      podiumpas: theater.podiumpas,
      datum,
      tijd,
      genre: s.genre ? normalizeGenreVoor(theater.id, s.genre, `${s.kop} ${s.ondertitel ?? ''}`) ?? 'Overig' : null,
      genreRuw: s.genre,
      beschikbaarheid: oranjerieStatus(label, s.knop),
      beschrijving: null,
      maker: null,
      prijs: laagstePrijs(s.prijs),
      reserverenUrl: url,
      bron: url,
      opgehaaldOp,
    };
    const volgorde = MAKER_EERST.test(s.genre ?? '') ? 'maker-titel' : TAGLINE_ONDER.test(s.genre ?? '') ? 'titel-beschrijving' : 'titel-maker';
    const show = titelUitKopEnOndertitel(basis, { kop: s.kop, ondertitel: s.ondertitel, volgorde });
    shows.push(show.maker ? pasTitelConventieToe(show, { artiest: show.maker, voorstelling: show.titel, makerWordtLeeg: true }) : show);
  }
  if (Object.keys(onbekend).length) warn(`onbekende brongenres (nu Overig): ${Object.entries(onbekend).map(([k, n]) => `${k} (${n})`).join(', ')}`);
  if (Object.keys(weg).length) log(`weggelaten: ${Object.entries(weg).map(([k, n]) => `${k} (${n})`).join(', ')}`);
  log(`${zwaar.verzoeken()} verzoek(en) naar de site (plus robots.txt); ${zwaar.geblokkeerd()} afbeeldingen/scripts/fonts niet geladen`);
  return shows;
}
