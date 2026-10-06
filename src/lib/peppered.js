// Gedeelde listing-logica voor theatersites op het Peppered-platform (zelfde
// platform als Bellevue/Frascati/De Kleine Komedie: <li data-entry-id> met
// class "eventCard", paginering via select.page-selection, robots.txt met
// "Disallow: /*?*" + "Allow: /*?page=*"). Gebruikt door de Zuid-Hollandse
// scrapers (HNT, Theater Rotterdam, Koningshof, …); de oudere Amsterdamse
// modules hebben hun eigen, beproefde variant en zijn bewust niet omgezet.

import { createDutchAbbrevDayParser } from './normalize.js';
import { vervallenStatus, isVervallen } from './beschikbaarheid.js';

const DEFAULT_MAX_LISTING_PAGES = 40;

const MONTHS = { jan: 1, feb: 2, mrt: 3, maa: 3, apr: 4, mei: 5, jun: 6, jul: 7, aug: 8, sep: 9, okt: 10, nov: 11, dec: 12 };

/**
 * Gedeelde paginering voor agenda's met ?<parameter>=N — het Peppered-
 * platform (Bellevue, Frascati, Kleine Komedie, Muziekgebouw, De Omval,
 * Bijlmer Parktheater, HNT, …) en een paar sites met hetzelfde patroon.
 *
 * Waarom één plek: het platform veranderde in sep 2026 de parameter van
 * "page" naar "p54_page" (naar een CMS-paginaonderdeel). ?page=N gaf daarna
 * steeds pagina 1; bij Muziekgebouw en Omval gaf dat 30 kopieën, bij
 * Bijlmer Parktheater speeldata tot 2085. Daarom:
 * - de parameternaam wordt van pagina 1 afgelezen (select.page-selection),
 *   tenzij `leesParameter` false is; robots.txt wordt per URL gecheckt;
 * - we stoppen zodra een pagina geen enkel nieuw item oplevert (volgens
 *   `sleutelVan`), niet pas bij een lege pagina — voorbij de laatste pagina
 *   toont het platform soms gewoon weer dezelfde kaarten;
 * - de bovengrens `maxPages` geeft een WAARSCHUWING (via warn, dus ook als
 *   ::warning:: in de run): dan is de paginering vrijwel zeker stuk.
 *
 * `extract` draait in de browser (page.evaluate) en geeft de items van één
 * pagina. Pagina 1 niet te laden → exception (het vangnet valt terug);
 * een latere pagina → loggen en door. `leegIsFout`: gooi als pagina 1 geen
 * items heeft (site veranderd of geblokkeerd). Geeft alleen nieuwe items.
 */
export async function pagineerListing({
  page,
  theater,
  robots,
  waitForTurn,
  log,
  warn = log,
  agendaPath,
  extract,
  sleutelVan,
  maxPages = DEFAULT_MAX_LISTING_PAGES,
  parameter = 'page',
  leesParameter = true,
  leegIsFout = false,
  label = 'items',
}) {
  const items = [];
  const gezien = new Set();
  let pageParam = parameter;
  let normaalGestopt = false;

  for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
    const url = pageNum === 1 ? theater.agendaUrl : `${theater.agendaUrl}?${pageParam}=${pageNum}`;
    const listingPath = pageNum === 1 ? agendaPath : `${agendaPath}?${pageParam}=${pageNum}`;
    if (!robots.isAllowed(listingPath)) {
      log(`robots.txt verbiedt ${listingPath} — stop met pagineren.`);
      normaalGestopt = true;
      break;
    }

    await waitForTurn();
    let pageItems;
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      if (pageNum === 1 && leesParameter) {
        pageParam =
          (await page.evaluate(() => document.querySelector('select.page-selection')?.getAttribute('name'))) || pageParam;
        log(`paginaparameter: ${pageParam}`);
      }
      pageItems = await page.evaluate(extract);
    } catch (err) {
      if (pageNum === 1) throw err;
      log(`kon listingpagina ${pageNum} niet laden: ${err.message} — probeer volgende pagina.`);
      continue;
    }

    if (pageNum === 1 && leegIsFout && pageItems.length === 0) {
      throw new Error(`geen agendakaarten op ${page.url()} — site veranderd of geblokkeerd?`);
    }
    const nieuw = pageItems.filter((item) => {
      const sleutel = sleutelVan(item);
      if (gezien.has(sleutel)) return false;
      gezien.add(sleutel);
      return true;
    });
    log(`pagina ${pageNum}: ${pageItems.length} ${label} (${nieuw.length} nieuw)`);
    if (nieuw.length === 0) {
      normaalGestopt = true;
      break;
    }
    items.push(...nieuw);
  }
  if (!normaalGestopt) {
    warn(`bovengrens van ${maxPages} listingpagina's bereikt zonder einde van de agenda — paginering is waarschijnlijk stuk.`);
  }
  return items;
}

/**
 * Haalt alle kaarten van een agenda op, pagina voor pagina. Per kaart één
 * of meer "rijen" (speeldata): uit het datumpaneel (#show<id>Dates, met
 * locatie/zaal/knop per datum) of, zonder paneel, uit de kaart zelf.
 *
 * Gooit een exception als pagina 1 geen enkele agendakaart bevat: dan is
 * dit geen geldige agendapagina (site veranderd, blokkade), en moet het
 * vangnet terugvallen in plaats van stil [] op te leveren.
 */
export async function scrapePepperedListing({ page, theater, robots, waitForTurn, log, warn, agendaPath, maxPages = DEFAULT_MAX_LISTING_PAGES }) {
  if (!robots.isAllowed(agendaPath)) {
    log(`robots.txt verbiedt ${agendaPath} op ${theater.baseUrl} — sla over.`);
    return [];
  }
  return pagineerListing({
    page,
    theater,
    robots,
    waitForTurn,
    log,
    warn,
    agendaPath,
    maxPages,
    extract: extractCards,
    sleutelVan: (card) => card.entryId,
    leegIsFout: true,
    label: 'kaarten',
  });
}

/**
 * Speeldata van een productiepagina: elke li.subshow met data-event-start
 * ("2026-10-08 20:00:00", met jaartal). Voor kaarten die op de lijstpagina
 * een reeks samenvatten zonder tijd ("wo 7 okt en do 8 okt"): daar staat
 * alleen de eerste datum op de kaart (Bijlmer Parktheater en De Omval, sep
 * 2026). Geeft [{ datum, tijd, knopTekst, knopClass, href }] of null als de
 * pagina niet mag of niet laadt; "Geweest"-rijen vallen weg.
 */
export async function leesSpeeldataVanDetail({ page, url, robots, waitForTurn, log }) {
  if (!robots.isAllowed(new URL(url).pathname)) return null;
  await waitForTurn();
  let rijen;
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    rijen = await page.evaluate(() =>
      [...document.querySelectorAll('li.subshow')]
        .map((li) => {
          const start = li.querySelector('[data-event-start]')?.getAttribute('data-event-start');
          if (!start) return null;
          const box = li.querySelector('.buttonBox');
          const knop = box?.querySelector('a, button, span');
          return {
            start,
            knopTekst: box?.textContent.replace(/\s+/g, ' ').trim() || null,
            knopClass: knop?.className ?? null,
            href: knop?.getAttribute('href') ?? null,
          };
        })
        .filter(Boolean)
    );
  } catch (err) {
    log(`kon productiepagina niet laden (${url}): ${err.message}`);
    return null;
  }
  const gezien = new Set();
  const uit = [];
  for (const r of rijen) {
    if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(r.start) || gezien.has(r.start)) continue;
    gezien.add(r.start);
    if (/geweest/i.test(r.knopTekst ?? '')) continue;
    const tijd = r.start.slice(11, 16);
    uit.push({ datum: r.start.slice(0, 10), tijd: tijd === '00:00' ? null : tijd, knopTekst: r.knopTekst, knopClass: r.knopClass, href: r.href });
  }
  return uit;
}

// Draait in de browser (page.evaluate) — geen verwijzingen naar Node-scope.
function extractCards() {
  const text = (el) => el?.textContent.trim().replace(/\s+/g, ' ') || null;
  // Alleen echte knoppen/statuslabels — niet het eerste het beste <span>
  // (dat was soms de tijd, "20:15").
  const BUTTON_SELECTOR =
    'a.btn-order, a.btn:not(.mobile-button), button.btn:not(.expand-sub), span.btn, [class*="status-"]';
  const button = (box) => box?.querySelector(BUTTON_SELECTOR) ?? null;

  return [...document.querySelectorAll('li[data-entry-id]')].map((card) => {
    const entryId = card.getAttribute('data-entry-id');
    const typeClass = [...card.classList].find((c) => c.startsWith('production-type-'));
    const panel = document.getElementById(`show${entryId}Dates`);
    const subshows = panel
      ? [...panel.querySelectorAll('li.subshow')].filter(
          (li) => !li.classList.contains('location-group-toggle-wrapper') && !li.classList.contains('load-more-panel')
        )
      : [];

    let rows;
    if (subshows.length > 0) {
      rows = subshows.map((li) => {
        const box = li.querySelector('.buttonBox');
        const btn = button(box);
        return {
          ownLocation: li.classList.contains('in-own-location') ? true : li.classList.contains('in-other-location') ? false : null,
          start: li.querySelector('[data-event-start]')?.getAttribute('data-event-start') || null,
          dateText: text(li.querySelector('.date .start')),
          timeText: text(li.querySelector('.time .start')),
          location: text(li.querySelector('.location')),
          venue: text(li.querySelector('.venue')),
          buttonText: text(btn) ?? text(box),
          buttonHref: btn?.getAttribute('href') ?? null,
        };
      });
    } else {
      // Twee varianten zonder paneel: HNT/Koningshof zetten datum en knop in
      // .dateTimeInner, TR in de kaart zelf (.top-date + .meta-group.button).
      const inner = card.querySelector('.dateTimeInner');
      const btn = card.querySelector('a.btn-order') ?? card.querySelector('.meta-group.button a') ?? button(inner) ?? button(card);
      rows = [
        {
          ownLocation: null,
          start: card.querySelector('[data-event-start]')?.getAttribute('data-event-start') || null,
          dateText: text(inner?.querySelector('.date .start')) ?? text(card.querySelector('.desc .top-date .start')),
          timeText: text(inner?.querySelector('.time .start')) ?? text(card.querySelector('.desc .top-date .time')),
          location: btn?.getAttribute('data-event-location') ?? text(card.querySelector('.desc .location')),
          venue: btn?.getAttribute('data-event-hall') ?? text(card.querySelector('.desc .venue')),
          buttonText: text(btn),
          buttonHref: btn?.getAttribute('href') ?? null,
        },
      ];
    }

    return {
      entryId,
      productionType: typeClass ? typeClass.replace('production-type-', '') : null,
      titel: text(card.querySelector('h3.title')),
      subtitle: text(card.querySelector('.subtitle')),
      tagline: text(card.querySelector('.tagline')),
      detailHref: card.querySelector('a.desc')?.getAttribute('href') ?? null,
      genres: [...card.querySelectorAll('.genres__link')].map((a) => a.textContent.trim()),
      priceText: text(card.querySelector('.price')),
      rows,
    };
  });
}

/**
 * Datum + tijd van een rij. Voorkeur: data-event-start ("2026-09-29
 * 20:15:00", met jaartal). Anders de zichtbare tekst: "zo 27 sep 2026",
 * "27 sep ’26" of "30 sep" (dan jaar-rollover via de parser).
 */
export function createRowDateResolver(referenceDate = new Date()) {
  const rollover = createDutchAbbrevDayParser(referenceDate);
  return function resolve(row) {
    if (row.start && /^\d{4}-\d{2}-\d{2}/.test(row.start)) {
      const time = row.start.slice(11, 16);
      return { datum: row.start.slice(0, 10), tijd: /^\d{2}:\d{2}$/.test(time) && time !== '00:00' ? time : extractHhmm(row.timeText) };
    }
    if (!row.dateText) return null;
    const m = row.dateText.toLowerCase().match(/(\d{1,2})\s+([a-z]{3})[a-z.]*\s*(?:[’'](\d{2})|(\d{4}))?/);
    if (!m || !MONTHS[m[2]]) return null;
    const year = m[4] ? Number(m[4]) : m[3] ? 2000 + Number(m[3]) : null;
    const datum = year
      ? `${year}-${String(MONTHS[m[2]]).padStart(2, '0')}-${String(Number(m[1])).padStart(2, '0')}`
      : rollover(`${m[1]} ${m[2]}`);
    return datum ? { datum, tijd: extractHhmm(row.timeText) } : null;
  };
}

function extractHhmm(text) {
  const m = text?.match(/(\d{1,2})[:.](\d{2})/);
  return m ? `${m[1].padStart(2, '0')}:${m[2]}` : null;
}

/**
 * Knoptekst → beschikbaarheid. null = rij overslaan: al geweest, of verkoop
 * elders (tournee). Geannuleerd/afgelast/verplaatst → "afgelast" of
 * "verplaatst" (tot 30 sep 2026 werden die overgeslagen).
 */
export function classifyPepperedButton(buttonText) {
  const t = (buttonText ?? '').trim().toLowerCase();
  if (!t) return 'onbekend';
  if (t.includes('geweest')) return null;
  const vervallen = vervallenStatus(t);
  if (vervallen) return vervallen;
  if (t.includes('verkoop elders') || t.includes('via theater')) return null;
  if (t.includes('uitverkocht') || t.includes('volgeboekt')) return 'uitverkocht';
  if (t.includes('wachtlijst')) return 'wachtlijst';
  if (t.includes('kaarten') || t.includes('tickets') || t.includes('bestel') || t.includes('aanmelden') || t.includes('gratis') || t.includes('losse plekken')) return 'beschikbaar';
  return 'onbekend';
}

/**
 * Eén show per theater + titel + datum + tijd. HNT zet toegankelijke
 * varianten (LiveText-bril, audiodescriptie, tolk) als aparte rij bij
 * dezelfde voorstelling; die tellen niet dubbel. Bij twee rijen wint die
 * met een echte status boven "onbekend". Een afgelaste en een gewone rij
 * blijven allebei staan (zie dubbelSleutel in dedupe.js).
 */
export function dedupeShows(shows) {
  const byKey = new Map();
  for (const show of shows) {
    const key = `${show.theaterId}|${show.titel}|${show.datum}|${show.tijd}|${isVervallen(show) ? 'vervallen' : ''}`;
    const existing = byKey.get(key);
    if (!existing || (existing.beschikbaarheid === 'onbekend' && show.beschikbaarheid !== 'onbekend')) {
      byKey.set(key, { ...show, id: existing?.id ?? show.id });
    }
  }
  return [...byKey.values()];
}

/** Logt de knopteksten die op "onbekend" uitkwamen (nieuwe teksten opsporen). */
export function logUnknownButtons(log, shows, rowsByShowId) {
  const texts = {};
  for (const show of shows) {
    if (show.beschikbaarheid !== 'onbekend') continue;
    const t = rowsByShowId.get(show.id)?.buttonText ?? '(geen knop)';
    texts[t] = (texts[t] ?? 0) + 1;
  }
  const list = Object.entries(texts);
  if (list.length > 0) log(`knopteksten → onbekend: ${list.map(([t, n]) => `"${t}" (${n})`).join(', ')}`);
}

/**
 * Eén scrape per run voor meerdere config-entries (bv. de drie HNT-zalen):
 * de eerste aanroep draait `scrapeAll`, de rest wacht op dezelfde promise.
 * Elke aanroep krijgt alleen de shows van zijn eigen theaterId terug. Faalt
 * of hangt de scrape, dan falen alle leden (en valt elk terug via het
 * vangnet in scrapeRun.js).
 */
export function createGroupScraper(scrapeAll) {
  let pending = null;
  return async function groupMember(ctx) {
    if (!pending) {
      pending = scrapeAll(ctx);
      pending.catch(() => {});
    } else {
      ctx.log('gedeelde scrape van de groep hergebruikt');
    }
    const shows = await pending;
    return shows.filter((show) => show.theaterId === ctx.theater.id);
  };
}

/** Laagste €-bedrag in een prijstekst ("Rang 1 Normaal € 39,-", "€ 15,-–€ 20,-"), of null. */
export function laagstePrijs(tekst) {
  const bedragen = [...String(tekst ?? '').matchAll(/€\s*(\d+)(?:[,.](\d{2}|-))?/g)].map((m) => Number(`${m[1]}.${/\d{2}/.test(m[2] ?? '') ? m[2] : '00'}`));
  return bedragen.length ? Math.min(...bedragen) : null;
}
