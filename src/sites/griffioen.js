import { createIdBuilder } from '../lib/normalize.js';
import { normalizeGenre } from '../lib/genre.js';

const AGENDA_PATH = '/voorstellingen';
const CARD_SELECTOR = '.program-item--performance-theatre';
const MAX_PAGES = 40;

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

// "vr 11 sep. 2026- 20.00 uur" — weekdag-afkorting, dag, maand-afkorting
// (met punt), jaartal, koppelteken zonder spatie, tijd, "uur". Jaartal staat
// er expliciet bij, dus geen rollover-logica nodig zoals bij de meeste
// andere afgekorte-datum-parsers in dit project.
function parseDateTime(raw) {
  const match = raw
    ?.trim()
    .toLowerCase()
    .match(/(\d{1,2})\s+([a-zé]+)\.?\s+(\d{4})-\s*(\d{1,2})[.:](\d{2})/);
  if (!match) return null;
  const [, day, monthAbbr, year, hour, minute] = match;
  const month = MONTHS_ABBR[monthAbbr];
  if (!month) return null;
  return {
    datum: `${year}-${pad2(month)}-${pad2(parseInt(day, 10))}`,
    tijd: `${pad2(parseInt(hour, 10))}:${minute}`,
  };
}

/**
 * Haalt de volledige agenda van VU Griffioen op.
 *
 * Structuur (geïnspecteerd op https://griffioen.vu.nl/voorstellingen,
 * aug 2026):
 * - robots.txt staat "*" toe zonder crawl-delay.
 * - Client-side gerenderd (ProcessWire/kale JS-app) — Playwright vereist.
 * - Kaarten (.program-item) hebben geen <a href>, maar navigeren via een
 *   onclick="document.location='/voorstellingen/...'"-attribuut — de
 *   detail-URL moet daaruit met een regex gehaald worden.
 * - .program-item--performance-theatre is het enige itemtype dat we op
 *   deze pagina zijn tegengekomen (film/cursussen lijken op aparte URLs te
 *   staan) — we filteren er toch expliciet op, voor het geval dat verandert.
 * - Paginering via klikbare nummers onderaan (5 pagina's, ~24 items per
 *   pagina) — de pagina-inhoud wordt bij een klik volledig vervangen (geen
 *   infinite scroll/append), dus we lezen na elke klik opnieuw de volledige
 *   kaartenlijst uit.
 * - Genre staat direct op de kaart (.genre-span, één vaste waarde) — geen
 *   taglijst. De tweede <span> op de kaart is de productie-ondertitel, die
 *   gebruiken we als beschrijving.
 * - Geen boekingsstatus-signaal op de kaart zelf — beschikbaarheid blijft
 *   "onbekend".
 */
export async function scrapeGriffioen({ page, theater, robots, waitForTurn, log }) {
  if (!robots.isAllowed(AGENDA_PATH)) {
    log(`robots.txt verbiedt ${AGENDA_PATH} op ${theater.baseUrl} — sla over.`);
    return [];
  }

  await waitForTurn();
  await page.goto(theater.agendaUrl, { waitUntil: 'networkidle', timeout: 30000 });

  const pageNumbers = await page
    .evaluate(() =>
      Array.from(document.querySelectorAll('a.pagination__link:not(.pagination__link--next)')).map((a) =>
        parseInt(a.getAttribute('data-page'), 10)
      )
    )
    .catch(() => []);
  const totalPages = Math.min(pageNumbers.length > 0 ? Math.max(...pageNumbers) : 1, MAX_PAGES);

  const rawItems = [];
  for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
    if (pageNum > 1) {
      await waitForTurn();
      await page.click(`a.pagination__link[data-page="${pageNum}"]:not(.pagination__link--next)`);
      await page.locator(CARD_SELECTOR).first().waitFor({ state: 'attached', timeout: 10000 });
    }

    const items = await page.evaluate((selector) => {
      return Array.from(document.querySelectorAll(selector)).map((el) => {
        const onclick = el.getAttribute('onclick') ?? '';
        const urlMatch = onclick.match(/document\.location='([^']+)'/);
        const spans = Array.from(el.querySelectorAll('span')).map((s) => s.textContent.trim());
        return {
          titel: el.querySelector('strong')?.textContent.trim() ?? null,
          genreRuw: el.querySelector('.genre')?.textContent.trim() ?? null,
          beschrijving: spans[1] ?? null,
          tijdTekst: el.querySelector('time')?.textContent.trim() ?? null,
          detailPath: urlMatch ? urlMatch[1] : null,
        };
      });
    }, CARD_SELECTOR);

    log(`pagina ${pageNum}: ${items.length} items`);
    rawItems.push(...items);
  }

  const buildId = createIdBuilder();
  const opgehaaldOp = new Date().toISOString();
  const shows = [];

  for (const item of rawItems) {
    if (!item.titel) continue;
    const parsed = parseDateTime(item.tijdTekst);
    if (!parsed) {
      log(`kon datum/tijd niet parsen: "${item.tijdTekst}" (${item.titel}) — overgeslagen.`);
      continue;
    }
    const detailUrl = item.detailPath ? new URL(item.detailPath, theater.baseUrl).toString() : theater.agendaUrl;

    shows.push({
      id: buildId(theater.id, item.titel, parsed.datum, parsed.tijd),
      titel: item.titel,
      theaterId: theater.id,
      theaterNaam: theater.naam,
      stad: theater.stad,
      podiumpas: theater.podiumpas,
      datum: parsed.datum,
      tijd: parsed.tijd,
      genre: normalizeGenre(item.genreRuw),
      genreRuw: item.genreRuw,
      beschikbaarheid: 'onbekend',
      beschrijving: item.beschrijving,
      reserverenUrl: detailUrl,
      bron: theater.agendaUrl,
      opgehaaldOp,
    });
  }

  return shows;
}
