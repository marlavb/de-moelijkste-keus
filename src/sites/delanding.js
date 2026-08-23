import { extractTime, createIdBuilder } from '../lib/normalize.js';
import { normalizeGenre } from '../lib/genre.js';

const AGENDA_PATH = '/nl/delanding/agenda/';
const MAX_LOAD_MORE_CLICKS = 40;

function classifyBeschikbaarheid(orderText) {
  const tekst = (orderText ?? '').trim().toLowerCase();
  if (tekst.includes('wachtlijst')) return 'wachtlijst';
  if (tekst.includes('uitverkocht')) return 'uitverkocht';
  if (tekst.includes('bestel') || tekst.includes('gratis') || tekst.includes('kaart') || tekst.includes('tickets'))
    return 'beschikbaar';
  return 'onbekend';
}

/**
 * Haalt de volledige agenda van Theater De Landing op.
 *
 * De Landing draait op exact hetzelfde platform als Schouwburg Amstelveen
 * (zelfde exploitant) — letterlijk dezelfde domeinnaam
 * (schouwburgamstelveen.nl), alleen onder /nl/delanding/ in plaats van
 * /nl/theater/. robots.txt (op domeinniveau, dus gedeeld met Amstelveen)
 * bestaat niet (404) — geen crawl-delay, standaard-minimum vertraging.
 * Zelfde markup als Amstelveen: .eventList-events > li met "Toon
 * meer"-knop (.loadMore), machine-leesbare <time datetime>, .eventList-tags
 * voor genre, .eventOrder-tekst voor boekingsstatus. Binnen deze sectie
 * kwamen in de praktijk alleen class="delanding"-items voor (geen
 * "cinema"-items zoals bij Amstelveen), maar we filteren er voor de
 * zekerheid toch expliciet op door — mocht er ooit film bijkomen, blijft
 * dit een theateragenda.
 */
export async function scrapeDeLanding({ page, theater, robots, waitForTurn, log }) {
  if (!robots.isAllowed(AGENDA_PATH)) {
    log(`robots.txt verbiedt ${AGENDA_PATH} op ${theater.baseUrl} — sla over.`);
    return [];
  }

  await waitForTurn();
  await page.goto(theater.agendaUrl, { waitUntil: 'networkidle', timeout: 30000 });

  let previousCount = -1;
  for (let i = 0; i < MAX_LOAD_MORE_CLICKS; i++) {
    const count = await page.locator('.eventList-events > li').count();
    if (count === previousCount) break;
    previousCount = count;

    const moreButton = page.locator('.loadMore');
    const visible = await moreButton.isVisible().catch(() => false);
    if (!visible) break;

    await waitForTurn();
    await moreButton.click();
    await page
      .locator('.eventList-events > li')
      .nth(previousCount)
      .waitFor({ state: 'attached', timeout: 10000 })
      .catch(() => {});
  }

  const rawItems = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('.eventList-events > li.delanding')).map((li) => {
      const iso = li.querySelector('time.eventList-dateTime')?.getAttribute('datetime') ?? null;
      const titel = li.querySelector('.eventList-title')?.textContent.trim() ?? null;
      const beschrijving = li.querySelector('.eventList-slogan')?.textContent.trim() ?? null;
      const genres = Array.from(li.querySelectorAll('.eventList-tags li')).map((t) => t.textContent.trim());
      const detailHref = li.querySelector('a.eventList-detailLink')?.getAttribute('href') ?? null;
      const orderEl = li.querySelector('.eventOrder a, .eventOrder button, .eventOrder span');
      const orderHref = orderEl?.getAttribute('href') ?? null;
      const orderText =
        orderEl?.querySelector('.order-status')?.textContent.trim() ?? orderEl?.textContent.trim() ?? null;
      return { iso, titel, beschrijving, genres, detailHref, orderHref, orderText };
    });
  });

  const buildId = createIdBuilder();
  const opgehaaldOp = new Date().toISOString();
  const shows = [];

  for (const item of rawItems) {
    if (!item.titel || !item.iso) continue;
    const datum = item.iso.slice(0, 10);
    const tijd = extractTime(item.iso.slice(11, 16));
    const detailUrl = item.detailHref ? new URL(item.detailHref, theater.baseUrl).toString() : theater.agendaUrl;
    const ticketUrl = item.orderHref && item.orderHref.trim() !== '' ? item.orderHref : null;

    shows.push({
      id: buildId(theater.id, item.titel, datum, tijd),
      titel: item.titel,
      theaterId: theater.id,
      theaterNaam: theater.naam,
      stad: theater.stad,
      podiumpas: theater.podiumpas,
      datum,
      tijd,
      genre: normalizeGenre(item.genres[0]),
      genreRuw: item.genres.join(', ') || null,
      beschikbaarheid: classifyBeschikbaarheid(item.orderText),
      beschrijving: item.beschrijving,
      reserverenUrl: ticketUrl ?? detailUrl,
      bron: theater.agendaUrl,
      opgehaaldOp,
    });
  }

  return shows;
}
