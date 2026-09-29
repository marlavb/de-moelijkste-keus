import { createIdBuilder } from '../lib/normalize.js';
import { normalizeGenreFromList, normalizeGenre } from '../lib/genre.js';
import { scrapePepperedListing, createRowDateResolver, classifyPepperedButton, logUnknownButtons, dedupeShows } from '../lib/peppered.js';

const AGENDA_PATH = '/agenda';

// Podiumpas geldt volgens Koningshofs eigen pagina voor "alle reguliere
// voorstellingen … verhuringen, films en voorstellingen waarvoor wij de
// kaartverkoop niet zelf doen zijn uitgesloten". Films herkennen we aan het
// kaarttype ("movie") of een filmgenre; die blijven in de data (zoals bij
// Aan de Slinger/Corrosia), maar met podiumpas: false.
const FILM_GENRES = new Set(['film', 'familiefilm', 'arthouse', 'documentaire']);

function isFilm(card) {
  return card.productionType === 'movie' || card.genres.some((g) => FILM_GENRES.has(g.trim().toLowerCase()));
}

/**
 * Theater Koningshof (Maassluis).
 *
 * Structuur (geïnspecteerd op https://www.theaterkoningshof.nl/agenda, sep 2026):
 * - Peppered-platform (lib/peppered.js), 8 kaarten per pagina, paginering via
 *   ?page=N (het enige wat robots.txt toestaat). Eén zaal (Theaterzaal de
 *   Uiver), dus geen locatiefilter nodig.
 * - Een groot deel van de agenda is film (kaarttype "movie", met per
 *   vertoning alleen een data-event-start) — zie isFilm().
 * - Boekingen via Ticketmatic; knopteksten "Tickets" en "Wachtlijst".
 */
export async function scrapeKoningshof({ page, theater, robots, waitForTurn, log, warn }) {
  const cards = await scrapePepperedListing({ page, theater, robots, waitForTurn, log, warn, agendaPath: AGENDA_PATH });
  const resolveDate = createRowDateResolver();
  const buildId = createIdBuilder();
  const opgehaaldOp = new Date().toISOString();
  const shows = [];
  const rowsByShowId = new Map();

  for (const card of cards) {
    if (!card.titel || !card.detailHref) continue;
    const detailUrl = new URL(card.detailHref, theater.baseUrl).toString();
    const film = isFilm(card);
    for (const row of card.rows) {
      const beschikbaarheid = classifyPepperedButton(row.buttonText);
      if (beschikbaarheid === null) continue;
      const when = resolveDate(row);
      if (!when) {
        log(`kon datum niet bepalen: "${row.dateText}" (${card.titel}) — overgeslagen.`);
        continue;
      }
      const genreRuw = card.genres.join(', ') || null;
      const ticketUrl = row.buttonHref && /^https?:/.test(row.buttonHref) ? row.buttonHref : null;
      shows.push({
        id: buildId(theater.id, card.titel, when.datum, when.tijd),
        titel: card.titel,
        theaterId: theater.id,
        theaterNaam: theater.naam,
        stad: theater.stad,
        podiumpas: theater.podiumpas && !film,
        datum: when.datum,
        tijd: when.tijd,
        genre: film ? 'Overig' : (normalizeGenreFromList(card.genres) ?? normalizeGenre(card.genres[0] ?? null)),
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

  const films = shows.filter((s) => !s.podiumpas).length;
  log(`${shows.length} voorstellingen, waarvan ${films} film (podiumpas: false)`);
  logUnknownButtons(log, shows, rowsByShowId);
  return dedupeShows(shows);
}
