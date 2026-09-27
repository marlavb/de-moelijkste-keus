import { createIdBuilder } from '../lib/normalize.js';
import { normalizeGenreFromList, normalizeGenre } from '../lib/genre.js';
import { THEATERS } from '../lib/config.js';
import {
  scrapePepperedListing,
  createRowDateResolver,
  classifyPepperedButton,
  logUnknownButtons,
  createGroupScraper,
} from '../lib/peppered.js';

const AGENDA_PATH = '/agenda';

// Alleen de twee locaties die op podiumpas.nl staan. Brutus (ook een TR-
// locatie) staat daar niet en laten we dus bewust weg.
const THEATER_ID_BY_LOCATION = {
  'tr25 schouwburg': 'tr25',
  'tr8 william boothlaan': 'tr8',
};

/**
 * Theater Rotterdam: één agenda voor TR25 Schouwburg, TR8 William
 * Boothlaan en Brutus, plus tourneedata van TR-producties door het hele land.
 *
 * Structuur (geïnspecteerd op https://www.theaterrotterdam.nl/agenda, sep 2026):
 * - Peppered-platform (lib/peppered.js), 10 kaarten per pagina, paginering via
 *   p54_page. Gefilterde URL's zijn door robots.txt verboden.
 * - Per speeldatum de locatie ("TR25 Schouwburg, Rotterdam" + zaal); tournee
 *   heeft knop "Verkoop elders". Lange lijsten zijn ingeklapt achter "Toon
 *   meer opties", maar staan al in de DOM — geen detailpagina's nodig.
 * - Kaarten van het type "longterm_event" (bv. The Kitchen, horeca) zijn
 *   geen voorstellingen en slaan we over.
 * - Genre: de eerste .genres__link is vaak een programmalijn ("TR Producties",
 *   "Vlakke Vloerkaart"); normalizeGenreFromList pakt het eerste echte genre.
 * - Podiumpas: "geldig voor alle voorstellingen in alle zalen, mits niet
 *   uitverkocht; voorstellingen en verhuringen waarvoor wij de kaartverkoop
 *   niet doen zijn uitgesloten". Die laatste herkennen we niet apart op de
 *   listing (nog niet waargenomen in de eigen zalen) — boolean per entry.
 */
async function scrapeAllTheaterRotterdam({ page, theater, robots, waitForTurn, log }) {
  const cards = await scrapePepperedListing({ page, theater, robots, waitForTurn, log, agendaPath: AGENDA_PATH });
  const theatersById = Object.fromEntries(THEATERS.map((t) => [t.id, t]));
  const resolveDate = createRowDateResolver();
  const buildId = createIdBuilder();
  const opgehaaldOp = new Date().toISOString();
  const shows = [];
  const rowsByShowId = new Map();
  const skipped = {};

  for (const card of cards) {
    if (!card.titel || !card.detailHref) continue;
    if (card.productionType === 'longterm_event') continue;
    const detailUrl = new URL(card.detailHref, theater.baseUrl).toString();
    for (const row of card.rows) {
      const locationName = (row.location ?? '').split(',')[0].trim().toLowerCase();
      const theaterId = THEATER_ID_BY_LOCATION[locationName];
      if (!theaterId) {
        const key = row.location ?? '(geen locatie)';
        skipped[key] = (skipped[key] ?? 0) + 1;
        continue;
      }
      const beschikbaarheid = classifyPepperedButton(row.buttonText);
      if (beschikbaarheid === null) continue; // geweest / verkoop elders
      const when = resolveDate(row);
      if (!when) {
        log(`kon datum niet bepalen: "${row.dateText}" (${card.titel}) — overgeslagen.`);
        continue;
      }
      const target = theatersById[theaterId];
      const genre = normalizeGenreFromList(card.genres) ?? normalizeGenre(card.genres[0] ?? null);
      const ticketUrl = row.buttonHref && /^https?:/.test(row.buttonHref) ? row.buttonHref : null;
      shows.push({
        id: buildId(theaterId, card.titel, when.datum, when.tijd),
        titel: card.titel,
        theaterId,
        theaterNaam: target.naam,
        stad: target.stad,
        podiumpas: target.podiumpas,
        datum: when.datum,
        tijd: when.tijd,
        genre,
        genreRuw: card.genres.join(', ') || null,
        beschikbaarheid,
        beschrijving: card.tagline,
        maker: card.subtitle,
        reserverenUrl: ticketUrl ?? detailUrl,
        bron: detailUrl,
        opgehaaldOp,
      });
      rowsByShowId.set(shows.at(-1).id, row);
    }
  }

  const skippedList = Object.entries(skipped).sort((a, b) => b[1] - a[1]);
  if (skippedList.length > 0) {
    log(`overgeslagen (niet TR25/TR8): ${skippedList.length} locaties, o.a. ${skippedList.slice(0, 6).map(([k, n]) => `${k} (${n})`).join(', ')}`);
  }
  logUnknownButtons(log, shows, rowsByShowId);
  return shows;
}

export const scrapeTheaterRotterdam = createGroupScraper(scrapeAllTheaterRotterdam);
