import { extractTime, createIdBuilder } from '../lib/normalize.js';
import { normalizeGenre } from '../lib/genre.js';
import { THEATERS } from '../lib/config.js';
import { createGroupScraper } from '../lib/peppered.js';
import { pasTitelConventieToe } from '../lib/titels.js';

const AGENDA_PATH = '/nl/theater/agenda/';
const MAX_LOAD_MORE_CLICKS = 40;

// Linkpad van een agenda-item → onze config-entry. Schouwburg Amstelveen en
// Theater De Landing staan op podiumpas.nl als twee locaties, maar delen één
// agenda op schouwburgamstelveen.nl.
const THEATER_ID_BY_SECTION = { theater: 'amstelveen', delanding: 'delanding' };
// Logo/label in de bestelknop, als controle op het linkpad.
const LOCATION_LABEL = { amstelveen: /schouwburg/i, delanding: /landing/i };

// Podiumpas bij De Landing. Bron: https://schouwburgamstelveen.nl/nl/theater/je-bezoek/kaartverkoop/podiumpas/
// (27 sep 2026): "Verhuringen, eigen producties, films, voorstellingen die te
// gast zijn of voorstellingen die duurder zijn dan 50 euro, zijn uitgesloten.
// Bij deze voorstellingen vind je het prijstype Podiumpas dan ook niet terug."
// Dat prijstype staat pas in het Ticketmatic-widget vanaf 30 dagen voor de
// voorstelling (reserveren kan vanaf dan), en verdwijnt bij wachtlijst/
// uitverkocht. Daarom:
// - bestellink naar een derde partij (bv. patronstage.com) → false, altijd;
// - binnen 29 dagen (zie WIDGET_WINDOW_DAYS), beschikbaar, widget goed geladen: geen Podiumpas-
//   prijstype of laagste reguliere prijs > €50 → false, anders true;
// - wachtlijst/uitverkocht, verder dan 30 dagen, of widget niet te laden →
//   true (een mislukte check maakt nooit false; wordt gelogd).
// Omslaan is dus normaal: een voorstelling kan binnen 30 dagen van true naar
// false gaan zodra het widget laat zien dat de pas er niet geldt. Dat is geen
// bug. Na de heropening van de Schouwburg gelden deze regels ook daar.
const PODIUMPAS_PRICE_CEILING = 50;
// 29 i.p.v. 30: het prijstype verschijnt precies 30 dagen vóór het
// aanvangstijdstip, dus op de randdag (bv. 's middags voor een voorstelling
// om 20:15 over 30 dagen) ontbreekt het nog terwijl dat niets zegt.
const WIDGET_WINDOW_DAYS = 29;
const EIGEN_HOSTS = [/(^|\.)ticketmatic\.com$/, /(^|\.)schouwburgamstelveen\.nl$/];

/** Leest de tekst van het Ticketmatic-widget. */
export function parseLandingWidget(text) {
  const lines = (text ?? '').split('\n').map((l) => l.trim()).filter(Boolean);
  const leesbaar = lines.some((l) => /kies aantal tickets|voeg ticket toe/i.test(l));
  const heeftPodiumpas = lines.some((l) => /^podium ?pas$/i.test(l));
  const regulier = [];
  lines.forEach((line, i) => {
    if (!/^(rang\s*\d+\s*[-–]?\s*)?(normaal|regulier|standaard)\b/i.test(line)) return;
    const m = (lines[i + 1] ?? '').match(/€\s*(\d+(?:\.\d{3})*),(\d{2})/);
    if (m) regulier.push(parseFloat(`${m[1].replace(/\./g, '')}.${m[2]}`));
  });
  return { leesbaar, heeftPodiumpas, laagsteRegulier: regulier.length ? Math.min(...regulier) : null };
}

/**
 * Podiumpas voor één De Landing-voorstelling. `widget` is null als het niet
 * bezocht is, { fout } als laden mislukte, anders parseLandingWidget(...).
 * Geeft { podiumpas, reden } terug.
 */
export function bepaalLandingPodiumpas({ orderHref, beschikbaarheid, widget }) {
  if (orderHref && /^https?:/.test(orderHref)) {
    const host = new URL(orderHref).hostname;
    if (!EIGEN_HOSTS.some((re) => re.test(host))) return { podiumpas: false, reden: `verkoop via ${host}` };
  }
  if (!widget || beschikbaarheid !== 'beschikbaar') return { podiumpas: true, reden: null };
  if (widget.fout || !widget.leesbaar) return { podiumpas: true, reden: null };
  if (widget.laagsteRegulier != null && widget.laagsteRegulier > PODIUMPAS_PRICE_CEILING) {
    return { podiumpas: false, reden: `prijs €${widget.laagsteRegulier}` };
  }
  if (!widget.heeftPodiumpas) return { podiumpas: false, reden: 'geen Podiumpas-prijstype' };
  return { podiumpas: true, reden: null };
}

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
        // Voorstellingsnaam: h4.eventList-subTitle onder de titel.
        voorstelling: li.querySelector('.eventList-subTitle')?.textContent.trim() || null,
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
    shows.push(pasTitelConventieToe({
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
      _orderHref: ticketUrl,
    }, { artiest: item.titel, voorstelling: item.voorstelling }));
  }

  // Podiumpas per De Landing-voorstelling (zie bepaalLandingPodiumpas).
  const grens = new Date(Date.now() + WIDGET_WINDOW_DAYS * 864e5).toISOString().slice(0, 10);
  const widgets = new Map();
  const redenen = {};
  let bezocht = 0;
  for (const show of shows) {
    if (show.theaterId !== 'delanding') continue;
    const orderHref = show._orderHref;
    let widget = null;
    const visit =
      show.datum <= grens && show.beschikbaarheid === 'beschikbaar' && orderHref && /ticketmatic\.com/.test(new URL(orderHref).hostname);
    if (visit) {
      if (!widgets.has(orderHref)) {
        let result;
        try {
          await waitForTurn();
          await page.goto(orderHref, { waitUntil: 'networkidle', timeout: 30000 });
          await page.waitForSelector('text=/Voeg ticket toe|Kies aantal tickets/i', { timeout: 10000 }).catch(() => {});
          const texts = [];
          for (const frame of page.frames()) {
            texts.push(await frame.evaluate(() => document.body?.innerText ?? '').catch(() => ''));
          }
          result = parseLandingWidget(texts.join('\n'));
          bezocht++;
          if (!result.leesbaar) log(`widget onleesbaar voor "${show.titel}" (${show.datum}) — podiumpas blijft true.`);
        } catch (err) {
          if (err?.name === 'ScrapeTimeoutError') throw err;
          result = { fout: err.message.split('\n')[0] };
          log(`widget niet te laden voor "${show.titel}" (${show.datum}): ${result.fout} — podiumpas blijft true.`);
        }
        widgets.set(orderHref, result);
      }
      widget = widgets.get(orderHref);
    }
    const { podiumpas, reden } = bepaalLandingPodiumpas({ orderHref, beschikbaarheid: show.beschikbaarheid, widget });
    show.podiumpas = show.podiumpas && podiumpas;
    if (reden) redenen[reden] = (redenen[reden] ?? 0) + 1;
  }
  for (const show of shows) delete show._orderHref;
  const landing = shows.filter((s) => s.theaterId === 'delanding');
  log(`De Landing podiumpas: ${landing.filter((s) => s.podiumpas).length} true, ${landing.filter((s) => !s.podiumpas).length} false (${Object.entries(redenen).map(([r, n]) => `${r}: ${n}`).join(', ') || 'geen uitsluitingen'}); ${bezocht} widgets bekeken`);

  const skippedList = Object.entries(skipped);
  if (skippedList.length > 0) log(`overgeslagen (geen Schouwburg/De Landing): ${skippedList.map(([k, n]) => `${k} (${n})`).join(', ')}`);
  log(`Schouwburg: ${shows.filter((s) => s.theaterId === 'amstelveen').length}, De Landing: ${shows.filter((s) => s.theaterId === 'delanding').length}`);
  return shows;
}

export const scrapeAmstelveenGroep = createGroupScraper(scrapeAllAmstelveen);
