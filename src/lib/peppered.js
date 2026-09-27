// Gedeelde listing-logica voor theatersites op het Peppered-platform (zelfde
// platform als Bellevue/Frascati/De Kleine Komedie: <li data-entry-id> met
// class "eventCard", paginering via select.page-selection, robots.txt met
// "Disallow: /*?*" + "Allow: /*?page=*"). Gebruikt door de Zuid-Hollandse
// scrapers (HNT, Theater Rotterdam, Koningshof, …); de oudere Amsterdamse
// modules hebben hun eigen, beproefde variant en zijn bewust niet omgezet.

import { createDutchAbbrevDayParser } from './normalize.js';

const DEFAULT_MAX_LISTING_PAGES = 40;

const MONTHS = { jan: 1, feb: 2, mrt: 3, maa: 3, apr: 4, mei: 5, jun: 6, jul: 7, aug: 8, sep: 9, okt: 10, nov: 11, dec: 12 };

/**
 * Haalt alle kaarten van een agenda op, pagina voor pagina. Per kaart één
 * of meer "rijen" (speeldata): uit het datumpaneel (#show<id>Dates, met
 * locatie/zaal/knop per datum) of, zonder paneel, uit de kaart zelf.
 *
 * Gooit een exception als pagina 1 geen enkele agendakaart bevat: dan is
 * dit geen geldige agendapagina (site veranderd, blokkade), en moet het
 * vangnet terugvallen in plaats van stil [] op te leveren.
 */
export async function scrapePepperedListing({ page, theater, robots, waitForTurn, log, agendaPath, maxPages = DEFAULT_MAX_LISTING_PAGES }) {
  if (!robots.isAllowed(agendaPath)) {
    log(`robots.txt verbiedt ${agendaPath} op ${theater.baseUrl} — sla over.`);
    return [];
  }

  const cards = [];
  const seenEntryIds = new Set();
  let pageParam = 'page';
  let stoppedNormally = false;

  for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
    const url = pageNum === 1 ? theater.agendaUrl : `${theater.agendaUrl}?${pageParam}=${pageNum}`;
    const listingPath = pageNum === 1 ? agendaPath : `${agendaPath}?${pageParam}=${pageNum}`;
    if (!robots.isAllowed(listingPath)) {
      log(`robots.txt verbiedt ${listingPath} — stop met pagineren.`);
      stoppedNormally = true;
      break;
    }

    await waitForTurn();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    if (pageNum === 1) {
      pageParam = (await page.evaluate(() => document.querySelector('select.page-selection')?.getAttribute('name'))) || pageParam;
      log(`paginaparameter: ${pageParam}`);
    }
    const pageCards = await page.evaluate(extractCards);

    if (pageNum === 1 && pageCards.length === 0) {
      throw new Error(`geen agendakaarten op ${page.url()} — site veranderd of geblokkeerd?`);
    }
    const newCards = pageCards.filter((card) => {
      if (seenEntryIds.has(card.entryId)) return false;
      seenEntryIds.add(card.entryId);
      return true;
    });
    log(`pagina ${pageNum}: ${pageCards.length} kaarten (${newCards.length} nieuw)`);
    if (newCards.length === 0) {
      stoppedNormally = true;
      break;
    }
    cards.push(...newCards);
  }
  if (!stoppedNormally) {
    log(`WAARSCHUWING: bovengrens van ${maxPages} listingpagina's bereikt — paginering is waarschijnlijk stuk.`);
  }
  return cards;
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
 * Knoptekst → beschikbaarheid. null = rij overslaan: al geweest, geannuleerd
 * of afgelast, of verkoop elders (tournee).
 */
export function classifyPepperedButton(buttonText) {
  const t = (buttonText ?? '').trim().toLowerCase();
  if (!t) return 'onbekend';
  if (t.includes('geweest') || t.includes('geannuleerd') || t.includes('afgelast') || t.includes('verplaatst')) return null;
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
 * met een echte status boven "onbekend".
 */
export function dedupeShows(shows) {
  const byKey = new Map();
  for (const show of shows) {
    const key = `${show.theaterId}|${show.titel}|${show.datum}|${show.tijd}`;
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
