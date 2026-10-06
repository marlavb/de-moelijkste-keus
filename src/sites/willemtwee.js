import { createDutchAbbrevDayParser, extractTime, createIdBuilder } from '../lib/normalize.js';
import { blokkeerZwareBronnen } from '../lib/zwareBronnen.js';
import { classifyPepperedButton } from '../lib/peppered.js';
import { pagineerCre8ion } from '../lib/cre8ion.js';
import { prijsUitTekst } from '../lib/wpTheatre.js';

const AGENDA_PATH = '/agenda/toonzaal';

// Podiumpas bij Willem Twee (bron: https://www.willem-twee.nl/podiumpas, 6 okt
// 2026): "De Podiumpas is te gebruiken bij de reguliere concerten in Willem
// Twee Toonzaal … de concerten die je kunt bezoeken met de podiumpas [worden]
// op onze website aangeduid met de tag 'Podiumpas'." Dus per concert: de tag.
// Concerten buiten de Toonzaal (in Theater aan de Parade, de Verkadefabriek)
// nemen we niet mee (akkoord 6 okt 2026, open vraag 4).

// Draait in de browser.
function leesWillemTwee() {
  const tekst = (el) => el?.textContent.replace(/\s+/g, ' ').trim() || null;
  return [...document.querySelectorAll('div.article-wrapper > a[href]')].map((a) => {
    const tags = [...a.querySelectorAll('.tags span.tag')].map((s) => tekst(s)).filter(Boolean);
    return {
      href: a.getAttribute('href'),
      titel: tekst(a.querySelector('.article-title')),
      ondertitel: tekst(a.querySelector('.article-subtitle')),
      datumTekst: tekst(a.querySelector('.article-date')),
      genres: (tekst(a.querySelector('.article-genre')) ?? '').split(',').map((g) => g.trim()).filter(Boolean),
      locatie: tags[0] ?? null,
      prijsTekst: tags[1] ?? null,
      knopTekst: tekst(a.querySelector('.btn-block .btn')),
    };
  });
}

/**
 * Toonzaal Willem Twee ('s-Hertogenbosch).
 *
 * Structuur (geïnspecteerd op https://www.willem-twee.nl/agenda/toonzaal, 6
 * okt 2026): CMS van The Cre8ion.Lab (lib/cre8ion.js), ~20 concerten per
 * pagina, 6 pagina's (?page=N). Per concert een kaart: locatie (Toonzaal,
 * Theater aan de Parade, Verkadefabriek) en prijs als tags, knop (Tickets,
 * Gratis, Uitverkocht), titel, ondertitel, "wo 28 okt. - 12:30" (zonder
 * jaar) en de genres, met de tag "Podiumpas". ~7 verzoeken per run.
 *
 * Titel = de concerttitel; de ondertitel is meestal een omschrijving en
 * wordt de beschrijving. Genre: Muziek & Concert (concertzaal), behalve
 * Kinderconcert (Familie & Jeugd).
 */
export async function scrapeWillemTwee({ page, theater, robots, waitForTurn, log, warn = log }) {
  if (!robots.isAllowed(AGENDA_PATH)) {
    log(`robots.txt verbiedt ${AGENDA_PATH} op ${theater.baseUrl} — sla over.`);
    return [];
  }
  const zwaar = await blokkeerZwareBronnen(page, { ookScripts: true });
  const items = await pagineerCre8ion({
    page,
    theater,
    robots,
    waitForTurn,
    log,
    warn,
    agendaPath: AGENDA_PATH,
    extract: leesWillemTwee,
    sleutelVan: (it) => `${it.href}|${it.datumTekst}`,
    label: 'concerten',
  });

  const parseDay = createDutchAbbrevDayParser();
  const buildId = createIdBuilder();
  const opgehaaldOp = new Date().toISOString();
  const shows = [];
  const elders = {};
  const knoppen = {};
  for (const it of items) {
    if (!it.titel || !it.datumTekst) continue;
    const datum = parseDay(it.datumTekst); // altijd, ook voor de jaar-rollover
    if (!/^toonzaal$/i.test(it.locatie ?? '')) {
      elders[it.locatie ?? '(geen locatie)'] = (elders[it.locatie ?? '(geen locatie)'] ?? 0) + 1;
      continue;
    }
    if (!datum) {
      log(`kon datum niet lezen: "${it.datumTekst}" (${it.titel}) — overgeslagen.`);
      continue;
    }
    const beschikbaarheid = classifyPepperedButton(it.knopTekst);
    if (beschikbaarheid === null) continue;
    knoppen[it.knopTekst ?? '(geen knop)'] = (knoppen[it.knopTekst ?? '(geen knop)'] ?? 0) + 1;
    const tijd = extractTime(it.datumTekst.split(' - ')[1] ?? null);
    const genres = it.genres.filter((g) => g.toLowerCase() !== 'podiumpas');
    // "Gratis" als prijs- of knoptekst is hier geen betrouwbare prijs: Vicky
    // Chow (8 okt 2026) heeft bij Willem Twee "Gratis" en bij Theater aan de
    // Parade € 29,50; Dead Mind Festival € 30 met de knop "Gratis". Dan
    // prijs onbekend; de Podiumpas volgt alleen de tag.
    shows.push({
      id: buildId(theater.id, it.titel, datum, tijd),
      titel: it.titel,
      theaterId: theater.id,
      theaterNaam: theater.naam,
      stad: theater.stad,
      zaal: 'Toonzaal',
      podiumpas: theater.podiumpas && it.genres.some((g) => g.toLowerCase() === 'podiumpas'),
      datum,
      tijd,
      genre: genres.some((g) => /kinderconcert/i.test(g)) ? 'Familie & Jeugd' : 'Muziek & Concert',
      genreRuw: genres.join(', ') || null,
      beschikbaarheid,
      beschrijving: it.ondertitel,
      maker: null,
      prijs: /€/.test(it.prijsTekst ?? '') ? prijsUitTekst(it.prijsTekst) : null,
      reserverenUrl: new URL(it.href, theater.baseUrl).toString(),
      bron: new URL(it.href, theater.baseUrl).toString(),
      opgehaaldOp,
    });
  }
  const lijst = (o) => Object.entries(o).map(([k, n]) => `${k} (${n})`).join(', ');
  log(`knopteksten: ${lijst(knoppen)}`);
  if (Object.keys(elders).length) log(`niet in de Toonzaal (niet meegenomen): ${lijst(elders)}`);
  log(`${zwaar.verzoeken()} verzoek(en) naar de site (plus robots.txt); ${zwaar.geblokkeerd()} afbeeldingen/scripts/fonts niet geladen`);
  return shows;
}
