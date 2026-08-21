import { createDutchDayParser, extractTime, createIdBuilder } from '../lib/normalize.js';
import { normalizeGenre } from '../lib/genre.js';

const AGENDA_PATH = '/agenda/';
const MAX_LOAD_MORE_CLICKS = 40;

/**
 * Haalt de volledige agenda van DeLaMar Theater op.
 *
 * Structuur (geïnspecteerd op https://delamar.nl/agenda/, aug 2026):
 * - container .productions__tiles bevat om en om .productions__day
 *   (dag-header, bv. "Vandaag" / "Morgen" / "Zondag 23 augustus", geen jaar)
 *   en .tile.js-tile (één voorstelling op één datum/tijd).
 * - Extra voorstellingen worden via een "Toon meer"-knop (.js-productions-more)
 *   client-side bijgeladen; er is geen paginering via de URL.
 * - Elke tile heeft een link naar de detailpagina, een genre-chip, titel,
 *   korte beschrijving, tijd ("20:00 uur") en in de footer een directe
 *   ticketlink (button--green "Koop tickets" / button--orange "Laatste
 *   tickets"). Bij uitverkochte voorstellingen ontbreekt de ticketlink en
 *   staat er alleen een disabled "Uitverkocht"-badge — dan valt reserverenUrl
 *   terug op de detailpagina.
 */
export async function scrapeDelamar({ page, theater, robots, waitForTurn, log }) {
  if (!robots.isAllowed(AGENDA_PATH)) {
    log(`robots.txt verbiedt ${AGENDA_PATH} op ${theater.baseUrl} — sla over.`);
    return [];
  }

  await waitForTurn();
  await page.goto(theater.agendaUrl, { waitUntil: 'networkidle', timeout: 30000 });

  let previousCount = -1;
  for (let i = 0; i < MAX_LOAD_MORE_CLICKS; i++) {
    const count = await page.locator('.tile.js-tile').count();
    if (count === previousCount) break;
    previousCount = count;

    const moreButton = page.locator('.js-productions-more');
    const visible = await moreButton.isVisible().catch(() => false);
    if (!visible) break;

    await waitForTurn();
    await moreButton.click();
    await page
      .locator('.tile.js-tile')
      .nth(previousCount)
      .waitFor({ state: 'attached', timeout: 10000 })
      .catch(() => {});
  }

  const rawItems = await page.evaluate(() => {
    const container = document.querySelector('.productions__tiles');
    if (!container) return [];
    const items = [];
    let currentDay = null;

    for (const el of container.children) {
      if (el.classList.contains('productions__day')) {
        currentDay = el.querySelector('span')?.textContent.trim() ?? null;
      } else if (el.classList.contains('tile') && el.classList.contains('js-tile')) {
        const titel = el.querySelector('h3')?.textContent.trim() ?? null;
        const beschrijving = el.querySelector('.tile__text p')?.textContent.trim() ?? null;
        const detailHref = el.querySelector('a[href]')?.getAttribute('href') ?? null;
        const genre = el.querySelector('.tile__image .genres .genre')?.textContent.trim() ?? null;
        const tijdTekst = el.querySelector('.tile__text .genres .genre')?.textContent.trim() ?? null;
        const ticketHref = el.querySelector('.tile__footer a[href]')?.getAttribute('href') ?? null;

        items.push({ day: currentDay, titel, beschrijving, detailHref, genre, tijdTekst, ticketHref });
      }
    }
    return items;
  });

  const parseDay = createDutchDayParser();
  const buildId = createIdBuilder();
  const opgehaaldOp = new Date().toISOString();
  const shows = [];

  for (const item of rawItems) {
    if (!item.titel || !item.day) continue;
    const datum = parseDay(item.day);
    if (!datum) {
      log(`kon datum-label niet parsen: "${item.day}" (${item.titel}) — overgeslagen.`);
      continue;
    }
    const tijd = extractTime(item.tijdTekst);
    const detailUrl = item.detailHref ? new URL(item.detailHref, theater.baseUrl).toString() : null;

    shows.push({
      id: buildId(theater.id, item.titel, datum, tijd),
      titel: item.titel,
      theaterId: theater.id,
      theaterNaam: theater.naam,
      stad: theater.stad,
      datum,
      tijd,
      genre: normalizeGenre(item.genre),
      genreRuw: item.genre,
      beschrijving: item.beschrijving,
      reserverenUrl: item.ticketHref ?? detailUrl,
      bron: theater.agendaUrl,
      opgehaaldOp,
    });
  }

  return shows;
}
