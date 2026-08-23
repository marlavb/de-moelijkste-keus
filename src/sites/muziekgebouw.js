import { extractTime, createIdBuilder } from '../lib/normalize.js';

const AGENDA_PATH = '/nl/agenda';
const MAX_LISTING_PAGES = 30;

const MONTHS_ABBR = {
  jan: 1,
  feb: 2,
  mrt: 3,
  apr: 4,
  mei: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  okt: 10,
  nov: 11,
  dec: 12,
};

function pad2(n) {
  return String(n).padStart(2, '0');
}

// ".start"-tekst: "zo 30 aug 2026" (weekdag + dag + afgekorte maand +
// jaartal) — afgekorte maandnaam MET jaartal, geen bestaande gedeelde
// parser in normalize.js dekt die combinatie.
function parseDate(raw) {
  const match = raw
    ?.trim()
    .toLowerCase()
    .match(/(\d{1,2})\s+([a-zé]+)\s+(\d{4})/);
  if (!match) return null;
  const [, day, monthAbbr, year] = match;
  const month = MONTHS_ABBR[monthAbbr];
  if (!month) return null;
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

// Twee signalen op de kaart: een <a class="status-info"> met tekst-label
// (bv. "Uitverkocht") verschijnt alleen bij een uitzonderlijke status —
// die checken we eerst. De bestelknop zelf (.btn-order) staat altijd op
// de kaart en heeft een eigen status-suffix in de class ("status-normaal",
// "status-laatste_kaarten", ...) die als fallback/bevestiging dient.
function classifyBeschikbaarheid(statusInfoText, btnOrderStatus) {
  const info = (statusInfoText ?? '').toLowerCase();
  if (info.includes('wachtlijst')) return 'wachtlijst';
  if (info.includes('uitverkocht')) return 'uitverkocht';

  const btn = (btnOrderStatus ?? '').toLowerCase();
  if (btn.includes('wachtlijst')) return 'wachtlijst';
  if (btn.includes('uitverkocht')) return 'uitverkocht';
  if (btn.includes('normaal') || btn.includes('laatste')) return 'beschikbaar';

  return 'onbekend';
}

/**
 * Haalt de volledige agenda van Muziekgebouw aan 't IJ op.
 *
 * Structuur (geïnspecteerd op https://www.muziekgebouw.nl/nl/agenda,
 * aug 2026):
 * - robots.txt: crawl-delay 5s voor "*". Disallow: /*?* met een expliciete
 *   Allow: /*?page=* erboven — paginering via ?page=N is dus toegestaan
 *   (de meer specifieke Allow wint), maar een query-param-filter als
 *   ?production_type=... zou dat NIET zijn, dus die vermijden we.
 * - Server-rendered, gepagineerd via ?page=N (~20 kaarten/pagina, ~20
 *   pagina's in totaal — we stoppen zodra een pagina leeg is).
 * - Eén voorstellingstype (production-type-default) — geen filmvertoningen
 *   die eruit gefilterd moeten worden, in tegenstelling tot Theater De
 *   Omval op hetzelfde platform.
 * - Genre-tags worden client-side nagevuld via een Stimulus-controller
 *   (data-controller="genres") die zelfs na volledige JS-rendering +
 *   networkidle leeg blijft (geverifieerd) — kennelijk pas bij interactie
 *   of kapot. Niet op te halen zonder een aparte, extra request per
 *   voorstelling, dus genre blijft null.
 * - Uitverkocht/wachtlijst-status staat als <a class="status-info
 *   status-uitverkocht"><span class="label">Uitverkocht</span></a>,
 *   die element ontbreekt volledig bij een normaal beschikbare
 *   voorstelling. Als fallback/bevestiging staat er ook altijd een
 *   bestelknop (.btn-order) met een eigen status-suffix in de class
 *   ("status-normaal", "status-laatste_kaarten") én een directe
 *   "toevoegen aan winkelwagen"-link in href — die link gebruiken we als
 *   reserverenUrl in plaats van de detailpagina.
 */
export async function scrapeMuziekgebouw({ page, theater, robots, waitForTurn, log }) {
  if (!robots.isAllowed(AGENDA_PATH)) {
    log(`robots.txt verbiedt ${AGENDA_PATH} op ${theater.baseUrl} — sla over.`);
    return [];
  }

  const rawItems = [];
  for (let pageNum = 1; pageNum <= MAX_LISTING_PAGES; pageNum++) {
    const url = pageNum === 1 ? theater.agendaUrl : `${theater.agendaUrl}?page=${pageNum}`;
    const listingPath = pageNum === 1 ? AGENDA_PATH : `${AGENDA_PATH}?page=${pageNum}`;
    if (!robots.isAllowed(listingPath)) {
      log(`robots.txt verbiedt ${listingPath} — stop met pagineren.`);
      break;
    }

    await waitForTurn();
    let pageItems;
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      pageItems = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('.eventCard')).map((el) => {
          const titel = el.querySelector('.title')?.textContent.trim() ?? null;
          const detailHref = el.querySelector('a.desc')?.getAttribute('href') ?? null;
          const beschrijving = el.querySelector('.tagline')?.textContent.trim() ?? null;
          const dagTekst = el.querySelector('.top-date .start')?.textContent.trim() ?? null;
          const tijdTekst = el.querySelector('.top-date .time')?.textContent.trim() ?? null;
          const statusInfoText = el.querySelector('.status-info .label')?.textContent.trim() ?? null;
          const btnOrderEl = el.querySelector('.btn-order');
          const btnOrderStatus = btnOrderEl?.className ?? null;
          const ticketHref = btnOrderEl?.getAttribute('href') ?? null;
          return { titel, detailHref, beschrijving, dagTekst, tijdTekst, statusInfoText, btnOrderStatus, ticketHref };
        });
      });
    } catch (err) {
      log(`kon listingpagina ${pageNum} niet laden: ${err.message} — probeer volgende pagina.`);
      continue;
    }

    log(`pagina ${pageNum}: ${pageItems.length} items`);
    if (pageItems.length === 0) break;
    rawItems.push(...pageItems);
  }

  const buildId = createIdBuilder();
  const opgehaaldOp = new Date().toISOString();
  const shows = [];

  for (const item of rawItems) {
    if (!item.titel || !item.dagTekst) continue;
    const datum = parseDate(item.dagTekst);
    if (!datum) {
      log(`kon datum niet parsen: "${item.dagTekst}" (${item.titel}) — overgeslagen.`);
      continue;
    }
    const tijd = extractTime(item.tijdTekst);
    const detailUrl = item.detailHref ? new URL(item.detailHref, theater.baseUrl).toString() : theater.agendaUrl;
    const ticketUrl = item.ticketHref ? new URL(item.ticketHref, theater.baseUrl).toString() : null;

    shows.push({
      id: buildId(theater.id, item.titel, datum, tijd),
      titel: item.titel,
      theaterId: theater.id,
      theaterNaam: theater.naam,
      stad: theater.stad,
      podiumpas: theater.podiumpas,
      datum,
      tijd,
      genre: null,
      genreRuw: null,
      beschikbaarheid: classifyBeschikbaarheid(item.statusInfoText, item.btnOrderStatus),
      beschrijving: item.beschrijving,
      reserverenUrl: ticketUrl ?? detailUrl,
      bron: theater.agendaUrl,
      opgehaaldOp,
    });
  }

  return shows;
}
