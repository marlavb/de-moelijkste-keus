import { createIdBuilder } from '../lib/normalize.js';
import { normalizeGenreFromList } from '../lib/genre.js';
import { scrapePepperedListing, createRowDateResolver, classifyPepperedButton, logUnknownButtons, dedupeShows } from '../lib/peppered.js';
import { pasTitelConventieToe, isWervend } from '../lib/titels.js';
import { blokkeerZwareBronnen } from '../lib/zwareBronnen.js';

const AGENDA_PATH = '/programma';

/**
 * Kennemer Theater (Beverwijk). Geen Podiumpas-theater (config podiumpas:
 * false); toegevoegd om o.a. "Jordy van Loon speelt Louis Davids" te volgen.
 *
 * Structuur (geïnspecteerd op https://www.kennemertheater.nl/programma, 1 okt
 * 2026): Peppered-platform (lib/peppered.js), 8 kaarten per pagina, ~20
 * pagina's via ?p54_page=N (van pagina 1 afgelezen). robots.txt vraagt een
 * crawl-delay van 5 s (achter BunnyCDN, maar zonder botcontrole: gewone 200).
 * Alles uit de listing, geen detailpagina's.
 *
 * Genre: de genretags mengen genres ("cabaret", "muziektheater") met series
 * ("Serie Kleine Zaal", "Met vriendinnen", "Herfstvakantie"): de eerste tag
 * die een bekend genre is telt. Titel en ondertitel zoals bij de andere
 * Peppered-theaters: bij cabaret artiest/voorstelling ("Roel & Jos
 * Maalderink" / "Verbroedering"), anders voorstelling/maker ("Louis Davids -
 * De Grote, Kleine Man" / "Jordy van Loon"). Een wervende ondertitel ("Niets
 * komt tussen Jack & Rose, behalve Céline Dion!") wordt geen maker.
 */
export async function scrapeKennemerTheater({ page, theater, robots, waitForTurn, log, warn = log }) {
  const zwaar = await blokkeerZwareBronnen(page, { ookScripts: true });
  const cards = await scrapePepperedListing({ page, theater, robots, waitForTurn, log, warn, agendaPath: AGENDA_PATH });
  const resolveDate = createRowDateResolver();
  const buildId = createIdBuilder();
  const opgehaaldOp = new Date().toISOString();
  const shows = [];
  const rowsByShowId = new Map();
  const zonderGenre = {};

  for (const card of cards) {
    if (!card.titel || !card.detailHref) continue;
    const detailUrl = new URL(card.detailHref, theater.baseUrl).toString();
    const genre = normalizeGenreFromList(card.genres);
    if (!genre && card.genres.length) zonderGenre[card.genres.join(', ')] = (zonderGenre[card.genres.join(', ')] ?? 0) + 1;
    const ondertitelIsMaker = card.subtitle && !isWervend(card.subtitle);
    for (const row of card.rows) {
      const beschikbaarheid = classifyPepperedButton(row.buttonText);
      if (beschikbaarheid === null) continue;
      const when = resolveDate(row);
      if (!when) {
        log(`kon datum niet bepalen: "${row.dateText}" (${card.titel}) — overgeslagen.`);
        continue;
      }
      const ticketUrl = row.buttonHref && /^https?:/.test(row.buttonHref) ? row.buttonHref : null;
      shows.push({
        id: buildId(theater.id, card.titel, when.datum, when.tijd),
        titel: card.titel,
        theaterId: theater.id,
        theaterNaam: theater.naam,
        stad: theater.stad,
        podiumpas: theater.podiumpas,
        datum: when.datum,
        tijd: when.tijd,
        genre: genre ?? (card.genres.length ? 'Overig' : null),
        genreRuw: card.genres.join(', ') || null,
        beschikbaarheid,
        beschrijving: card.tagline ?? (ondertitelIsMaker ? null : card.subtitle),
        maker: ondertitelIsMaker ? card.subtitle : null,
        reserverenUrl: ticketUrl ?? detailUrl,
        bron: detailUrl,
        opgehaaldOp,
      });
      rowsByShowId.set(shows.at(-1).id, row);
    }
  }

  logUnknownButtons(log, shows, rowsByShowId);
  if (Object.keys(zonderGenre).length) {
    warn(`genretags zonder bekend genre (nu Overig): ${Object.entries(zonderGenre).map(([k, n]) => `${k} (${n})`).join(', ')}`);
  }
  log(`${zwaar.verzoeken()} verzoek(en) naar de site (plus robots.txt); ${zwaar.geblokkeerd()} afbeeldingen/scripts/fonts niet geladen`);
  // Cabaret: artiest in de titel, voorstelling in het makerveld.
  return dedupeShows(shows).map((s) => pasTitelConventieToe(s, { artiest: s.titel, voorstelling: s.maker, makerWordtLeeg: true }));
}
