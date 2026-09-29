import { createIdBuilder } from '../lib/normalize.js';
import { normalizeGenre } from '../lib/genre.js';
import { THEATERS } from '../lib/config.js';
import {
  scrapePepperedListing,
  createRowDateResolver,
  classifyPepperedButton,
  logUnknownButtons,
  dedupeShows,
  createGroupScraper,
} from '../lib/peppered.js';
import { pasTitelConventieToe } from '../lib/titels.js';

const AGENDA_PATH = '/nl/voorstellingen';

// Locatienaam op de site (vóór de komma, bv. "Koninklijke Schouwburg, Den
// Haag") → onze config-entry. Namen in config.js zijn letterlijk die van
// podiumpas.nl, waar de drie zalen als losse locaties staan.
const THEATER_ID_BY_LOCATION = {
  'koninklijke schouwburg': 'koninklijkeschouwburg',
  'theater aan het spui': 'theateraanhetspui',
  'zaal 3': 'zaal3',
};

/**
 * Het Nationale Theater (Den Haag): één agenda voor de Koninklijke
 * Schouwburg, Theater aan het Spui en Zaal 3.
 *
 * Structuur (geïnspecteerd op https://www.hnt.nl/nl/voorstellingen, sep 2026):
 * - Peppered-platform (zie lib/peppered.js), 30 kaarten per pagina,
 *   paginering via p508_page. Gefilterde URL's (?locations[]=…) zijn door
 *   robots.txt verboden, dus we lezen de kale agenda en filteren zelf.
 * - Per speeldatum staat de locatie erbij. Behalve de drie eigen zalen komen
 *   ook "Locatietheater" en tourneedata in het hele land voor ("in-other-
 *   location", knop "Tickets via theater") — die horen niet in onze data.
 * - Eén scrape per run vult alle drie de config-entries (createGroupScraper),
 *   zodat de agenda niet drie keer wordt opgehaald.
 * - Podiumpas: HNT's kaartverkooppagina zegt dat je met de pas onbeperkt
 *   naar voorstellingen bij Het Nationale Theater kunt (reserveren
 *   telefonisch/per mail) — geen uitsluitingen genoemd, dus de boolean per
 *   config-entry.
 */
async function scrapeAllHnt({ page, theater, robots, waitForTurn, log, warn }) {
  const cards = await scrapePepperedListing({ page, theater, robots, waitForTurn, log, warn, agendaPath: AGENDA_PATH });
  const theatersById = Object.fromEntries(THEATERS.map((t) => [t.id, t]));
  const resolveDate = createRowDateResolver();
  const buildId = createIdBuilder();
  const opgehaaldOp = new Date().toISOString();
  const shows = [];
  const rowsByShowId = new Map();
  const skipped = {};

  for (const card of cards) {
    if (!card.titel || !card.detailHref) continue;
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
      if (beschikbaarheid === null) continue; // geweest
      const when = resolveDate(row);
      if (!when) {
        log(`kon datum niet bepalen: "${row.dateText}" (${card.titel}) — overgeslagen.`);
        continue;
      }
      const target = theatersById[theaterId];
      const genreRuw = card.genres[0] ?? null;
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
        genre: normalizeGenre(genreRuw),
        genreRuw,
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
    log(`overgeslagen (niet in eigen zalen): ${skippedList.slice(0, 8).map(([k, n]) => `${k} (${n})`).join(', ')}${skippedList.length > 8 ? ', …' : ''}`);
  }
  logUnknownButtons(log, shows, rowsByShowId);
  // Titelconventie cabaret (lib/titels.js): bij dit theater staat de artiest in de titel, voorstelling in het makerveld.
  return dedupeShows(shows).map((s) => pasTitelConventieToe(s, { artiest: s.titel, voorstelling: s.maker, makerWordtLeeg: true }));
}

export const scrapeHnt = createGroupScraper(scrapeAllHnt);
