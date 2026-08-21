import { createDutchAbbrevDayParser, extractTime, createIdBuilder } from '../lib/normalize.js';
import { normalizeGenre } from '../lib/genre.js';

const AGENDA_PATH = '/agenda';
const MAX_LISTING_PAGES = 60;

/**
 * Haalt de volledige agenda van Theater Bellevue op.
 *
 * Structuur (geïnspecteerd op https://www.theaterbellevue.nl/agenda, aug 2026):
 * - De agendapagina is gepagineerd via ?page=N (robots.txt staat dit expliciet
 *   toe met "Allow: /*?page=*", ondanks de algemene "Disallow: /*?*"-regel).
 *   Elke pagina toont acht producties als <li data-entry-id="..."> ("eventCard").
 * - Zo'n kaart toont title/subtitle/genres/tagline en een top-date die óf een
 *   los datum+tijd is (eenmalige voorstelling, met een directe ticketlink),
 *   óf een datumrange is (bv. "wo 9 sep - za 3 apr") voor een reeks
 *   voorstellingen — in dat geval geeft de kaart zelf geen individuele datums.
 * - De detailpagina van elke productie (/agenda/<slug>) bevat wél een
 *   volledige lijst van losse voorstellingen als <li class="subshow">, elk
 *   met eigen datum, tijd en ticketknop. Bij sommige voorstellingen is die
 *   knop een JS-call (javascript:vdm_order(...)) in plaats van een echte URL
 *   (eigen boekingswidget) — dan valt reserverenUrl terug op de detailpagina.
 * - Om altijd de losse voorstellingsdatums te pakken (in plaats van alleen de
 *   startdatum van een reeks), bezoeken we voor élke productie de
 *   detailpagina — dat is trager, maar wel de enige betrouwbare bron.
 */
export async function scrapeBellevue({ page, theater, robots, waitForTurn, log }) {
  if (!robots.isAllowed(AGENDA_PATH)) {
    log(`robots.txt verbiedt ${AGENDA_PATH} op ${theater.baseUrl} — sla over.`);
    return [];
  }

  const cards = [];
  for (let pageNum = 1; pageNum <= MAX_LISTING_PAGES; pageNum++) {
    const url = pageNum === 1 ? theater.agendaUrl : `${theater.agendaUrl}?page=${pageNum}`;
    const listingPath = pageNum === 1 ? AGENDA_PATH : `${AGENDA_PATH}?page=${pageNum}`;
    if (!robots.isAllowed(listingPath)) {
      log(`robots.txt verbiedt ${listingPath} — stop met pagineren.`);
      break;
    }

    await waitForTurn();
    let pageCards;
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      pageCards = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('li[data-entry-id]')).map((card) => {
          const titel = card.querySelector('h3.title')?.textContent.trim() ?? null;
          const beschrijving = card.querySelector('.tagline')?.textContent.trim() ?? null;
          const detailHref = card.querySelector('a.desc')?.getAttribute('href') ?? null;
          const genre = card.querySelector('.genres__link')?.textContent.trim() ?? null;
          return { titel, beschrijving, detailHref, genre };
        });
      });
    } catch (err) {
      log(`kon listingpagina ${pageNum} niet laden: ${err.message} — probeer volgende pagina.`);
      continue;
    }

    log(`pagina ${pageNum}: ${pageCards.length} producties`);
    if (pageCards.length === 0) break;
    cards.push(...pageCards);
  }

  const buildId = createIdBuilder();
  const opgehaaldOp = new Date().toISOString();
  const shows = [];

  for (const card of cards) {
    if (!card.titel || !card.detailHref) continue;
    const detailUrl = new URL(card.detailHref, theater.baseUrl).toString();
    const detailPath = new URL(detailUrl).pathname;

    if (!robots.isAllowed(detailPath)) {
      log(`robots.txt verbiedt ${detailPath} — "${card.titel}" overgeslagen.`);
      continue;
    }

    await waitForTurn();
    let subshows;
    try {
      await page.goto(detailUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      subshows = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('li.subshow')).map((li) => {
          const dagTekst = li.querySelector('.date .start')?.textContent.trim() ?? null;
          const tijdTekst = li.querySelector('.time .start')?.textContent.trim() ?? null;
          const href = li.querySelector('.buttonBox a')?.getAttribute('href') ?? null;
          return { dagTekst, tijdTekst, href };
        });
      });
    } catch (err) {
      log(`kon detailpagina niet laden voor "${card.titel}" (${detailUrl}): ${err.message} — overgeslagen.`);
      continue;
    }

    const parseDay = createDutchAbbrevDayParser();
    for (const sub of subshows) {
      if (!sub.dagTekst) continue;
      const datum = parseDay(sub.dagTekst);
      if (!datum) {
        log(`kon datum-label niet parsen: "${sub.dagTekst}" (${card.titel}) — overgeslagen.`);
        continue;
      }
      const tijd = extractTime(sub.tijdTekst);
      const ticketUrl =
        sub.href && !sub.href.startsWith('javascript:')
          ? new URL(sub.href, theater.baseUrl).toString()
          : null;

      shows.push({
        id: buildId(theater.id, card.titel, datum, tijd),
        titel: card.titel,
        theaterId: theater.id,
        theaterNaam: theater.naam,
        stad: theater.stad,
        datum,
        tijd,
        genre: normalizeGenre(card.genre),
        genreRuw: card.genre,
        beschrijving: card.beschrijving,
        reserverenUrl: ticketUrl ?? detailUrl,
        bron: detailUrl,
        opgehaaldOp,
      });
    }
  }

  return shows;
}
