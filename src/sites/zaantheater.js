import { extractTime, createIdBuilder } from '../lib/normalize.js';
import { normalizeGenreFromList } from '../lib/genre.js';

const AGENDA_PATH = '/nl/theater/agenda/';
const MAX_LOAD_MORE_CLICKS = 40;

function classifyBeschikbaarheid(orderText) {
  const tekst = (orderText ?? '').trim().toLowerCase();
  if (tekst.includes('wachtlijst')) return 'wachtlijst';
  if (tekst.includes('uitverkocht')) return 'uitverkocht';
  if (
    tekst.includes('bestel') ||
    tekst.includes('gratis') ||
    tekst.includes('kaart') ||
    tekst.includes('tickets') ||
    tekst.includes('externe verkoop')
  )
    return 'beschikbaar';
  return 'onbekend';
}

/**
 * Haalt de volledige agenda van Zaantheater op.
 *
 * Zelfde eventList-events platform als Schouwburg Amstelveen en De Landing,
 * met een paar afwijkingen t.o.v. die twee (zie amstelveen.js/delanding.js
 * voor de basisstructuur):
 * - Geen robots.txt (404) — geen crawl-delay, standaard-minimum vertraging.
 * - .eventList-tags bevat een extra, tekstloze eerste <li> (alleen een
 *   fontawesome-icoontje) vóór het echte genre-label — genres[0] pakken
 *   zoals bij Amstelveen zou dus een lege string opleveren. We filteren
 *   lege tags eruit en gebruiken normalizeGenreFromList() (zelfde aanpak
 *   als De Kleine Komedie) zodat een eventuele extra thema-tag vóór het
 *   genre ("Theater in de middag") ook geen probleem is.
 * - Twee knoppen in .eventOrder: .eventOrder--secondary ("meer info",
 *   interne detaillink) en .eventOrder--main (de echte boekingsknop, met
 *   tekst "Bestel"/"Uitverkocht"/"Externe verkoop"). Alleen .eventOrder--main
 *   is relevant voor boekingsstatus en -link.
 * - .eventList-events bevat ook een niet-voorstelling <li> zonder class
 *   (een leeg-verlanglijstje-fragment) — class="theatre" filtert die eruit.
 */
export async function scrapeZaantheater({ page, theater, robots, waitForTurn, log }) {
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
    return Array.from(document.querySelectorAll('.eventList-events > li.theatre')).map((li) => {
      const iso = li.querySelector('time.eventList-dateTime')?.getAttribute('datetime') ?? null;
      const titel = li.querySelector('.eventList-title')?.textContent.trim() ?? null;
      const beschrijving = li.querySelector('.eventList-slogan')?.textContent.trim() ?? null;
      const genres = Array.from(li.querySelectorAll('.eventList-tags li'))
        .map((t) => t.textContent.trim())
        .filter(Boolean);
      const detailHref = li.querySelector('a.eventList-detailLink')?.getAttribute('href') ?? null;
      const mainBtn = li.querySelector('.eventOrder--main');
      const orderHref = mainBtn?.getAttribute('href') ?? null;
      const orderText = mainBtn?.textContent.trim() ?? null;
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
      genre: normalizeGenreFromList(item.genres),
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
