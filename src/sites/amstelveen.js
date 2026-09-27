import { extractTime, createIdBuilder } from '../lib/normalize.js';
import { normalizeGenre } from '../lib/genre.js';
import { THEATERS } from '../lib/config.js';
import { createGroupScraper } from '../lib/peppered.js';

const AGENDA_PATH = '/nl/theater/agenda/';
const MAX_LOAD_MORE_CLICKS = 40;

// Linkpad van een agenda-item → onze config-entry. Schouwburg Amstelveen en
// Theater De Landing staan op podiumpas.nl als twee locaties, maar delen één
// agenda op schouwburgamstelveen.nl.
const THEATER_ID_BY_SECTION = { theater: 'amstelveen', delanding: 'delanding' };
// Logo/label in de bestelknop, als controle op het linkpad.
const LOCATION_LABEL = { amstelveen: /schouwburg/i, delanding: /landing/i };

function classifyBeschikbaarheid(orderText) {
  const tekst = (orderText ?? '').trim().toLowerCase();
  if (tekst.includes('wachtlijst')) return 'wachtlijst';
  if (tekst.includes('uitverkocht')) return 'uitverkocht';
  if (tekst.includes('bestel') || tekst.includes('gratis') || tekst.includes('kaart') || tekst.includes('tickets'))
    return 'beschikbaar';
  return 'onbekend';
}

/**
 * Schouwburg Amstelveen + Theater De Landing: één gecombineerde agenda.
 *
 * Structuur (geïnspecteerd op https://schouwburgamstelveen.nl/nl/theater/agenda/,
 * aug/sep 2026):
 * - Geen robots.txt (404). Server-rendered lijst (.eventList-events > li)
 *   met een "Toon meer"-knop (.loadMore), 20 items per klik.
 * - Elk item heeft een machine-leesbare <time datetime="…">.
 * - Waar een voorstelling speelt, staat in het linkpad van het item
 *   (/nl/theater/… of /nl/delanding/…) en als logo in de bestelknop
 *   (.order-location img alt="Theater De Landing"). Het linkpad is leidend;
 *   een afwijkend logo wordt gelogd. Items met een ander pad (bv.
 *   /nl/cinema/, films) vallen weg, net als voorheen de class "cinema".
 * - Sinds seizoen 26-27 is de Schouwburg dicht wegens verbouwing (heropening
 *   december 2027, https://schouwburgamstelveen.nl/nl/theater/over-ons/verbouwing-cultuurstrip/):
 *   alle voorstellingen staan dan onder /nl/delanding/ en de Schouwburg
 *   levert 0 op. Na de heropening verschijnen /nl/theater/-items vanzelf
 *   weer bij de Schouwburg.
 * - Eén scrape per run vult beide config-entries (createGroupScraper).
 *   Vroeger scrapeten beide entries dezelfde lijst, waardoor elke
 *   voorstelling bij allebei stond (148 dubbelingen, sep 2026).
 */
async function scrapeAllAmstelveen({ page, robots, waitForTurn, log }) {
  const theatersById = Object.fromEntries(THEATERS.map((t) => [t.id, t]));
  const base = theatersById.amstelveen;
  if (!robots.isAllowed(AGENDA_PATH)) {
    log(`robots.txt verbiedt ${AGENDA_PATH} op ${base.baseUrl} — sla over.`);
    return [];
  }

  await waitForTurn();
  await page.goto(base.agendaUrl, { waitUntil: 'networkidle', timeout: 30000 });
  if ((await page.locator('.eventList-events').count()) === 0) {
    throw new Error(`geen .eventList-events op ${page.url()} — site veranderd?`);
  }

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

  const rawItems = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.eventList-events > li')).map((li) => {
      const orderEl = li.querySelector('.eventOrder a, .eventOrder button, .eventOrder span');
      const locationEl = li.querySelector('.order-location');
      return {
        iso: li.querySelector('time.eventList-dateTime')?.getAttribute('datetime') ?? null,
        titel: li.querySelector('.eventList-title')?.textContent.trim() ?? null,
        beschrijving: li.querySelector('.eventList-slogan')?.textContent.trim() ?? null,
        genres: Array.from(li.querySelectorAll('.eventList-tags li')).map((t) => t.textContent.trim()),
        detailHref: li.querySelector('a.eventList-detailLink')?.getAttribute('href') ?? null,
        orderHref: orderEl?.getAttribute('href') ?? null,
        orderText: orderEl?.querySelector('.order-status')?.textContent.trim() ?? orderEl?.textContent.trim() ?? null,
        locationLabel: locationEl?.querySelector('img')?.getAttribute('alt') ?? locationEl?.textContent.trim() ?? null,
      };
    })
  );

  const buildIds = { amstelveen: createIdBuilder(), delanding: createIdBuilder() };
  const opgehaaldOp = new Date().toISOString();
  const shows = [];
  const skipped = {};

  for (const item of rawItems) {
    if (!item.titel || !item.iso) continue;
    const section = item.detailHref ? new URL(item.detailHref, base.baseUrl).pathname.split('/')[2] : null;
    const theaterId = THEATER_ID_BY_SECTION[section];
    if (!theaterId) {
      const key = section ?? '(geen link)';
      skipped[key] = (skipped[key] ?? 0) + 1;
      continue;
    }
    // Het logo is de controle; "GEANNULEERD" e.d. staat op dezelfde plek.
    if (item.locationLabel && /schouwburg|landing/i.test(item.locationLabel) && !LOCATION_LABEL[theaterId].test(item.locationLabel)) {
      log(`let op: "${item.titel}" linkt naar /${section}/ maar het logo zegt "${item.locationLabel}" — linkpad aangehouden.`);
    }
    const target = theatersById[theaterId];
    const datum = item.iso.slice(0, 10);
    const tijd = extractTime(item.iso.slice(11, 16));
    const detailUrl = new URL(item.detailHref, base.baseUrl).toString();
    const ticketUrl = item.orderHref && item.orderHref.trim() !== '' ? item.orderHref : null;
    shows.push({
      id: buildIds[theaterId](theaterId, item.titel, datum, tijd),
      titel: item.titel,
      theaterId,
      theaterNaam: target.naam,
      stad: target.stad,
      podiumpas: target.podiumpas,
      datum,
      tijd,
      genre: normalizeGenre(item.genres[0]),
      genreRuw: item.genres.join(', ') || null,
      beschikbaarheid: classifyBeschikbaarheid(item.orderText),
      beschrijving: item.beschrijving,
      reserverenUrl: ticketUrl ?? detailUrl,
      bron: target.agendaUrl,
      opgehaaldOp,
    });
  }

  const skippedList = Object.entries(skipped);
  if (skippedList.length > 0) log(`overgeslagen (geen Schouwburg/De Landing): ${skippedList.map(([k, n]) => `${k} (${n})`).join(', ')}`);
  log(`Schouwburg: ${shows.filter((s) => s.theaterId === 'amstelveen').length}, De Landing: ${shows.filter((s) => s.theaterId === 'delanding').length}`);
  return shows;
}

export const scrapeAmstelveenGroep = createGroupScraper(scrapeAllAmstelveen);
