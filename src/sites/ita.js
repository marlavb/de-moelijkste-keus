import { createNumericDayParser, extractTime, createIdBuilder } from '../lib/normalize.js';
import { normalizeGenre } from '../lib/genre.js';

const AGENDA_PATH = '/nl/agenda-stadsschouwburg';
const MAX_LISTING_PAGES = 30;

// Knopteksten op de agendapagina (aria-label "button: <tekst>"). "Laatste
// kaarten" en "Gratis aanmelden" zijn gewoon te boeken, dus beschikbaar.
function classifyBeschikbaarheid(knopTekst) {
  const tekst = (knopTekst ?? '').trim().toLowerCase();
  if (tekst.includes('uitverkocht')) return 'uitverkocht';
  if (tekst.includes('wachtlijst')) return 'wachtlijst';
  if (tekst.includes('kaarten') || tekst.includes('aanmelden')) return 'beschikbaar';
  return 'onbekend';
}
const KNOWN_KNOP_TEKSTEN = ['koop kaarten', 'laatste kaarten', 'gratis aanmelden', 'uitverkocht', 'contact educatie'];

// Schoolvoorstellingen (tag "Schoolvoorstelling", knop "Contact Educatie"
// naar een aanvraagformulier voor scholen, overdag) zijn niet te boeken
// door een gewone bezoeker — die laten we weg. De publieksvoorstellingen
// van dezelfde productie staan er gewoon los naast.
function isSchoolvoorstelling(item) {
  return item.tags.includes('schoolvoorstelling') || (item.knopTekst ?? '').toLowerCase() === 'contact educatie';
}

/**
 * Haalt de agenda van ITA (Internationaal Theater Amsterdam) op.
 *
 * Structuur (geïnspecteerd op https://ita.nl/nl/agenda-stadsschouwburg,
 * sep 2026 — de site is toen vernieuwd; /nl/agenda/ redirect hierheen):
 * - Dit is de agenda van de Stadsschouwburg (alle zalen, ook de Rabozaal).
 *   ITA op tournee buiten Amsterdam staat op een aparte pagina (/nl/on-tour)
 *   en hoort bewust niet in onze data.
 * - Server-rendered (Nuxt), 32 voorstellingen per pagina, gepagineerd via
 *   ?page=N met een <a rel="next">-link (de "Meer laden"-knop laadt
 *   dezelfde pagina's). De site noemt het totaal zelf: "Bekijk N resultaten".
 * - Elke voorstelling is een .OverviewListItem met titel + link naar de
 *   productiepagina (h3.event-title a), maker/gezelschap (p.subtitle),
 *   datum ("27.09") en tijd ("15:30 - 16:35") in .info, genre (p.genres),
 *   zaal (de laatste <p> in .btn-info) en een boekingsknop waarvan het
 *   aria-label de status geeft ("button: Koop kaarten", "Uitverkocht", …).
 *   Een dagkop ("Zo 27.09") gaat aan de items van die dag vooraf. Tags
 *   (.tag) zoals "Try-out", "Nagesprek" en "Schoolvoorstelling" staan bij
 *   het item; schoolvoorstellingen slaan we over (zie isSchoolvoorstelling).
 * - Anders dan de oude site staat alles op de agendapagina zelf, dus geen
 *   detailpagina-bezoeken meer.
 * - Sanity check: ontbreekt de lijst of de resultatenteller, dan is dit geen
 *   geldige agendapagina (zoals na de redesign van sep 2026, toen de oude
 *   scraper stilletjes 0 teruggaf) en gooien we een exception, zodat het
 *   vangnet in scrapeRun.js terugvalt. Een echt lege agenda heeft wél een
 *   teller ("0 resultaten").
 */
export async function scrapeIta({ page, theater, robots, waitForTurn, log }) {
  if (!robots.isAllowed(AGENDA_PATH)) {
    log(`robots.txt verbiedt ${AGENDA_PATH} op ${theater.baseUrl} — sla over.`);
    return [];
  }

  const items = [];
  const seenKeys = new Set();
  let expectedTotal = null;
  let url = theater.agendaUrl;
  let stoppedNormally = false;

  for (let pageNum = 1; pageNum <= MAX_LISTING_PAGES; pageNum++) {
    const listingPath = new URL(url).pathname + new URL(url).search;
    if (!robots.isAllowed(listingPath)) {
      log(`robots.txt verbiedt ${listingPath} — stop met pagineren.`);
      stoppedNormally = true;
      break;
    }

    // Eén herpoging per pagina: op 27 sep liep één keer pagina 2 tegen de
    // time-out van 30 s (pagina 1 laadde in 1 s), waardoor de hele scrape
    // faalde. Een tweede mislukte poging gooit gewoon door (vangnet).
    for (let poging = 1; ; poging++) {
      await waitForTurn();
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        break;
      } catch (err) {
        if (poging >= 2 || err?.name === 'ScrapeTimeoutError') throw err;
        log(`pagina ${pageNum} laden mislukt (${err.message.split('\n')[0]}) — nog één poging.`);
      }
    }
    const result = await page.evaluate(() => {
      const wrapper = document.querySelector('.events-wrapper');
      const totalLabel = [...document.querySelectorAll('[aria-label]')]
        .map((el) => el.getAttribute('aria-label'))
        .find((label) => /Bekijk \d+ resultaten?$/.test(label));
      const next = document.querySelector('a[rel="next"]')?.getAttribute('href') ?? null;
      if (!wrapper) return { valid: false, totalLabel, next, items: [] };

      const items = [];
      let dayLabel = null;
      for (const el of wrapper.querySelectorAll('.event-day-header, .OverviewListItem')) {
        if (el.classList.contains('event-day-header')) {
          dayLabel = el.textContent.trim().replace(/\s+/g, ' ');
          continue;
        }
        const link = el.querySelector('h3.event-title a');
        const btnInfo = [...el.querySelectorAll('.btn-info p')];
        const knop = el.querySelector('.btn-col [aria-label^="button:"]');
        items.push({
          dayLabel,
          datumTekst: el.querySelector('.info p.heading-3')?.textContent.trim() ?? null,
          tijdTekst: el.querySelector('.info p.heading-4')?.textContent.trim() ?? null,
          titel: link?.textContent.trim().replace(/\s+/g, ' ') ?? null,
          href: link?.getAttribute('href') ?? null,
          maker: el.querySelector('p.subtitle')?.textContent.trim() || null,
          genre: el.querySelector('p.genres')?.textContent.trim() || null,
          zaal: btnInfo.filter((p) => !p.matches('.show-mobile, .genres')).pop()?.textContent.trim() || null,
          knopTekst: knop?.getAttribute('aria-label').replace(/^button:\s*/, '').trim() ?? null,
          knopHref: knop?.getAttribute('href') ?? null,
          tags: [...el.querySelectorAll('.tag')].map((t) => t.textContent.trim().toLowerCase()),
        });
      }
      return { valid: true, totalLabel, next, items };
    });

    if (!result.valid || !result.totalLabel) {
      throw new Error(
        `geen geldige agendapagina op ${page.url()} (${!result.valid ? 'lijst' : 'resultatenteller'} niet gevonden) — site veranderd?`
      );
    }
    if (pageNum === 1) expectedTotal = parseInt(result.totalLabel.match(/\d+/)[0], 10);

    const newItems = result.items.filter((item) => {
      const key = `${item.href}|${item.datumTekst}|${item.tijdTekst}`;
      if (seenKeys.has(key)) return false;
      seenKeys.add(key);
      return true;
    });
    log(`pagina ${pageNum}: ${result.items.length} voorstellingen (${newItems.length} nieuw)`);
    items.push(...newItems);

    if (!result.next || newItems.length === 0) {
      stoppedNormally = true;
      break;
    }
    url = new URL(result.next, url).toString();
  }
  if (!stoppedNormally) {
    log(`WAARSCHUWING: bovengrens van ${MAX_LISTING_PAGES} listingpagina's bereikt — paginering is waarschijnlijk stuk.`);
  }
  if (expectedTotal !== null && items.length !== expectedTotal) {
    log(`WAARSCHUWING: ${items.length} voorstellingen gelezen, maar de site noemt er ${expectedTotal}.`);
  }

  const zalen = {};
  for (const item of items) zalen[item.zaal] = (zalen[item.zaal] ?? 0) + 1;
  log(`zalen: ${Object.entries(zalen).map(([z, n]) => `${z} (${n})`).join(', ')}`);
  const unknownKnoppen = [...new Set(items.map((i) => i.knopTekst))].filter(
    (t) => !KNOWN_KNOP_TEKSTEN.includes((t ?? '').toLowerCase())
  );
  if (unknownKnoppen.length > 0) log(`onbekende knopteksten (→ onbekend): ${unknownKnoppen.join(', ')}`);

  const schoolCount = items.filter(isSchoolvoorstelling).length;
  if (schoolCount > 0) log(`${schoolCount} schoolvoorstelling(en) overgeslagen (niet publiek te boeken).`);

  const parseDay = createNumericDayParser();
  const buildId = createIdBuilder();
  const opgehaaldOp = new Date().toISOString();
  const shows = [];

  for (const item of items) {
    if (!item.titel || !item.href || isSchoolvoorstelling(item)) continue;
    // De dagkop heeft de weekdag (voor de jaarcontrole); de datum in het
    // item zelf is de terugval.
    const datum = parseDay(item.dayLabel ?? item.datumTekst ?? '');
    if (!datum) {
      log(`kon datum niet parsen: "${item.dayLabel ?? item.datumTekst}" (${item.titel}) — overgeslagen.`);
      continue;
    }
    const tijd = extractTime(item.tijdTekst);
    const infoUrl = new URL(item.href, theater.baseUrl).toString();
    const ticketUrl = item.knopHref && /^https?:/.test(item.knopHref) ? item.knopHref : null;

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
      beschikbaarheid: classifyBeschikbaarheid(item.knopTekst),
      beschrijving: null,
      maker: item.maker,
      reserverenUrl: ticketUrl ?? infoUrl,
      bron: infoUrl,
      opgehaaldOp,
    });
  }

  return shows;
}
