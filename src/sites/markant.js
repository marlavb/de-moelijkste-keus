import { createIdBuilder } from '../lib/normalize.js';
import { normalizeGenre, normalizeGenreFromList, isBekendGenre } from '../lib/genre.js';
import { pasTitelConventieToe, isWervend } from '../lib/titels.js';
import { blokkeerZwareBronnen } from '../lib/zwareBronnen.js';
import { scrapePepperedListing, createRowDateResolver, classifyPepperedButton, logUnknownButtons, dedupeShows } from '../lib/peppered.js';

const AGENDA_PATH = '/nl/agenda';

// Podiumpas bij Markant (bron: https://www.markantmaashorst.nl/nl/podiumpas-
// qz2t, 6 okt 2026): "Kies een reguliere theatervoorstelling onder €50,-,
// want de Podiumpas is niet geldig bij verhuringen, voorstellingen met een
// verkoop door derden, voorstellingen boven €50,- en voorstellingen die te
// gast zijn." Uit de agenda af te leiden: de prijs (op de kaart, inclusief
// € 2 ticketkosten: of die meetelt staat er niet, dus we nemen de prijs
// zoals Markant hem toont) en verkoop door derden (knop "Externe verkoop").
// "Te gast" en verhuringen staan niet als label in de agenda: die passen we
// niet toe (akkoord 6 okt 2026, open vraag 7).
const PODIUMPAS_PRIJSGRENS = 50;

/** Laagste €-bedrag in de prijstekst ("Normaal € 49,50 … € 49,50"), of null. */
export function laagstePrijs(tekst) {
  const bedragen = [...String(tekst ?? '').matchAll(/€\s*(\d+)(?:[,.](\d{2}|-))?/g)].map((m) => Number(`${m[1]}.${/\d{2}/.test(m[2] ?? '') ? m[2] : '00'}`));
  return bedragen.length ? Math.min(...bedragen) : null;
}

/**
 * Markant Theater Maashorst (Uden).
 *
 * Structuur (geïnspecteerd op https://www.markantmaashorst.nl/nl/agenda, 6
 * okt 2026): Peppered-platform (lib/peppered.js), 18 kaarten per pagina, 12
 * pagina's (p54_page, toegestaan door robots.txt; crawl-delay 5 s). Per
 * kaart titel, ondertitel, genres, prijs ("Normaal € 49,50"); per speeldatum
 * een rij met datum en tijd (data-event-start), zaal en knop (Tickets,
 * Wachtlijst, Externe verkoop). Reeksen (Christel de Laat, 9 data) staan als
 * losse rijen op de kaart: geen detailpagina's nodig. ~13 verzoeken per run.
 *
 * De site zit achter BunnyCDN, net als Isala en Parktheater: krijgen we een
 * wachtrij of controlepagina, dan vindt de listing geen kaarten en gooit
 * hij (vangnet); dan Markant pauzeren, niet omzeilen.
 *
 * Titels: bij cabaret artiest/voorstelling ("Sara Kroos" / "Prikkelarme
 * Kermis (reprise)") → "Prikkelarme Kermis (reprise) – Sara Kroos"; anders
 * de ondertitel als maker, tenzij wervend ("Met o.a. Suzan Seegers").
 * Weglaten: info-items zonder genre met alleen "Meer info" (Taxatiedag).
 */
export async function scrapeMarkant({ page, theater, robots, waitForTurn, log, warn = log }) {
  const zwaar = await blokkeerZwareBronnen(page, { ookScripts: true });
  const cards = await scrapePepperedListing({ page, theater, robots, waitForTurn, log, warn, agendaPath: AGENDA_PATH });
  const resolveDate = createRowDateResolver();
  const buildId = createIdBuilder();
  const opgehaaldOp = new Date().toISOString();
  const shows = [];
  const rowsByShowId = new Map();
  const reden = {};
  const weg = {};
  const onbekend = {};

  for (const card of cards) {
    if (!card.titel || !card.detailHref) continue;
    const detailUrl = new URL(card.detailHref, theater.baseUrl).toString();
    for (const g of card.genres) if (!isBekendGenre(g)) onbekend[g] = (onbekend[g] ?? 0) + 1;
    const prijs = laagstePrijs(card.priceText);

    for (const row of card.rows) {
      // Geen voorstelling: info-item zonder genre en zonder kaartverkoop.
      if (card.genres.length === 0 && /meer info/i.test(row.buttonText ?? '')) {
        weg[card.titel] = (weg[card.titel] ?? 0) + 1;
        continue;
      }
      const beschikbaarheid = classifyPepperedButton(row.buttonText);
      if (beschikbaarheid === null) continue;
      const when = resolveDate(row);
      if (!when) {
        log(`kon datum niet bepalen: "${row.dateText}" (${card.titel}) — overgeslagen.`);
        continue;
      }
      const waarom =
        (/externe verkoop/i.test(row.buttonText ?? '') && 'verkoop door derden') ||
        (prijs != null && prijs > PODIUMPAS_PRIJSGRENS && `prijs > € ${PODIUMPAS_PRIJSGRENS}`) ||
        null;
      if (waarom) reden[waarom] = (reden[waarom] ?? 0) + 1;
      const ticketUrl = row.buttonHref && /^https?:/.test(row.buttonHref) ? row.buttonHref : null;
      const makerOk = card.subtitle && !isWervend(card.subtitle);
      const eigenGebouw = !row.location || /markant/i.test(row.location);
      const show = {
        id: buildId(theater.id, card.titel, when.datum, when.tijd),
        titel: card.titel,
        theaterId: theater.id,
        theaterNaam: theater.naam,
        stad: theater.stad,
        ...(eigenGebouw ? {} : { locatie: row.location }),
        zaal: row.venue ?? null,
        podiumpas: theater.podiumpas && !waarom,
        datum: when.datum,
        tijd: when.tijd,
        genre: normalizeGenreFromList(card.genres) ?? normalizeGenre(card.genres[0] ?? null),
        genreRuw: card.genres.join(', ') || null,
        beschikbaarheid,
        beschrijving: makerOk ? card.tagline : card.subtitle,
        maker: makerOk ? card.subtitle : null,
        prijs,
        reserverenUrl: ticketUrl ?? detailUrl,
        bron: detailUrl,
        opgehaaldOp,
      };
      shows.push(pasTitelConventieToe(show, { artiest: card.titel, voorstelling: card.subtitle, makerWordtLeeg: true }));
      rowsByShowId.set(shows.at(-1).id, row);
    }
  }

  const lijst = (o) => Object.entries(o).map(([k, n]) => `${k} (${n})`).join(', ');
  if (Object.keys(reden).length) log(`podiumpas: false bij ${lijst(reden)}`);
  if (Object.keys(weg).length) log(`weggelaten (geen voorstelling): ${lijst(weg)}`);
  if (Object.keys(onbekend).length) warn(`onbekende brongenres (nu Overig): ${lijst(onbekend)}`);
  logUnknownButtons(log, shows, rowsByShowId);
  log(`${zwaar.verzoeken()} verzoek(en) naar de site (plus robots.txt); ${zwaar.geblokkeerd()} afbeeldingen/scripts/fonts niet geladen`);
  return dedupeShows(shows);
}
