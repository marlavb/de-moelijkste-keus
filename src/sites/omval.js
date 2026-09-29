import { pagineerListing, leesSpeeldataVanDetail } from '../lib/peppered.js';
import { createDutchAbbrevDayParser, extractTime, createIdBuilder } from '../lib/normalize.js';
import { normalizeGenreFromList } from '../lib/genre.js';
import { pasTitelConventieToe } from '../lib/titels.js';

const AGENDA_PATH = '/voorstellingen';
const MAX_LISTING_PAGES = 30;

// Zelfde twee-signalen-aanpak als Muziekgebouw aan 't IJ (zelfde platform):
// een <a class="status-info"> met tekst-label voor uitzonderingen, de
// bestelknop (.btn-order) met eigen status-suffix als fallback/bevestiging.
function classifyBeschikbaarheid(statusInfoText, btnOrderStatus) {
  const info = (statusInfoText ?? '').toLowerCase();
  if (info.includes('wachtlijst')) return 'wachtlijst';
  if (info.includes('uitverkocht')) return 'uitverkocht';

  const btn = (btnOrderStatus ?? '').toLowerCase();
  if (btn.includes('wachtlijst')) return 'wachtlijst';
  if (btn.includes('uitverkocht')) return 'uitverkocht';
  if (btn.includes('normaal') || btn.includes('laatste')) return 'beschikbaar';

  return 'onbekend';
}

/**
 * Haalt de volledige agenda van Theater De Omval op.
 *
 * Structuur (geïnspecteerd op https://www.theaterdeomval.nl/voorstellingen,
 * aug 2026) — zelfde platform als Muziekgebouw aan 't IJ, dus grotendeels
 * dezelfde aanpak:
 * - robots.txt: crawl-delay 5s voor "*", paginering via ?page=N expliciet
 *   toegestaan (net als bij Muziekgebouw). Een query-param-filter als
 *   ?production_type=default zou dat NIET zijn (algemene "Disallow: /*?*"
 *   zonder specifieke Allow), dus die vermijden we — filteren op
 *   voorstelling-vs-film doen we daarom client-side.
 * - Server-rendered, gepagineerd (8 kaarten/pagina, tot en met pagina
 *   16-17). Paginaparameter van pagina 1 afgelezen; we stoppen zodra een
 *   pagina geen nieuwe kaarten meer oplevert.
 * - In tegenstelling tot Muziekgebouw mixt deze agenda ECHTE
 *   voorstellingen (class "production-type-default") met
 *   filmvertoningen (class "production-type-movie") — we nemen alleen
 *   "default" mee, films vallen buiten de scope van een theateragenda.
 * - Genre-tags (.genres__link) zijn hier, anders dan bij Muziekgebouw, wél
 *   gewoon in de initiële HTML aanwezig — geen extra requests nodig.
 * - .subtitle is de maker/artiest (bv. "Najib Amhali & Roué Verveer" bij
 *   "Alles is Comedy"), los van .tagline (de korte marketingtekst die we
 *   als beschrijving gebruiken) — kan leeg zijn.
 * - Datum staat als platte tekst "di 3 nov" (weekdag-afkorting, dag,
 *   maand-afkorting, GEEN jaartal) — zelfde formaat als Theater Bellevue,
 *   dus de bestaande createDutchAbbrevDayParser() volstaat.
 */
export async function scrapeOmval({ page, theater, robots, waitForTurn, log, warn }) {
  if (!robots.isAllowed(AGENDA_PATH)) {
    log(`robots.txt verbiedt ${AGENDA_PATH} op ${theater.baseUrl} — sla over.`);
    return [];
  }

  // "Nieuw" telt over ALLE kaarten, films inbegrepen: een pagina die
  // toevallig alléén films bevat (zoals hier pagina 1) is geen teken dat de
  // paginering voorbij is. De films halen we er daarna pas uit.
  const kaarten = await pagineerListing({
    page,
    theater,
    robots,
    waitForTurn,
    log,
    warn,
    agendaPath: AGENDA_PATH,
    maxPages: MAX_LISTING_PAGES,
    label: 'kaarten',
    sleutelVan: (item) => item.sleutel,
    extract: () => {
      const cards = Array.from(document.querySelectorAll('.eventCard'));
      // Eén kaart per speeldatum; entry-id + datum + tijd is uniek.
      const sleutelVan = (el) =>
        [
          el.getAttribute('data-entry-id'),
          el.querySelector('.top-date .start')?.textContent.trim(),
          el.querySelector('.top-date .time')?.textContent.trim(),
        ].join('|');
      return cards.map((el) => {
        const btnOrderEl = el.querySelector('.btn-order');
        return {
          sleutel: sleutelVan(el),
          isFilm: el.className.includes('production-type-movie'),
          titel: el.querySelector('.title')?.textContent.trim() ?? null,
          detailHref: el.querySelector('a.desc')?.getAttribute('href') ?? null,
          beschrijving: el.querySelector('.tagline')?.textContent.trim() ?? null,
          maker: el.querySelector('.subtitle')?.textContent.trim() || null,
          dagTekst: el.querySelector('.top-date .start')?.textContent.trim() ?? null,
          tijdTekst: el.querySelector('.top-date .time')?.textContent.trim() ?? null,
          genres: Array.from(el.querySelectorAll('.genres__link')).map((g) => g.textContent.trim()),
          statusInfoText: el.querySelector('.status-info .label')?.textContent.trim() ?? null,
          btnOrderStatus: btnOrderEl?.className ?? null,
          ticketHref: btnOrderEl?.getAttribute('href') ?? null,
        };
      });
    },
  });

  const rawItems = kaarten.filter((item) => !item.isFilm);
  log(`${kaarten.length} kaarten, ${rawItems.length} na uitfilteren films`);

  const parseDay = createDutchAbbrevDayParser();
  const buildId = createIdBuilder();
  const opgehaaldOp = new Date().toISOString();
  const shows = [];

  let detailBezocht = 0;
  const basisVan = (item) => ({
    titel: item.titel,
    theaterId: theater.id,
    theaterNaam: theater.naam,
    stad: theater.stad,
    podiumpas: theater.podiumpas,
    genre: normalizeGenreFromList(item.genres),
    genreRuw: item.genres.join(', ') || null,
    beschrijving: item.beschrijving,
    maker: item.maker,
    bron: theater.agendaUrl,
    opgehaaldOp,
  });

  for (const item of rawItems) {
    if (!item.titel || !item.dagTekst) continue;
    const datum = parseDay(item.dagTekst);
    if (!datum) {
      log(`kon datum niet parsen: "${item.dagTekst}" (${item.titel}) — overgeslagen.`);
      continue;
    }
    const tijd = extractTime(item.tijdTekst);
    const detailUrl = item.detailHref ? new URL(item.detailHref, theater.baseUrl).toString() : theater.agendaUrl;
    const ticketUrl = item.ticketHref ? new URL(item.ticketHref, theater.baseUrl).toString() : null;

    // Kaart zonder tijd: vaak een samengevatte reeks ("wo 7 okt en do 8 okt").
    // De losse speeldata en tijden staan op de productiepagina.
    if (!tijd && item.detailHref) {
      const rijen = await leesSpeeldataVanDetail({ page, url: detailUrl, robots, waitForTurn, log });
      if (rijen?.length) {
        detailBezocht++;
        for (const r of rijen) {
          const href = r.href && !r.href.startsWith('javascript:') ? new URL(r.href, theater.baseUrl).toString() : null;
          shows.push({
            ...basisVan(item),
            id: buildId(theater.id, item.titel, r.datum, r.tijd),
            datum: r.datum,
            tijd: r.tijd,
            beschikbaarheid: classifyBeschikbaarheid(r.knopTekst, r.knopClass),
            reserverenUrl: href ?? detailUrl,
          });
        }
        continue;
      }
    }

    shows.push({
      ...basisVan(item),
      id: buildId(theater.id, item.titel, datum, tijd),
      titel: item.titel,
      theaterId: theater.id,
      theaterNaam: theater.naam,
      stad: theater.stad,
      podiumpas: theater.podiumpas,
      datum,
      tijd,
      genre: normalizeGenreFromList(item.genres),
      genreRuw: item.genres.join(', ') || null,
      beschikbaarheid: classifyBeschikbaarheid(item.statusInfoText, item.btnOrderStatus),
      beschrijving: item.beschrijving,
      maker: item.maker,
      reserverenUrl: ticketUrl ?? detailUrl,
      bron: theater.agendaUrl,
      opgehaaldOp,
    });
  }

  if (detailBezocht > 0) log(`${detailBezocht} productiepagina('s) gelezen voor reeksen zonder tijd op de kaart.`);
  // Titelconventie cabaret (lib/titels.js): bij dit theater staat de voorstelling in de titel, artiest in het makerveld.
  return shows.map((s) => pasTitelConventieToe(s, { artiest: s.maker, voorstelling: s.titel, makerWordtLeeg: true }));
}
