import { createIdBuilder } from '../lib/normalize.js';

const AGENDA_PATH = '/programma';

function parseDateTime(raw) {
  const match = raw?.match(/(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})/);
  if (!match) return null;
  const [, year, month, day, hour, minute] = match;
  return { datum: `${year}-${month}-${day}`, tijd: `${hour}:${minute}` };
}

function classifyBeschikbaarheid(soldOut, statusTekst) {
  const tekst = (statusTekst ?? '').trim().toLowerCase();
  if (tekst.includes('wachtlijst')) return 'wachtlijst';
  if (soldOut || tekst.includes('uitverkocht')) return 'uitverkocht';
  return 'beschikbaar';
}

/**
 * Haalt de volledige agenda van Theater De Krakeling op.
 *
 * Structuur (geïnspecteerd op https://krakeling.nl/programma, aug 2026):
 * - /robots.txt redirect (302) naar een inlogpagina (waarschijnlijk een
 *   staging/CMS-eigenaardigheid — de rest van de site is gewoon publiek
 *   bereikbaar). fetch() volgt die redirect en probeert de HTML van de
 *   inlogpagina als robots.txt te parsen; die bevat geen "user-agent:"/
 *   "crawl-delay:"-regels, dus het resultaat is functioneel identiek aan
 *   "geen robots.txt": geen crawl-delay, standaard-minimumvertraging.
 * - Volledig server-rendered, alle ~107 voorstellingen op één pagina
 *   (geen paginering, geen "toon meer").
 * - Elk item (li.event-list__item) heeft een machine-leesbare
 *   <time datetime="2026-08-27 17:30:00"> (spatie i.p.v. "T").
 * - Geen genre-label op de site — De Krakeling is uitsluitend
 *   jeugdtheater, maar toont dat nergens als los, machine-leesbaar tag'je,
 *   dus laten we genre bewust null i.p.v. te raden.
 * - Uitverkocht-status: de kaart krijgt dan een extra class
 *   "event-card--sold-out" én een zichtbaar "Uitverkocht"-label
 *   (.event-card__extra) — de knoptekst zelf blijft altijd "Koop je
 *   tickets", dus die is geen betrouwbaar signaal.
 */
export async function scrapeKrakeling({ page, theater, robots, waitForTurn, log }) {
  if (!robots.isAllowed(AGENDA_PATH)) {
    log(`robots.txt verbiedt ${AGENDA_PATH} op ${theater.baseUrl} — sla over.`);
    return [];
  }

  await waitForTurn();
  await page.goto(theater.agendaUrl, { waitUntil: 'networkidle', timeout: 30000 });

  const rawItems = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('.event-list__item')).map((li) => {
      const iso = li.querySelector('time')?.getAttribute('datetime') ?? null;
      const titel = li.querySelector('.event-card__title')?.textContent.trim() ?? null;
      const beschrijving = li.querySelector('.event-card__intro')?.textContent.trim() ?? null;
      const soldOut = li.querySelector('.event-card--sold-out') !== null;
      const statusTekst = li.querySelector('.event-card__extra')?.textContent.trim() ?? null;
      const detailHref = li.querySelector('.event-card__link--overlay')?.getAttribute('href') ?? null;
      return { iso, titel, beschrijving, soldOut, statusTekst, detailHref };
    });
  });

  log(`${rawItems.length} voorstellingen gevonden op de programmapagina`);

  const buildId = createIdBuilder();
  const opgehaaldOp = new Date().toISOString();
  const shows = [];

  for (const item of rawItems) {
    if (!item.titel || !item.iso) continue;
    const parsed = parseDateTime(item.iso);
    if (!parsed) {
      log(`kon datum niet parsen: "${item.iso}" (${item.titel}) — overgeslagen.`);
      continue;
    }
    const detailUrl = item.detailHref ? new URL(item.detailHref, theater.baseUrl).toString() : theater.agendaUrl;

    shows.push({
      id: buildId(theater.id, item.titel, parsed.datum, parsed.tijd),
      titel: item.titel,
      theaterId: theater.id,
      theaterNaam: theater.naam,
      stad: theater.stad,
      podiumpas: theater.podiumpas,
      datum: parsed.datum,
      tijd: parsed.tijd,
      genre: null,
      genreRuw: null,
      beschikbaarheid: classifyBeschikbaarheid(item.soldOut, item.statusTekst),
      beschrijving: item.beschrijving,
      reserverenUrl: detailUrl,
      bron: theater.agendaUrl,
      opgehaaldOp,
    });
  }

  return shows;
}
