import { createIdBuilder } from '../lib/normalize.js';
import { normalizeGenre } from '../lib/genre.js';

const AGENDA_PATH = '/programma/';

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

const DUTCH_MONTHS_FULL = {
  januari: 1,
  februari: 2,
  maart: 3,
  april: 4,
  mei: 5,
  juni: 6,
  juli: 7,
  augustus: 8,
  september: 9,
  oktober: 10,
  november: 11,
  december: 12,
};

function pad2(n) {
  return String(n).padStart(2, '0');
}

// Bijna alle producties tonen hun speeldata als losse blokjes (één per
// datum, "za 05 sep" + los tijd-element) — createRowDateParser() hieronder
// verwerkt die met dezelfde jaar-rollover-aanpak als de gedeelde
// createDutchAbbrevDayParser(), maar dan startend vanaf "vandaag" PER
// PRODUCTIE in plaats van doorlopend over de hele pagina (zelfde reden als
// bij Scala: producties staan niet per se chronologisch t.o.v. elkaar).
function createRowDateParser(referenceDate) {
  let year = referenceDate.getFullYear();
  let lastMonth = referenceDate.getMonth() + 1;
  return function parseRow(dagTekst) {
    const match = dagTekst.toLowerCase().match(/(\d{1,2})\s+([a-zé]+)/);
    if (!match) return null;
    const day = parseInt(match[1], 10);
    const month = MONTHS_ABBR[match[2]];
    if (!month) return null;
    if (month < lastMonth) year += 1;
    lastMonth = month;
    return `${year}-${pad2(month)}-${pad2(day)}`;
  };
}

// Eén type kaart (in de praktijk: het jaarlijkse RIGHTABOUTNOW-festival)
// toont in plaats van losse datumblokjes één samengevoegde, kommagescheiden
// lijst zonder tijden, bv. "3, 4, 5 en 6 december 2026" — zelfde soort
// compacte notatie als Scala, maar dan met volledige maandnamen + een
// expliciet jaartal aan het eind (dus geen jaar-rollover nodig zoals bij
// Scala, het jaartal staat er gewoon bij).
function parseCompactDateList(raw) {
  const normalized = raw.replace(/\s+en\s+/gi, ', ');
  const tokens = normalized
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);

  let knownMonth = null;
  let knownYear = null;
  const dates = [];
  for (let i = tokens.length - 1; i >= 0; i--) {
    const match = tokens[i].match(/^(\d{1,2})(?:\s+([a-zé]+))?(?:\s+(\d{4}))?$/i);
    if (!match) continue;
    const day = parseInt(match[1], 10);
    const monthName = match[2]?.toLowerCase();
    const yearStr = match[3];
    if (monthName && DUTCH_MONTHS_FULL[monthName]) knownMonth = DUTCH_MONTHS_FULL[monthName];
    if (yearStr) knownYear = parseInt(yearStr, 10);
    if (knownMonth && knownYear) dates.unshift(`${knownYear}-${pad2(knownMonth)}-${pad2(day)}`);
  }
  return dates;
}

/**
 * Haalt de volledige agenda van CC Amstel op.
 *
 * Structuur (geïnspecteerd op https://ccamstel.nl/programma/, aug 2026):
 * - Geen robots.txt (404) — geen crawl-delay, standaard-minimum vertraging.
 * - Server-rendered, alle producties (31) op één pagina, geen paginering.
 * - Per productie (.item): titel + genre (.content .subtitle, één vaste
 *   waarde, geen taglijst) in het linkerblok, boekingslink + speeldata +
 *   beschrijving (.footer p) in het rechterblok.
 * - .dates-block bevat kapotte HTML: een <ul> met daarin direct een
 *   tekstnode ("za 05 sep") gevolgd door een <span> met de tijd, zonder
 *   omliggende <li> — de bron-HTML heeft een <li>-sluittag zonder opening,
 *   die browsers stilzwijgend negeren. querySelector('span') + het eerste
 *   childNode van de <ul> pakken dus rechtstreeks tijd resp. datumtekst.
 * - Eén productie per pagina kan ook een heel ANDER dates-block-formaat
 *   hebben: één <div class="col-12"> met een samengevoegde datumlijst
 *   zonder tijden (zie parseCompactDateList) — vooralsnog alleen gezien
 *   bij het jaarlijkse RIGHTABOUTNOW-festival.
 * - Boekingslink (.title-holder a.btn) wijst altijd naar dezelfde url als
 *   de detailpagina (geen apart ticketsysteem) — reserverenUrl is dus
 *   altijd de detailpagina, en er is geen boekingsstatussignaal op deze
 *   pagina, dus beschikbaarheid blijft "onbekend".
 * - Meerdere speeldata per productie -> één rij per datum, zelfde aanpak
 *   als Scala.
 */
export async function scrapeCcAmstel({ page, theater, robots, waitForTurn, log }) {
  if (!robots.isAllowed(AGENDA_PATH)) {
    log(`robots.txt verbiedt ${AGENDA_PATH} op ${theater.baseUrl} — sla over.`);
    return [];
  }

  await waitForTurn();
  await page.goto(theater.agendaUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

  const rawItems = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('.item')).map((el) => {
      const titel = el.querySelector('h2.title')?.textContent.trim() ?? null;
      const genreRuw = el.querySelector('.content .subtitle')?.textContent.trim() ?? null;
      const detailHref = el.querySelector('a.image-block')?.getAttribute('href') ?? null;
      const beschrijving = el.querySelector('.footer p')?.textContent.trim() ?? null;

      const perDateBlocks = Array.from(el.querySelectorAll('.dates-block .col-md-4 ul')).map((ul) => ({
        dagTekst: ul.childNodes[0]?.textContent.trim() ?? null,
        tijdTekst: ul.querySelector('span')?.textContent.trim() ?? null,
      }));
      const compactDateText = el.querySelector('.dates-block .col-12')?.textContent.trim() ?? null;

      return { titel, genreRuw, detailHref, beschrijving, perDateBlocks, compactDateText };
    });
  });

  const buildId = createIdBuilder();
  const opgehaaldOp = new Date().toISOString();
  const referenceDate = new Date();
  const shows = [];

  for (const item of rawItems) {
    if (!item.titel || !item.detailHref) continue;
    const detailUrl = new URL(item.detailHref, theater.baseUrl).toString();
    const genre = normalizeGenre(item.genreRuw);

    const rows = [];
    if (item.perDateBlocks.length > 0) {
      const parseRow = createRowDateParser(referenceDate);
      for (const block of item.perDateBlocks) {
        if (!block.dagTekst) continue;
        const datum = parseRow(block.dagTekst);
        if (!datum) {
          log(`kon datum niet parsen: "${block.dagTekst}" (${item.titel}) — overgeslagen.`);
          continue;
        }
        const tijdMatch = block.tijdTekst?.match(/(\d{1,2})[:.](\d{2})/);
        const tijd = tijdMatch ? `${pad2(parseInt(tijdMatch[1], 10))}:${tijdMatch[2]}` : null;
        rows.push({ datum, tijd });
      }
    } else if (item.compactDateText) {
      for (const datum of parseCompactDateList(item.compactDateText)) {
        rows.push({ datum, tijd: null });
      }
    }

    if (rows.length === 0) {
      log(`geen speeldata gevonden voor "${item.titel}" — overgeslagen.`);
      continue;
    }

    for (const row of rows) {
      shows.push({
        id: buildId(theater.id, item.titel, row.datum, row.tijd),
        titel: item.titel,
        theaterId: theater.id,
        theaterNaam: theater.naam,
        stad: theater.stad,
        podiumpas: theater.podiumpas,
        datum: row.datum,
        tijd: row.tijd,
        genre,
        genreRuw: item.genreRuw,
        beschikbaarheid: 'onbekend',
        beschrijving: item.beschrijving,
        reserverenUrl: detailUrl,
        bron: theater.agendaUrl,
        opgehaaldOp,
      });
    }
  }

  return shows;
}
