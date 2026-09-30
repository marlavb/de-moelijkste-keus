import { pagineerListing } from '../lib/peppered.js';
import { createDutchAbbrevDayParser, extractTime, createIdBuilder } from '../lib/normalize.js';
import { normalizeGenre } from '../lib/genre.js';
import { pasTitelConventieToe } from '../lib/titels.js';
import { vervallenStatus } from '../lib/beschikbaarheid.js';

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
 * - De agendapagina is gepagineerd via ?page=N (robots.txt staat dit expliciet
 *   toe met "Allow: /*?page=*", ondanks de algemene "Disallow: /*?*"-regel).
 *   Elke pagina toont acht producties als <li data-entry-id="..."> ("eventCard").
 * - Zo'n kaart toont title/subtitle/genres/tagline en een top-date die óf een
 *   los datum+tijd is (eenmalige voorstelling, met een directe ticketlink),
 *   óf een datumrange is (bv. "wo 9 sep - za 3 apr") voor een reeks
 *   voorstellingen — in dat geval geeft de kaart zelf geen individuele datums.
 *   .subtitle is de maker/artiest (bv. "Greg Shapiro" bij "King Me") — kan
 *   leeg zijn bij een groepsproductie zonder los vermeld hoofdpersoon.
 * - De detailpagina van elke productie (/agenda/<slug>) bevat wél een
 *   volledige lijst van losse voorstellingen als <li class="subshow">, elk
 *   met eigen datum, tijd en ticketknop. Bij sommige voorstellingen is die
 *   knop een JS-call (javascript:vdm_order(...)) in plaats van een echte URL
 *   (eigen boekingswidget) — dan valt reserverenUrl terug op de detailpagina.
 * - Om altijd de losse voorstellingsdatums te pakken (in plaats van alleen de
 *   startdatum van een reeks), bezoeken we voor élke productie de
 *   detailpagina — dat is trager, maar wel de enige betrouwbare bron.
 */
export async function scrapeBellevue({ page, theater, robots, waitForTurn, log, warn }) {
  if (!robots.isAllowed(AGENDA_PATH)) {
    log(`robots.txt verbiedt ${AGENDA_PATH} op ${theater.baseUrl} — sla over.`);
    return [];
  }

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
    extract: () => {
      return Array.from(document.querySelectorAll('li[data-entry-id]')).map((card) => {
        const entryId = card.getAttribute('data-entry-id');
        const titel = card.querySelector('h3.title')?.textContent.trim() ?? null;
        const beschrijving = card.querySelector('.tagline')?.textContent.trim() ?? null;
        const detailHref = card.querySelector('a.desc')?.getAttribute('href') ?? null;
        const genre = card.querySelector('.genres__link')?.textContent.trim() ?? null;
        const maker = card.querySelector('.subtitle')?.textContent.trim() || null;
        return { entryId, titel, beschrijving, detailHref, genre, maker };
      });
    },
  });

  const buildId = createIdBuilder();
  const opgehaaldOp = new Date().toISOString();
  const shows = [];
  // Twee kaarten met dezelfde detailpagina zouden anders elke voorstelling
  // dubbel opleveren (met een "-2"-id-suffix van buildId).
  const visitedDetailUrls = new Set();
  let andereLocatie = 0;
  let besloten = 0;

  for (const card of cards) {
    if (!card.titel || !card.detailHref) continue;
    const detailUrl = new URL(card.detailHref, theater.baseUrl).toString();
    const detailPath = new URL(detailUrl).pathname;
    if (visitedDetailUrls.has(detailUrl)) continue;
    visitedDetailUrls.add(detailUrl);

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
          // .buttonBox bevat ofwel een <a> (bestelbaar/wachtlijst), ofwel een
          // <span>/<button> (bv. "Geweest", "binnenkort") — pak gewoon de
          // volledige tekst, ongeacht het element-type.
          const statusTekst = li.querySelector('.buttonBox')?.textContent.trim().replace(/\s+/g, ' ') ?? null;
          const venue = li.querySelector('.locationBox .venue')?.textContent.trim() ?? null;
          return { dagTekst, tijdTekst, href, statusTekst, venue };
        });
      });
    } catch (err) {
      log(`kon detailpagina niet laden voor "${card.titel}" (${detailUrl}): ${err.message} — overgeslagen.`);
      continue;
    }

    const parseDay = createDutchAbbrevDayParser();
    for (const sub of subshows) {
      if (!sub.dagTekst) continue;
      // Langlopende producties tonen soms ook al voorbije uitvoeringen
      // ("Geweest") in dezelfde lijst — die horen niet in een
      // toekomstgerichte agenda.
      if (sub.statusTekst?.trim().toLowerCase() === 'geweest') continue;
      const datum = parseDay(sub.dagTekst);
      if (!datum) {
        log(`kon datum-label niet parsen: "${sub.dagTekst}" (${card.titel}) — overgeslagen.`);
        continue;
      }
      // Tournee: Bellevue markeert ook speeldata elders als "in-own-location",
      // maar zet dan "op tournee" als zaal (met de echte plek erboven, bv.
      // "Zaal 3 | Het Nationale Theater | Den Haag", en een "kaarten via"-link
      // naar dat theater). Besloten voorstellingen zijn niet publiek te
      // boeken. Pas ná parseDay, voor de jaar-rollover.
      if (/tournee/i.test(sub.venue ?? '')) {
        andereLocatie++;
        continue;
      }
      const extern = sub.href && /^https?:/.test(sub.href) && !new URL(sub.href).hostname.endsWith('theaterbellevue.nl');
      if (extern && /kaarten via/i.test(sub.statusTekst ?? '')) {
        log(`let op: "kaarten via" naar ${new URL(sub.href).hostname} in zaal "${sub.venue}" (${card.titel}, ${datum}) — meegenomen.`);
      }
      if (/^besloten$/i.test(sub.statusTekst?.trim() ?? '')) {
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

  log(`${andereLocatie} speeldatum(s) op tournee en ${besloten} besloten voorstelling(en) overgeslagen.`);
  // Titelconventie cabaret (lib/titels.js): bij dit theater staat de voorstelling in de titel, artiest in het makerveld.
  return shows.map((s) => pasTitelConventieToe(s, { artiest: s.maker, voorstelling: s.titel, makerWordtLeeg: true }));
}
