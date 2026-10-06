import { extractTime, createIdBuilder } from '../lib/normalize.js';
import { createGroupScraper } from '../lib/peppered.js';
import { blokkeerZwareBronnen } from '../lib/zwareBronnen.js';
import { gaNaar } from '../lib/diagnose.js';
import { THEATERS } from '../lib/config.js';

const AGENDA_PATH = '/agenda';
const LOCATIE = 'Het Cenakel | Tilburg';

// Reeksnaam in de agenda van Het Cenakel → onze config-entry. Andere reeksen
// (Betoverende Pianisten, Bachcantates, Verrassende Orgelklanken, …) zijn
// niet van een Podiumpas-organisator en laten we weg.
// - De Link: "Podiumpashouders bezoeken alle concerten van De Link in het
//   Cenakel gratis" (https://delink.nl/tickets-en-kortingspassen/, 6 okt
//   2026). Daarom alleen de Cenakel-agenda: De Link speelt ook in de
//   Concertzaal en de LocHal, en daar geldt de pas niet.
// - S.M.E.T.: op podiumpas.nl (https://podiumpas.nl/waar-te-besteden, 6 okt
//   2026) met een link naar deze agenda; eigen voorwaarden niet gevonden.
export function theaterIdVoorReeks(reeks) {
  const r = String(reeks ?? '').trim().toLowerCase();
  if (/^de link\b/.test(r)) return 'delink';
  if (/^s\.?m\.?e\.?t\.?(\s|$)/.test(r)) return 'smet';
  return null;
}

const MAANDEN = { januari: 1, februari: 2, maart: 3, april: 4, mei: 5, juni: 6, juli: 7, augustus: 8, september: 9, oktober: 10, november: 11, december: 12 };

/** "11 oktober 2026" → "2026-10-11". */
export function parseCenakelDatum(tekst) {
  const m = String(tekst ?? '').toLowerCase().replace(/ /g, ' ').match(/(\d{1,2})\s+([a-z]+)\s+(\d{4})/);
  if (!m || !MAANDEN[m[2]]) return null;
  return `${m[3]}-${String(MAANDEN[m[2]]).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}

/**
 * Het Cenakel (Tilburg): één agenda voor De Link (nieuwe muziek) en S.M.E.T.
 * (kamermuziek), die op podiumpas.nl als losse locaties staan.
 *
 * Structuur (geïnspecteerd op https://www.cenakel.nl/agenda, 6 okt 2026):
 * Joomla met iCagenda, alle komende concerten (22) op één pagina, zonder
 * paginering. Per concert (div.ic-list-event): de reeks als titel, de
 * categorie ("Concert"), "11 oktober 2026" en "12:30", de uitvoerenden
 * (.ic-descshort) en een link naar de detailpagina. Geen prijs en geen
 * status: beschikbaarheid "onbekend". Eén verzoek per run voor beide
 * (createGroupScraper), robots.txt staat alles toe.
 *
 * Titel = de uitvoerenden ("Skazka Quartet"), zonder reeksnaam (akkoord 6
 * okt 2026); de reeks bepaalt het theater.
 */
async function scrapeAllCenakel({ page, theater, robots, waitForTurn, log, warn = log }) {
  if (!robots.isAllowed(AGENDA_PATH)) {
    log(`robots.txt verbiedt ${AGENDA_PATH} op ${theater.baseUrl} — sla over.`);
    return [];
  }
  const zwaar = await blokkeerZwareBronnen(page, { ookScripts: true });
  await waitForTurn();
  await gaNaar(page, theater.agendaUrl, { timeout: 45000 });
  const { items, totaal } = await page.evaluate(() => {
    const tekst = (el) => el?.textContent.replace(/\s+/g, ' ').trim() || null;
    return {
      totaal: Number(document.querySelector('.ic-subtitle-string')?.textContent.match(/(\d+)/)?.[1]) || null,
      items: Array.from(document.querySelectorAll('div.ic-list-event')).map((el) => ({
        reeks: tekst(el.querySelector('.ic-title-header h2')),
        categorie: tekst(el.querySelector('.ic-title-cat')),
        datum: tekst(el.querySelector('.ic-single-next')),
        tijd: tekst(el.querySelector('.ic-single-starttime')),
        uitvoerenden: tekst(el.querySelector('.ic-descshort')),
        href: el.querySelector('.ic-title-header a')?.getAttribute('href') ?? null,
      })),
    };
  });
  // Sanity check: een geldige agenda heeft concerten.
  if (items.length === 0) throw new Error(`geen concerten (div.ic-list-event) op ${page.url()} — site veranderd of geblokkeerd?`);
  if (totaal && totaal !== items.length) warn(`de agenda noemt ${totaal} evenementen, gelezen ${items.length} — paginering of opmaak veranderd?`);

  const buildId = createIdBuilder();
  const opgehaaldOp = new Date().toISOString();
  const shows = [];
  const anders = {};
  for (const it of items) {
    const theaterId = theaterIdVoorReeks(it.reeks);
    if (!theaterId) {
      anders[it.reeks ?? '(geen reeks)'] = (anders[it.reeks ?? '(geen reeks)'] ?? 0) + 1;
      continue;
    }
    const datum = parseCenakelDatum(it.datum);
    if (!datum) {
      log(`kon datum niet lezen: "${it.datum}" (${it.reeks}) — overgeslagen.`);
      continue;
    }
    const tijd = extractTime(it.tijd);
    const titel = it.uitvoerenden || it.reeks;
    const lid = THEATERS.find((t) => t.id === theaterId);
    shows.push({
      id: buildId(theaterId, titel, datum, tijd),
      titel,
      theaterId,
      theaterNaam: lid?.naam ?? theaterId,
      stad: lid?.stad ?? theater.stad,
      locatie: LOCATIE,
      podiumpas: lid?.podiumpas === true,
      datum,
      tijd,
      genre: 'Muziek & Concert',
      genreRuw: it.categorie,
      beschikbaarheid: 'onbekend',
      beschrijving: it.reeks,
      maker: null,
      prijs: null,
      reserverenUrl: it.href ? new URL(it.href, theater.baseUrl).toString() : theater.agendaUrl,
      bron: theater.agendaUrl,
      opgehaaldOp,
    });
  }
  const lijst = (o) => Object.entries(o).map(([k, n]) => `${k} (${n})`).join(', ');
  if (Object.keys(anders).length) log(`andere reeksen (niet van ons): ${lijst(anders)}`);
  log(`${zwaar.verzoeken()} verzoek(en) naar de site (plus robots.txt); ${zwaar.geblokkeerd()} afbeeldingen/scripts/fonts niet geladen`);
  return shows;
}

/** Voor De Link en S.M.E.T. (zelfde agenda, één scrape per run). */
export const scrapeCenakelGroep = createGroupScraper(scrapeAllCenakel);

/** Losse scrape van de hele agenda (alle eigen concerten), voor tests. */
export { scrapeAllCenakel };
