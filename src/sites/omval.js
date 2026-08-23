import { createDutchAbbrevDayParser, extractTime, createIdBuilder } from '../lib/normalize.js';
import { normalizeGenreFromList } from '../lib/genre.js';

const AGENDA_PATH = '/voorstellingen';
const MAX_LISTING_PAGES = 30;

// Zelfde twee-signalen-aanpak als Muziekgebouw aan 't IJ (zelfde platform):
// een <a class="status-info"> met tekst-label voor uitzonderingen, de
// bestelknop (.btn-order) met eigen status-suffix als fallback/bevestiging.
function classifyBeschikbaarheid(statusInfoText, btnOrderStatus) {
  const info = (statusInfoText ?? '').toLowerCase();
  if (info.includes('wachtlijst')) return 'wachtlijst';
  if (info.includes('uitverkocht')) return 'uitverkocht';

  const btn = (btnOrderStatus ?? '').toLowerCase();
  if (btn.includes('wachtlijst')) return 'wachtlijst';
  if (btn.includes('uitverkocht')) return 'uitverkocht';
  if (btn.includes('normaal') || btn.includes('laatste')) return 'beschikbaar';

  return 'onbekend';
}

/**
 * Haalt de volledige agenda van Theater De Omval op.
 *
 * Structuur (geïnspecteerd op https://www.theaterdeomval.nl/voorstellingen,
 * aug 2026) — zelfde platform als Muziekgebouw aan 't IJ, dus grotendeels
 * dezelfde aanpak:
 * - robots.txt: crawl-delay 5s voor "*", paginering via ?page=N expliciet
 *   toegestaan (net als bij Muziekgebouw). Een query-param-filter als
 *   ?production_type=default zou dat NIET zijn (algemene "Disallow: /*?*"
 *   zonder specifieke Allow), dus die vermijden we — filteren op
 *   voorstelling-vs-film doen we daarom client-side.
 * - Server-rendered, gepagineerd via ?page=N (8 kaarten/pagina, tot en met
 *   pagina 16-17 — we stoppen zodra een pagina leeg is).
 * - In tegenstelling tot Muziekgebouw mixt deze agenda ECHTE
 *   voorstellingen (class "production-type-default") met
 *   filmvertoningen (class "production-type-movie") — we nemen alleen
 *   "default" mee, films vallen buiten de scope van een theateragenda.
 * - Genre-tags (.genres__link) zijn hier, anders dan bij Muziekgebouw, wél
 *   gewoon in de initiële HTML aanwezig — geen extra requests nodig.
 * - Datum staat als platte tekst "di 3 nov" (weekdag-afkorting, dag,
 *   maand-afkorting, GEEN jaartal) — zelfde formaat als Theater Bellevue,
 *   dus de bestaande createDutchAbbrevDayParser() volstaat.
 */
export async function scrapeOmval({ page, theater, robots, waitForTurn, log }) {
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
    let pageResult;
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      pageResult = await page.evaluate(() => {
        const cards = Array.from(document.querySelectorAll('.eventCard'));
        const items = cards
          .filter((el) => !el.className.includes('production-type-movie'))
          .map((el) => {
            const titel = el.querySelector('.title')?.textContent.trim() ?? null;
            const detailHref = el.querySelector('a.desc')?.getAttribute('href') ?? null;
            const beschrijving = el.querySelector('.tagline')?.textContent.trim() ?? null;
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
        return { total: cards.length, items };
      });
    } catch (err) {
      log(`kon listingpagina ${pageNum} niet laden: ${err.message} — probeer volgende pagina.`);
      continue;
    }

    log(`pagina ${pageNum}: ${pageResult.total} items, ${pageResult.items.length} na uitfilteren films`);
    // Stoppen op een lege PAGINA (geen enkele kaart, film of niet) — een
    // pagina die toevallig alléén films bevat (zoals hier pagina 1) is geen
    // signaal dat de paginering voorbij is, dus die telt niet als "leeg".
    if (pageResult.total === 0) break;
    rawItems.push(...pageResult.items);
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
