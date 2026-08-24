import { createDutchAbbrevDayParser, extractTime, createIdBuilder } from '../lib/normalize.js';
import { normalizeGenreFromList } from '../lib/genre.js';

const AGENDA_PATH = '/agenda';
const MAX_LISTING_PAGES = 30;

// Zelfde twee-signalen-aanpak als Muziekgebouw/Omval (zelfde platform), met
// één extra status die op dit specifieke theater voorkomt: "gratis" (een
// vrij-toegankelijk programmaonderdeel zonder bestelknop) — die telt als
// beschikbaar, niet als "onbekend" bij ontbreken van een orderknop.
function classifyBeschikbaarheid(statusInfoText, btnOrderStatus) {
  const info = (statusInfoText ?? '').toLowerCase();
  if (info.includes('wachtlijst')) return 'wachtlijst';
  if (info.includes('uitverkocht')) return 'uitverkocht';
  if (info.includes('gratis')) return 'beschikbaar';

  const btn = (btnOrderStatus ?? '').toLowerCase();
  if (btn.includes('wachtlijst')) return 'wachtlijst';
  if (btn.includes('uitverkocht')) return 'uitverkocht';
  if (btn.includes('normaal') || btn.includes('laatste')) return 'beschikbaar';

  return 'onbekend';
}

/**
 * Haalt de volledige agenda van Bijlmer Parktheater op.
 *
 * Structuur (geïnspecteerd op https://www.bijlmerparktheater.nl/agenda,
 * aug 2026) — zelfde .eventCard-platform als Muziekgebouw aan 't IJ en
 * Theater De Omval:
 * - robots.txt: crawl-delay 5s voor "*", met dezelfde Disallow: /*?* +
 *   Allow: /*?page=*-combinatie als Muziekgebouw/Omval — paginering via
 *   ?page=N is dus toegestaan.
 * - Server-rendered, gepagineerd via ?page=N (12 kaarten/pagina) — we
 *   stoppen zodra een pagina leeg is.
 * - Eén productietype (production-type-default) — geen film/andere types
 *   om uit te filteren, in tegenstelling tot Omval.
 * - Genre-tags (.genres__link) staan, net als bij Omval, al in de initiële
 *   HTML — geen extra requests nodig. Vaak een hele waslijst thema-tags
 *   naast het echte genre, dus normalizeGenreFromList() net als bij Omval.
 * - Tijd (.top-date .time) toont meestal een start-eindtijd-range
 *   ("20:00 - 21:00"), soms "Meerdere tijdstippen" (bv. bij een dagvullend
 *   festival) in plaats van een tijd, en soms ontbreekt het element
 *   volledig. extractTime() se digit:digit-regex matcht in alle drie de
 *   gevallen vanzelf correct (respectievelijk: de starttijd, null, null) —
 *   geen speciale code nodig.
 */
export async function scrapeBijlmerParktheater({ page, theater, robots, waitForTurn, log }) {
  if (!robots.isAllowed(AGENDA_PATH)) {
    log(`robots.txt verbiedt ${AGENDA_PATH} op ${theater.baseUrl} — sla over.`);
    return [];
  }

  const rawItems = [];
  for (let pageNum = 1; pageNum <= MAX_LISTING_PAGES; pageNum++) {
    const url = pageNum === 1 ? theater.agendaUrl : `${theater.agendaUrl}?page=${pageNum}`;
    const listingPath = pageNum === 1 ? AGENDA_PATH : `${AGENDA_PATH}?page=${pageNum}`;
    if (!robots.isAllowed(listingPath)) {
      log(`robots.txt verbiedt ${listingPath} — stop met pagineren.`);
      break;
    }

    await waitForTurn();
    let pageItems;
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      pageItems = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('.eventCard')).map((el) => {
          const titel = el.querySelector('.title')?.textContent.trim() ?? null;
          const detailHref = el.querySelector('a.desc')?.getAttribute('href') ?? null;
          const beschrijving = el.querySelector('.subtitle')?.textContent.trim() ?? null;
          const dagTekst = el.querySelector('.top-date .start')?.textContent.trim() ?? null;
          const tijdTekst = el.querySelector('.top-date .time')?.textContent.trim() ?? null;
          const genres = Array.from(el.querySelectorAll('.genres__link')).map((g) => g.textContent.trim());
          const statusInfoText = el.querySelector('.status-info .label')?.textContent.trim() ?? null;
          const btnOrderEl = el.querySelector('.btn-order');
          const btnOrderStatus = btnOrderEl?.className ?? null;
          const ticketHref = btnOrderEl?.getAttribute('href') ?? null;
          return {
            titel,
            detailHref,
            beschrijving,
            dagTekst,
            tijdTekst,
            genres,
            statusInfoText,
            btnOrderStatus,
            ticketHref,
          };
        });
      });
    } catch (err) {
      log(`kon listingpagina ${pageNum} niet laden: ${err.message} — probeer volgende pagina.`);
      continue;
    }

    log(`pagina ${pageNum}: ${pageItems.length} items`);
    if (pageItems.length === 0) break;
    rawItems.push(...pageItems);
  }

  const parseDay = createDutchAbbrevDayParser();
  const buildId = createIdBuilder();
  const opgehaaldOp = new Date().toISOString();
  const shows = [];

  for (const item of rawItems) {
    if (!item.titel || !item.dagTekst) continue;
    const datum = parseDay(item.dagTekst);
    if (!datum) {
      log(`kon datum niet parsen: "${item.dagTekst}" (${item.titel}) — overgeslagen.`);
      continue;
    }
    const tijd = extractTime(item.tijdTekst);
    const detailUrl = item.detailHref ? new URL(item.detailHref, theater.baseUrl).toString() : theater.agendaUrl;
    const ticketUrl = item.ticketHref ? new URL(item.ticketHref, theater.baseUrl).toString() : null;

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
      beschikbaarheid: classifyBeschikbaarheid(item.statusInfoText, item.btnOrderStatus),
      beschrijving: item.beschrijving,
      reserverenUrl: ticketUrl ?? detailUrl,
      bron: theater.agendaUrl,
      opgehaaldOp,
    });
  }

  return shows;
}
