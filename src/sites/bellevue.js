import { pagineerListing, leesPepperedKaarten } from '../lib/peppered.js';
import { createDutchAbbrevDayParser, extractTime, createIdBuilder } from '../lib/normalize.js';
import { normalizeGenre } from '../lib/genre.js';
import { pasTitelConventieToe } from '../lib/titels.js';
import { vervallenStatus } from '../lib/beschikbaarheid.js';
import { blokkeerZwareBronnen } from '../lib/zwareBronnen.js';

const AGENDA_PATH = '/agenda';
const MAX_LISTING_PAGES = 60;

// Bellevue's boekingsknop gebruikt tekst-varianten als "kaarten via",
// "Kaarten" (ook voor hun eigen javascript:-boekingswidget, dat is dus wél
// beschikbaar) en "laatste kaarten" voor beschikbare plekken, en een
// aparte "Wachtlijst"-knop zodra iets vol zit. Update: bij het bouwen van
// Frascati/De Kleine Komedie (zelfde platform) bleken ook "uitverkocht",
// "Volgeboekt", "Tickets" en "Aanmelden via email" voor te komen — die
// hadden we hier niet expliciet gevangen, nu wel. Randgevallen als
// "Geweest" (voorbije datum) en "binnenkort" (nog niet in verkoop) gaan
// niet over voorraad en worden dus "onbekend". "geannuleerd" wordt sinds
// 30 sep 2026 "afgelast" (zie beschikbaarheid.js).
function classifyBeschikbaarheid(statusTekst) {
  const tekst = (statusTekst ?? '').trim().toLowerCase();
  const vervallen = vervallenStatus(tekst);
  if (vervallen) return vervallen;
  if (tekst.includes('wachtlijst')) return 'wachtlijst';
  if (tekst.includes('uitverkocht') || tekst.includes('volgeboekt')) return 'uitverkocht';
  if (tekst.includes('kaarten') || tekst.includes('tickets') || tekst.includes('aanmelden')) return 'beschikbaar';
  return 'onbekend';
}

/**
 * Haalt de volledige agenda van Theater Bellevue op.
 *
 * Structuur (geïnspecteerd op https://www.theaterbellevue.nl/agenda, aug 2026):
 * - De agendapagina is gepagineerd (?p54_page=N; robots.txt staat
 *   "Allow: /*?page=*" toe, zie pagineerListing). Elke pagina toont acht
 *   producties als <li data-entry-id="..."> ("eventCard").
 * - Zo'n kaart toont title/subtitle/genres/tagline. .subtitle is de
 *   maker/artiest (bv. "Greg Shapiro" bij "King Me").
 * - Sinds okt 2026 (zoals Frascati, zelfde platform): elke kaart met meer
 *   speeldata heeft op de agendapagina zelf een verborgen paneel
 *   <div id="show{ID}Dates"> met dezelfde <li class="subshow">-rijen als de
 *   detailpagina (datum, tijd, .buttonBox, .locationBox). Een kaart met één
 *   speeldatum toont die op de kaart (.dateTimeContainer). We bezoeken dus
 *   geen detailpagina's meer: ~24 verzoeken per run i.p.v. ~205 (crawl-delay
 *   5 s: ~2 min i.p.v. ~17 min). Bij een knop met een JS-call
 *   (javascript:vdm_order(...)) valt reserverenUrl terug op de detailpagina.
 * - Tournee (rij in-other-location, of zaal "op tournee") en besloten
 *   voorstellingen slaan we over, zoals voorheen.
 */
export async function scrapeBellevue({ page, theater, robots, waitForTurn, log, warn }) {
  if (!robots.isAllowed(AGENDA_PATH)) {
    log(`robots.txt verbiedt ${AGENDA_PATH} op ${theater.baseUrl} — sla over.`);
    return [];
  }
  // Afbeeldingen, fonts en scripts zijn niet nodig: de agenda staat in de HTML.
  const zwaar = await blokkeerZwareBronnen(page, { ookScripts: true });

  const cards = await pagineerListing({
    page,
    theater,
    robots,
    waitForTurn,
    log,
    warn,
    agendaPath: AGENDA_PATH,
    maxPages: MAX_LISTING_PAGES,
    label: 'producties',
    sleutelVan: (card) => card.entryId,
    extract: leesPepperedKaarten,
  });

  const buildId = createIdBuilder();
  const opgehaaldOp = new Date().toISOString();
  const shows = [];
  // Twee kaarten met dezelfde detailpagina zouden anders elke voorstelling
  // dubbel opleveren (met een "-2"-id-suffix van buildId).
  const gezien = new Set();
  let andereLocatie = 0;
  let besloten = 0;
  let zonderRijen = 0;

  for (const card of cards) {
    if (!card.titel || !card.detailHref) continue;
    const detailUrl = new URL(card.detailHref, theater.baseUrl).toString();
    if (gezien.has(detailUrl)) continue;
    gezien.add(detailUrl);
    if (card.rijen.length === 0) zonderRijen++;

    const parseDay = createDutchAbbrevDayParser();
    for (const sub of card.rijen) {
      if (!sub.dagTekst) continue;
      // Langlopende producties tonen soms ook al voorbije uitvoeringen
      // ("Geweest") in dezelfde lijst — die horen niet in een
      // toekomstgerichte agenda.
      if (sub.statusTekst?.trim().toLowerCase() === 'geweest') continue;
      // Overzichtsrij van een tournee in het paneel ("Vanaf 20:00", "in 2027
      // in Haarlem, Rotterdam, …", "binnenkort", zonder link): geen
      // speeldatum. Op de detailpagina stond die rij niet.
      if (/^vanaf\b/i.test(sub.tijdTekst ?? '') && !sub.href) continue;
      const datum = parseDay(sub.dagTekst);
      if (!datum) {
        log(`kon datum-label niet parsen: "${sub.dagTekst}" (${card.titel}) — overgeslagen.`);
        continue;
      }
      // Tournee: speeldata elders ("op tournee" als zaal, of een rij
      // in-other-location). Besloten voorstellingen zijn niet publiek te
      // boeken. Pas ná parseDay, voor de jaar-rollover.
      // In het paneel op de agendapagina heet de zaal niet "op tournee";
      // daar staat de plek als supertitle ("De Schuur, Haarlem") en een knop
      // "kaarten via" naar dat theater. Op de detailpagina waren dat precies
      // de rijen "op tournee" (22 in de nachtrun van 7 okt 2026).
      const extern = sub.href && /^https?:/.test(sub.href) && !new URL(sub.href).hostname.endsWith('theaterbellevue.nl');
      if (sub.andereLocatie || /tournee/i.test(sub.venue ?? '') || (extern && /kaarten via/i.test(sub.statusTekst ?? ''))) {
        andereLocatie++;
        continue;
      }
      // Niet publiek te boeken: besloten, of "Niet verkoopbaar" (bv.
      // Presentatie de Schrijversstudio, alleen op de agendapagina).
      if (/^(besloten|niet verkoopbaar)$/i.test(sub.statusTekst?.trim() ?? '')) {
        besloten++;
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
        podiumpas: theater.podiumpas,
        datum,
        tijd,
        genre: normalizeGenre(card.genre),
        genreRuw: card.genre,
        beschikbaarheid: classifyBeschikbaarheid(sub.statusTekst),
        beschrijving: card.beschrijving,
        maker: card.maker,
        reserverenUrl: ticketUrl ?? detailUrl,
        bron: detailUrl,
        opgehaaldOp,
      });
    }
  }

  // Sanity check: een agenda vol kaarten zonder één speeldatum betekent dat
  // het paneel niet meer op de agendapagina staat (platform veranderd).
  if (cards.length > 0 && shows.length === 0) {
    throw new Error(`${cards.length} producties maar geen enkele speeldatum op de agendapagina's — paneel show{ID}Dates verdwenen?`);
  }
  if (zonderRijen > cards.length / 2) warn(`${zonderRijen} van ${cards.length} producties zonder speeldata op de agendapagina — paneel veranderd?`);
  log(`${andereLocatie} speeldatum(s) op tournee en ${besloten} besloten of niet verkoopbare voorstelling(en) overgeslagen.`);
  log(`${zwaar.verzoeken()} verzoek(en) naar de site (plus robots.txt); ${zwaar.geblokkeerd()} afbeeldingen/scripts/fonts niet geladen`);
  // Titelconventie cabaret (lib/titels.js): bij dit theater staat de voorstelling in de titel, artiest in het makerveld.
  return shows.map((s) => pasTitelConventieToe(s, { artiest: s.maker, voorstelling: s.titel, makerWordtLeeg: true }));
}
