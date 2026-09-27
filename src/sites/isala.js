import { createIdBuilder } from '../lib/normalize.js';
import { normalizeGenreFromList, normalizeGenre } from '../lib/genre.js';
import {
  scrapePepperedListing,
  createRowDateResolver,
  classifyPepperedButton,
  logUnknownButtons,
  dedupeShows,
} from '../lib/peppered.js';
import { checkExclusionText, matchesAnyName, lowestPrice } from '../lib/exclusions.js';

const AGENDA_PATH = '/agenda';
const PODIUMPAS_PRICE_CEILING = 50; // "tickets met een reguliere prijs van maximaal € 50"

// Bron: https://www.isalatheater.nl/podiumpas-l3lg (overgenomen 27 sep 2026).
// Elke run vergelijkt checkExclusionText de tekst hieronder met de pagina;
// wijzigt die, dan volgt een waarschuwing in scrape-status.json en moet
// deze lijst met de hand worden bijgewerkt.
const EXCLUSION_URL = 'https://www.isalatheater.nl/podiumpas-l3lg';
const EXCLUSION_TEXT =
  'Met de Podiumpas kun je een kaart reserveren voor bijna alle reguliere voorstellingen in het Isala Theater. ' +
  'Uitgesloten zijn uitverkochte voorstellingen, voorstellingen met een wachtlijst, verhuringen (zoals Jongerentheater ' +
  'Quint, Jeugdtheaterhuis, een lunchconcert, The Elvis Concert), voorstellingen met eten, Moord in Isala, Isala ' +
  'pubquiz en films. Net als specifieke voorstellingen zoals die van Jay Francis, Rayen Panday, Lang leve Annie M.G. ' +
  'en Cézanne Tegelberg Company.';
const EXCLUDED_NAMES = [
  'Jongerentheater Quint',
  'Jeugdtheaterhuis',
  'Lunchconcert',
  'The Elvis Concert',
  'Moord in Isala',
  'Isala pubquiz',
  'Jay Francis',
  'Rayen Panday',
  'Lang leve Annie M.G.',
  'Cézanne Tegelberg Company',
];
const EXCLUDED_GENRES = new Set(['film', 'isala film', 'verhuur']);
// "Voorstellingen met eten" staan niet als los genre op de listing; we
// herkennen ze aan de titel/ondertitel.
const MET_ETEN = /\b(diner|dinershow|high tea|brunch|met eten)\b/i;

/**
 * Isala theater (Capelle aan den IJssel).
 *
 * Structuur (geïnspecteerd op https://www.isalatheater.nl/agenda, sep 2026):
 * - Peppered-platform (lib/peppered.js), 30 kaarten per pagina, ?page=N.
 *   De site zit achter een BunnyCDN-wachtrij (/csq/); robots.txt (Crawl-
 *   delay 5) lezen we sinds de cookie-fix in robots.js wél echt.
 * - Prijs op de kaart ("Rang 1 normaal € 22,50 …") → `prijs` = laagste
 *   bedrag; hoger dan €50 → podiumpas: false. Geen prijs te vinden → ook
 *   false (defensief, zoals bij Flint).
 * - Podiumpas-uitsluitingen (zie EXCLUSION_TEXT): films en verhuur (genre),
 *   voorstellingen met eten (titel), en een namenlijst. Die voorstellingen
 *   blijven in de data, met podiumpas: false. Reserveren met de pas kan bij
 *   Isala alleen offline (balie/telefoon/mail).
 */
export async function scrapeIsala({ page, theater, robots, waitForTurn, log, warn }) {
  const cards = await scrapePepperedListing({ page, theater, robots, waitForTurn, log, agendaPath: AGENDA_PATH });
  const resolveDate = createRowDateResolver();
  const buildId = createIdBuilder();
  const opgehaaldOp = new Date().toISOString();
  const shows = [];
  const rowsByShowId = new Map();
  const reasons = {};

  for (const card of cards) {
    if (!card.titel || !card.detailHref) continue;
    const detailUrl = new URL(card.detailHref, theater.baseUrl).toString();
    const genresLower = card.genres.map((g) => g.trim().toLowerCase());
    const prijs = lowestPrice(card.priceText);
    const name = matchesAnyName(EXCLUDED_NAMES, card.titel, card.subtitle);
    const reason =
      genresLower.find((g) => EXCLUDED_GENRES.has(g)) ||
      (name && `naam: ${name}`) ||
      (MET_ETEN.test(`${card.titel} ${card.subtitle ?? ''}`) && 'met eten') ||
      (prijs == null && 'geen prijs') ||
      (prijs > PODIUMPAS_PRICE_CEILING && `prijs €${prijs}`) ||
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
        genre: normalizeGenreFromList(card.genres) ?? normalizeGenre(card.genres[0] ?? null),
        genreRuw: card.genres.join(', ') || null,
        beschikbaarheid,
        beschrijving: card.tagline,
        maker: card.subtitle,
        prijs,
        reserverenUrl: ticketUrl ?? detailUrl,
        bron: detailUrl,
        opgehaaldOp,
      });
      rowsByShowId.set(shows.at(-1).id, row);
    }
  }

  const reasonList = Object.entries(reasons);
  log(`podiumpas: false bij ${reasonList.reduce((n, [, c]) => n + c, 0)} voorstellingen (${reasonList.map(([r, c]) => `${r}: ${c}`).join(', ')})`);
  logUnknownButtons(log, shows, rowsByShowId);
  await checkExclusionText({ page, robots, waitForTurn, warn, log, url: EXCLUSION_URL, startsWith: 'Met de Podiumpas kun je', expected: EXCLUSION_TEXT });
  return dedupeShows(shows);
}
