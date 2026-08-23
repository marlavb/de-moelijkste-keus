import { createIdBuilder } from '../lib/normalize.js';

const AGENDA_PATH = '/programma/agenda';

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

// "MA 29 JUN '26 11:00" -> { datum, tijd } — afgekorte Nederlandse
// maandnaam MET expliciet (2-cijferig) jaartal, dus geen van de bestaande
// gedeelde parsers in normalize.js past hier direct op.
function parseDateTime(raw) {
  const match = raw?.match(/(\d{1,2})\s+([a-zA-Z]+)\s+'(\d{2})\s+(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const [, day, monthAbbr, yy, hour, minute] = match;
  const month = MONTHS_ABBR[monthAbbr.toLowerCase()];
  if (!month) return null;
  const year = 2000 + parseInt(yy, 10);
  return { datum: `${year}-${pad2(month)}-${pad2(day)}`, tijd: `${pad2(hour)}:${minute}` };
}

/**
 * Haalt de volledige agenda van Podium Mozaïek op.
 *
 * Structuur (geïnspecteerd op
 * https://www.podiummozaiek.nl/programma/agenda, aug 2026):
 * - robots.txt staat alles toe, geen crawl-delay.
 * - Next.js-app, volledig client-side gerenderd — de kale HTML bevat geen
 *   programma-inhoud, dus Playwright met networkidle is hier geen
 *   optimalisatie maar een vereiste.
 * - Geen bruikbare CSS-classes op de kaarten zelf (alles inline gestyled),
 *   dus lezen we per kaart de kinderen van <a href="/programma/details/...">
 *   op vaste positie uit (titel/artiest bovenin, zaal+datum onderin).
 * - Onderaan de pagina staat een "gerelateerd"-sectie die een deel van
 *   dezelfde voorstellingen nogmaals toont, maar dan met een kortere
 *   kaartstructuur zonder datum — die duplicaten (zelfde href, mislukte
 *   datum-extractie) slaan we over vóórdat we op href dedupen.
 * - Datum staat als platte tekst "MA 29 JUN '26 11:00" (afgekorte
 *   maandnaam + 2-cijferig jaartal), geen machine-leesbaar datetime-attr.
 * - Geen genre-tag en geen beschikbaarheids-/ticketstatussignaal op de
 *   agendapagina — genre blijft null, beschikbaarheid blijft "onbekend"
 *   (geen van beide is op te halen zonder een extra request per
 *   voorstelling, en dat vermijden we bewust).
 */
export async function scrapeMozaiek({ page, theater, robots, waitForTurn, log }) {
  if (!robots.isAllowed(AGENDA_PATH)) {
    log(`robots.txt verbiedt ${AGENDA_PATH} op ${theater.baseUrl} — sla over.`);
    return [];
  }

  await waitForTurn();
  await page.goto(theater.agendaUrl, { waitUntil: 'networkidle', timeout: 30000 });

  const rawItems = await page.evaluate(() => {
    const links = Array.from(document.querySelectorAll('a[href*="/programma/details/"]'));
    const seen = new Set();
    const items = [];
    for (const a of links) {
      const href = a.getAttribute('href');
      if (!href || seen.has(href)) continue;

      const cardDiv = a.children[0];
      const content = cardDiv?.children[1];
      const infoBlock = content?.children[0];
      const bottomRow = content?.children[1];
      const titel = infoBlock?.children[0]?.textContent.trim() ?? null;
      const artiest = infoBlock?.children[1]?.textContent.trim() ?? null;
      const datumTekst = bottomRow?.children[1]?.textContent.trim() ?? null;
      if (!titel || !datumTekst) continue;

      seen.add(href);
      items.push({ href, titel, artiest, datumTekst });
    }
    return items;
  });

  log(`${rawItems.length} unieke voorstellingen gevonden op de agendapagina`);

  const buildId = createIdBuilder();
  const opgehaaldOp = new Date().toISOString();
  const shows = [];

  for (const item of rawItems) {
    const parsed = parseDateTime(item.datumTekst);
    if (!parsed) {
      log(`kon datum niet parsen: "${item.datumTekst}" (${item.titel}) — overgeslagen.`);
      continue;
    }
    const detailUrl = new URL(item.href, theater.baseUrl).toString();

    shows.push({
      id: buildId(theater.id, item.titel, parsed.datum, parsed.tijd),
      titel: item.titel,
      theaterId: theater.id,
      theaterNaam: theater.naam,
      stad: theater.stad,
      podiumpas: theater.podiumpas,
      datum: parsed.datum,
      tijd: parsed.tijd,
      genre: null,
      genreRuw: null,
      beschikbaarheid: 'onbekend',
      beschrijving: item.artiest,
      reserverenUrl: detailUrl,
      bron: theater.agendaUrl,
      opgehaaldOp,
    });
  }

  return shows;
}
