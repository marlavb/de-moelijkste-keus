import { createIdBuilder } from '../lib/normalize.js';
import { normalizeGenreFromList } from '../lib/genre.js';

const AGENDA_PATH = '/location/de-drukkerij/';

const MONTHS_ABBR = {
  jan: 1,
  feb: 2,
  mrt: 3,
  apr: 4,
  mei: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  okt: 10,
  nov: 11,
  dec: 12,
};

function pad2(n) {
  return String(n).padStart(2, '0');
}

// Datumlabels wisselen zelf tussen volledige ("24 september") en
// afgekorte ("1 okt") maandnamen, en tonen een jaartal alleen als de
// jaargrens gepasseerd wordt ("14 jan 2027") — daarna weer niet ("8
// april", nog steeds 2027). We normaliseren elke maandnaam naar de eerste
// 3 letters (dekt beide vormen) en gebruiken een jaartal-in-state-aanpak:
// een expliciet jaartal wint altijd, anders doorlopende rollover-logica.
function createDateParser(referenceDate) {
  let year = referenceDate.getFullYear();
  let lastMonth = referenceDate.getMonth() + 1;
  return function parseLabel(label) {
    const match = label
      .trim()
      .toLowerCase()
      .match(/(\d{1,2})\s+([a-zé]+)(?:\s+(\d{4}))?/);
    if (!match) return null;
    const day = parseInt(match[1], 10);
    const month = MONTHS_ABBR[match[2].slice(0, 3)];
    if (!month) return null;
    if (match[3]) {
      year = parseInt(match[3], 10);
    } else if (month < lastMonth) {
      year += 1;
    }
    lastMonth = month;
    return `${year}-${pad2(month)}-${pad2(day)}`;
  };
}

/**
 * Haalt de agenda van Karavaan - Theater de Drukkerij op.
 *
 * Structuur (geïnspecteerd op
 * https://www.karavaan.nl/location/de-drukkerij/, aug 2026):
 * - robots.txt: alleen /wp-admin/ verboden, geen crawl-delay.
 * - Server-rendered. Elke productiekaart is een <div data-genres='[...]'>
 *   met een schone, JSON-achtige genre-lijst die al dicht bij ons eigen
 *   schema zit (Theater/Dans/Muziektheater) — normalizeGenreFromList()
 *   voor het geval er ooit meer dan één waarde in staat.
 * - .tag-list bevat geen genre maar een "motief"-label (Inspirerend, Samen
 *   uit, ...) — niet bruikbaar als genre, dus genegeerd.
 * - Geen paginering nodig: alle producties (11) staan al op deze ene
 *   locatiepagina.
 * - Datum staat als los tekstlabel (<small>), zonder tijdstip — alleen
 *   deze locatiepagina toont dus geen aanvangstijd per voorstelling, tijd
 *   blijft null (zelfde afweging als bij Scala/Carré-achtige gevallen).
 * - Boekingslink ("kaarten & info") wijst naar dezelfde detailpagina als de
 *   titel/afbeelding — geen apart ticketsysteem zichtbaar op deze pagina,
 *   dus geen boekingsstatussignaal: beschikbaarheid blijft "onbekend".
 */
export async function scrapeKaravaan({ page, theater, robots, waitForTurn, log }) {
  if (!robots.isAllowed(AGENDA_PATH)) {
    log(`robots.txt verbiedt ${AGENDA_PATH} op ${theater.baseUrl} — sla over.`);
    return [];
  }

  await waitForTurn();
  await page.goto(theater.agendaUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

  const rawItems = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('[data-genres]')).map((el) => {
      let genres = [];
      try {
        genres = JSON.parse(el.getAttribute('data-genres'));
      } catch {
        genres = [];
      }
      const link = el.querySelector('a[href*="/voorstellingen/"]');
      return {
        titel: el.querySelector('h3')?.textContent.trim() ?? null,
        dagTekst: el.querySelector('small')?.textContent.trim() ?? null,
        beschrijving: el.querySelector('.intro')?.textContent.trim() ?? null,
        detailHref: link?.getAttribute('href') ?? null,
        genres,
      };
    });
  });

  const parseDate = createDateParser(new Date());
  const buildId = createIdBuilder();
  const opgehaaldOp = new Date().toISOString();
  const shows = [];

  for (const item of rawItems) {
    if (!item.titel || !item.dagTekst) continue;
    const datum = parseDate(item.dagTekst);
    if (!datum) {
      log(`kon datum niet parsen: "${item.dagTekst}" (${item.titel}) — overgeslagen.`);
      continue;
    }
    const detailUrl = item.detailHref ? new URL(item.detailHref, theater.baseUrl).toString() : theater.agendaUrl;

    shows.push({
      id: buildId(theater.id, item.titel, datum, null),
      titel: item.titel,
      theaterId: theater.id,
      theaterNaam: theater.naam,
      stad: theater.stad,
      podiumpas: theater.podiumpas,
      datum,
      tijd: null,
      genre: normalizeGenreFromList(item.genres),
      genreRuw: item.genres.join(', ') || null,
      beschikbaarheid: 'onbekend',
      beschrijving: item.beschrijving,
      reserverenUrl: detailUrl,
      bron: theater.agendaUrl,
      opgehaaldOp,
    });
  }

  return shows;
}
