import { createDutchAbbrevDayParser, extractTime, createIdBuilder } from '../lib/normalize.js';
import { normalizeGenre } from '../lib/genre.js';

const AGENDA_PATH = '/nl/agenda/';
const MAX_SCROLL_ATTEMPTS = 40;
const STABLE_CHECKS_NEEDED = 3;

/**
 * Haalt de volledige agenda van ITA (Internationaal Theater Amsterdam) op.
 *
 * Structuur (geïnspecteerd op https://ita.nl/nl/agenda/, aug 2026):
 * - Server-rendered HTML (geen JS nodig om de eerste 50 items te zien), met
 *   daarna infinite scroll die per keer 50 extra voorstellingen bijlaadt
 *   (herkenbaar aan een .agenda__loader-spinner die verdwijnt zodra alles
 *   geladen is).
 * - Items staan gegroepeerd in .agenda__day-container-blokken (dag-header
 *   ".agenda__day-title", bv. "di 25 aug" — zelfde formaat als Bellevue).
 *   Elke voorstelling is een <a class="agendaItem__item" href="...">
 *   die linkt naar de eigen infopagina op ita.nl (niet rechtstreeks naar de
 *   ticketshop op tix.ita.nl — dat vereist een extra bezoek, dus we laten
 *   reserverenUrl naar de infopagina wijzen).
 * - Genre staat als los stukje tekst in .agendaItem__item-category.meta.
 * - Geen bruikbaar beschikbaarheid-signaal gevonden: de site heeft wel een
 *   "UITVERKOCHT"-vertaalsleutel in zijn JS, maar geen van de 325
 *   gecontroleerde items had een herkenbare uitverkocht/wachtlijst-class of
 *   -tekst — blijft dus "onbekend".
 */
export async function scrapeIta({ page, theater, robots, waitForTurn, log }) {
  if (!robots.isAllowed(AGENDA_PATH)) {
    log(`robots.txt verbiedt ${AGENDA_PATH} op ${theater.baseUrl} — sla over.`);
    return [];
  }

  await waitForTurn();
  await page.goto(theater.agendaUrl, { waitUntil: 'networkidle', timeout: 30000 });

  let previousCount = -1;
  let stableChecks = 0;
  for (let i = 0; i < MAX_SCROLL_ATTEMPTS; i++) {
    const count = await page.locator('.agendaItem__item').count();
    if (count === previousCount) {
      stableChecks++;
      if (stableChecks >= STABLE_CHECKS_NEEDED) break;
    } else {
      stableChecks = 0;
    }
    previousCount = count;

    await waitForTurn();
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(2000);
  }

  const rawItems = await page.evaluate(() => {
    const items = [];
    for (const dayEl of document.querySelectorAll('.agenda__day-container')) {
      const dayLabel = dayEl.querySelector('.agenda__day-title')?.textContent.trim().replace(/\s+/g, ' ') ?? null;
      for (const el of dayEl.querySelectorAll('.agendaItem__item')) {
        const titel = el.querySelector('.agendaItem__item-title > span')?.textContent.trim() ?? null;
        const href = el.getAttribute('href');
        const genre =
          el.querySelector(
            '.agendaItem__item-category.meta > span:not(.agendaItem__labels):not(.agendaItem__item-extra-content)'
          )?.textContent.trim() ?? null;
        const tijdTekst = el.querySelector('.agendaItem__item-date time')?.textContent.trim() ?? null;
        items.push({ dayLabel, titel, href, genre, tijdTekst });
      }
    }
    return items;
  });

  const parseDay = createDutchAbbrevDayParser();
  const buildId = createIdBuilder();
  const opgehaaldOp = new Date().toISOString();
  const shows = [];

  for (const item of rawItems) {
    if (!item.titel || !item.dayLabel || !item.href) continue;
    const datum = parseDay(item.dayLabel);
    if (!datum) {
      log(`kon datum-label niet parsen: "${item.dayLabel}" (${item.titel}) — overgeslagen.`);
      continue;
    }
    const tijd = extractTime(item.tijdTekst);
    const infoUrl = new URL(item.href, theater.baseUrl).toString();

    shows.push({
      id: buildId(theater.id, item.titel, datum, tijd),
      titel: item.titel,
      theaterId: theater.id,
      theaterNaam: theater.naam,
      stad: theater.stad,
      podiumpas: theater.podiumpas,
      datum,
      tijd,
      genre: normalizeGenre(item.genre),
      genreRuw: item.genre,
      beschikbaarheid: 'onbekend',
      beschrijving: null,
      reserverenUrl: infoUrl,
      bron: theater.agendaUrl,
      opgehaaldOp,
    });
  }

  return shows;
}
