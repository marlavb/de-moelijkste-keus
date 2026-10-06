import { createIdBuilder } from '../lib/normalize.js';
import { normalizeGenreFromList, isBekendGenre } from '../lib/genre.js';
import { pasTitelConventieToe, isWervend } from '../lib/titels.js';
import { blokkeerZwareBronnen } from '../lib/zwareBronnen.js';
import {
  scrapePepperedListing,
  leesSpeeldataVanDetail,
  createRowDateResolver,
  classifyPepperedButton,
  logUnknownButtons,
  dedupeShows,
  laagstePrijs,
} from '../lib/peppered.js';

const AGENDA_PATH = '/programma';

// Podiumpas bij Parktheater Eindhoven (bron: https://www.parktheater.nl/
// podiumpas-q3yt, 6 okt 2026): "reguliere en professionele voorstellingen in
// het Parktheater en Pand P", niet bij verhuringen (Federatiebal,
// Theaterplan, Theaterkoor Nutsz), schoolvoorstellingen, eetvoorstellingen
// (Robèrt van Beckhoven), ticketprijzen boven € 50, busreizen, Moord in het
// Parktheater en voorstellingen met kaartverkoop door derden (Mega Sint Show,
// Arno's Theater). Uit de agenda af te leiden: locatie, prijs en de genoemde
// namen. Reserveren alleen telefonisch.
const PODIUMPAS_PRIJSGRENS = 50;
const PODIUMPAS_UITGESLOTEN = /\b(moord in het parktheater|mega sint show|arno'?s theater|rob[eè]rt van beckhoven|federatiebal|theaterplan|theaterkoor nutsz|busreis)/i;
const EIGEN_LOCATIE = /parktheater eindhoven|pand p\b/i;

// Labels op de kaart die geen genre zijn.
const GEEN_GENRE = new Set(['nieuw in verkoop', 'no dutch required', 'pay what you want', 'middagvoorstelling', '2+', '4+', '6+', '8+']);

/**
 * Parktheater Eindhoven.
 *
 * GEPAUZEERD sinds 6 okt 2026 (config.js): bij de verkenning kwamen we bij
 * ons 5e verzoek in 7 minuten in de BunnyCDN-wachtrij (/csq/queue). We doen
 * geen verzoeken tot het theater antwoordt; deze scraper staat klaar.
 *
 * Structuur (geïnspecteerd op https://www.parktheater.nl/programma, 6 okt
 * 2026): Peppered-platform (lib/peppered.js), 21 kaarten per pagina, ~20
 * pagina's (p54_page, crawl-delay 5 s). Per kaart titel, ondertitel,
 * genres, prijs ("Rang 1 | Normaal | € 39,-") en één rij met data-event-start,
 * locatie, zaal en knop. Een reeks toont alleen "Data & tijden": dan de
 * speeldata van de productiepagina (één verzoek per productie). ~21 + het
 * aantal reeksen aan verzoeken.
 *
 * Titels: titel = voorstelling, ondertitel = maker ("Praktische bezwaren" /
 * "Kiki Schippers"); bij cabaret "Praktische bezwaren – Kiki Schippers".
 */
export async function scrapeParktheater({ page, theater, robots, waitForTurn, log, warn = log }) {
  const zwaar = await blokkeerZwareBronnen(page, { ookScripts: true, ookOverig: true });
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
    const genres = card.genres.filter((g) => !GEEN_GENRE.has(g.trim().toLowerCase()));
    // Zonder genre (alleen labels als "nieuw in verkoop"): een bijeenkomst, geen voorstelling.
    if (genres.length === 0) {
      weg[card.titel] = (weg[card.titel] ?? 0) + 1;
      continue;
    }
    for (const g of genres) if (!isBekendGenre(g)) onbekend[g] = (onbekend[g] ?? 0) + 1;
    const prijs = laagstePrijs(card.priceText);

    // Een reeks: de speeldata van de productiepagina.
    let rows = card.rows;
    if (rows.length === 1 && !rows[0].start && /data\s*&\s*tijden/i.test(rows[0].buttonText ?? '')) {
      const detail = await leesSpeeldataVanDetail({ page, url: detailUrl, robots, waitForTurn, log });
      if (!detail) continue;
      rows = detail.map((d) => ({ start: `${d.datum} ${d.tijd ?? '00:00'}:00`, timeText: d.tijd, location: rows[0].location, venue: rows[0].venue, buttonText: d.knopTekst, buttonHref: d.href }));
    }

    for (const row of rows) {
      const beschikbaarheid = classifyPepperedButton(row.buttonText);
      if (beschikbaarheid === null) continue;
      const when = resolveDate(row);
      if (!when) {
        log(`kon datum niet bepalen: "${row.dateText}" (${card.titel}) — overgeslagen.`);
        continue;
      }
      const eigen = !row.location || EIGEN_LOCATIE.test(row.location);
      const waarom =
        (!eigen && 'externe locatie') ||
        (PODIUMPAS_UITGESLOTEN.test(`${card.titel} ${card.subtitle ?? ''}`) && 'uitgesloten naam') ||
        (prijs != null && prijs > PODIUMPAS_PRIJSGRENS && `prijs > € ${PODIUMPAS_PRIJSGRENS}`) ||
        null;
      if (waarom) reden[waarom] = (reden[waarom] ?? 0) + 1;
      const makerOk = card.subtitle && !isWervend(card.subtitle);
      const ticketUrl = row.buttonHref && /^https?:/.test(row.buttonHref) ? row.buttonHref : null;
      const show = {
        id: buildId(theater.id, card.titel, when.datum, when.tijd),
        titel: card.titel,
        theaterId: theater.id,
        theaterNaam: theater.naam,
        stad: theater.stad,
        ...(eigen ? {} : { locatie: row.location }),
        zaal: eigen ? row.venue ?? null : null,
        podiumpas: theater.podiumpas && !waarom,
        datum: when.datum,
        tijd: when.tijd,
        genre: normalizeGenreFromList(genres) ?? 'Overig',
        genreRuw: card.genres.join(', ') || null,
        beschikbaarheid,
        beschrijving: card.tagline ?? (makerOk ? null : card.subtitle),
        maker: makerOk ? card.subtitle : null,
        prijs,
        reserverenUrl: ticketUrl ?? detailUrl,
        bron: detailUrl,
        opgehaaldOp,
      };
      shows.push(pasTitelConventieToe(show, { artiest: card.subtitle, voorstelling: card.titel, makerWordtLeeg: true }));
      rowsByShowId.set(shows.at(-1).id, row);
    }
  }

  const lijst = (o) => Object.entries(o).map(([k, n]) => `${k} (${n})`).join(', ');
  if (Object.keys(reden).length) log(`podiumpas: false bij ${lijst(reden)}`);
  if (Object.keys(weg).length) log(`weggelaten (geen genre, geen voorstelling): ${lijst(weg)}`);
  if (Object.keys(onbekend).length) warn(`onbekende brongenres (nu Overig): ${lijst(onbekend)}`);
  logUnknownButtons(log, shows, rowsByShowId);
  log(`${zwaar.verzoeken()} verzoek(en) naar de site (plus robots.txt); ${zwaar.geblokkeerd()} afbeeldingen/scripts/fonts niet geladen`);
  return dedupeShows(shows);
}
