import { createIdBuilder } from '../lib/normalize.js';
import { normalizeGenreFromList, normalizeGenre } from '../lib/genre.js';
import {
  scrapePepperedListing,
  createRowDateResolver,
  classifyPepperedButton,
  logUnknownButtons,
  dedupeShows,
} from '../lib/peppered.js';
import { checkExclusionText, matchesAnyName } from '../lib/exclusions.js';

const AGENDA_PATH = '/agenda';

// Bron: https://www.theaterhetkruispunt.nl/podiumpas-8y4s (overgenomen 27 sep
// 2026). checkExclusionText vergelijkt de tekst elke run; bij een wijziging
// volgt een waarschuwing en moeten de lijsten hieronder worden bijgewerkt.
const EXCLUSION_URL = 'https://www.theaterhetkruispunt.nl/podiumpas-8y4s';
const EXCLUSION_TEXT =
  'Voorstellingen die zijn uitgezonderd van de Podiumpas zijn: -De Peuter-kleuterochtenden. -De Moordmysteries. ' +
  '-De voorstellingen van de Toneelvereniging Barendrecht. -De voorstelling van Jeugdtheater Hofplein. -Verhuringen ' +
  'vallend onder het genre gastprogrammering. -Voorstellingen op buitenlocaties. -Ons complete filmaanbod.';
// De meeste uitsluitingen zijn een genre op de kaart…
const EXCLUDED_GENRES = new Set(['peuter-kleuterochtend', 'gastprogrammering', 'locatievoorstelling', 'film']);
// …de rest staat bij naam.
const EXCLUDED_NAMES = ['Moordmysterie', 'Toneelvereniging Barendrecht', 'Jeugdtheater Hofplein'];
// Geen voorstelling (cursussen staan ook in de agenda).
const SKIPPED_GENRES = new Set(['cursus']);

/**
 * Theater het Kruispunt (Barendrecht).
 *
 * Structuur (geïnspecteerd op https://www.theaterhetkruispunt.nl/agenda, sep 2026):
 * - Peppered-platform (lib/peppered.js), 10 kaarten per pagina, ?page=N,
 *   achter dezelfde BunnyCDN-wachtrij als Isala (robots.txt: Crawl-delay 5).
 * - Films: kaarttype "movie" of genre "film" — in de data met podiumpas:
 *   false, zoals bij Aan de Slinger/Corrosia/Koningshof.
 * - Veel gratis foyer-activiteiten ("toegang gratis", bv. Het Aanschuifkoor).
 * - Geen prijsgrens bij Kruispunt. Reserveren met de pas alleen telefonisch.
 */
export async function scrapeKruispunt({ page, theater, robots, waitForTurn, log, warn }) {
  const cards = await scrapePepperedListing({ page, theater, robots, waitForTurn, log, warn, agendaPath: AGENDA_PATH });
  const resolveDate = createRowDateResolver();
  const buildId = createIdBuilder();
  const opgehaaldOp = new Date().toISOString();
  const shows = [];
  const rowsByShowId = new Map();
  const reasons = {};
  let skipped = 0;

  for (const card of cards) {
    if (!card.titel || !card.detailHref) continue;
    const genresLower = card.genres.map((g) => g.trim().toLowerCase());
    if (genresLower.some((g) => SKIPPED_GENRES.has(g))) {
      skipped++;
      continue;
    }
    const detailUrl = new URL(card.detailHref, theater.baseUrl).toString();
    const name = matchesAnyName(EXCLUDED_NAMES, card.titel, card.subtitle);
    const reason =
      (card.productionType === 'movie' && 'film') ||
      genresLower.find((g) => EXCLUDED_GENRES.has(g)) ||
      (name && `naam: ${name}`) ||
      null;

    for (const row of card.rows) {
      const beschikbaarheid = classifyPepperedButton(row.buttonText);
      if (beschikbaarheid === null) continue;
      const when = resolveDate(row);
      if (!when) {
        log(`kon datum niet bepalen: "${row.dateText}" (${card.titel}) — overgeslagen.`);
        continue;
      }
      if (reason) reasons[reason] = (reasons[reason] ?? 0) + 1;
      const ticketUrl = row.buttonHref && /^https?:/.test(row.buttonHref) ? row.buttonHref : null;
      shows.push({
        id: buildId(theater.id, card.titel, when.datum, when.tijd),
        titel: card.titel,
        theaterId: theater.id,
        theaterNaam: theater.naam,
        stad: theater.stad,
        podiumpas: theater.podiumpas && !reason,
        datum: when.datum,
        tijd: when.tijd,
        genre: reason === 'film' ? 'Overig' : (normalizeGenreFromList(card.genres) ?? normalizeGenre(card.genres[0] ?? null)),
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

  const reasonList = Object.entries(reasons);
  log(`podiumpas: false bij ${reasonList.reduce((n, [, c]) => n + c, 0)} voorstellingen (${reasonList.map(([r, c]) => `${r}: ${c}`).join(', ')}); ${skipped} cursus-kaart(en) overgeslagen`);
  logUnknownButtons(log, shows, rowsByShowId);
  await checkExclusionText({ page, robots, waitForTurn, warn, log, url: EXCLUSION_URL, startsWith: 'Voorstellingen die zijn uitgezonderd', expected: EXCLUSION_TEXT });
  return dedupeShows(shows);
}
