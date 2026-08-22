import { createDutchDayParser, extractTime, createIdBuilder } from '../lib/normalize.js';
import { normalizeGenreFromList } from '../lib/genre.js';

const AGENDA_PATH = '/agenda';

function classifyBeschikbaarheid(ticketText) {
  const tekst = (ticketText ?? '').trim().toLowerCase();
  if (tekst.includes('wachtlijst')) return 'wachtlijst';
  if (tekst.includes('uitverkocht')) return 'uitverkocht';
  if (tekst.includes('tickets') || tekst.includes('gratis')) return 'beschikbaar';
  return 'onbekend';
}

/**
 * Haalt de volledige agenda van Theater Kikker op.
 *
 * Structuur (geïnspecteerd op https://www.theaterkikker.nl/agenda, aug
 * 2026) — zelfde robots.txt-sjabloon als Stadsschouwburg Utrecht, maar
 * een compleet andere pagina-template (geen paginering: alle ~220
 * voorstellingen staan in één keer op de pagina, dubbel gerenderd als
 * ".event.desktop" én ".event.mobile" voor de responsive layout — we
 * gebruiken alleen .desktop om dubbeltellingen te voorkomen).
 * - Datum staat als platte Nederlandse tekst zonder jaartal ("vr 25
 *   september") — zelfde formaat als DeLaMar, dus createDutchDayParser()
 *   werkt hier ook, chronologisch over de hele (al gesorteerde) lijst.
 * - .genre is een kommagescheiden lijst die vaak niet-genre-tags als
 *   "Language no problem" en "Verhuur" bevat, soms zelfs vóór het echte
 *   genre — normalizeGenreFromList() zoekt de eerste tag die wél een
 *   bekend genre is.
 * - Ticketknop linkt altijd naar de eigen infopagina (geen directe
 *   Ticketmatic-link zoals bij de andere Utrechtse site), maar de
 *   knoptekst zelf verraadt wel de status ("Tickets", "Gratis
 *   toegankelijk", "Uitverkocht", "Tickets via Gaudeamus").
 */
export async function scrapeTheaterKikker({ page, theater, robots, waitForTurn, log }) {
  if (!robots.isAllowed(AGENDA_PATH)) {
    log(`robots.txt verbiedt ${AGENDA_PATH} op ${theater.baseUrl} — sla over.`);
    return [];
  }

  await waitForTurn();
  await page.goto(theater.agendaUrl, { waitUntil: 'networkidle', timeout: 30000 });

  const rawItems = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('.event.desktop')).map((el) => {
      const titel = el.querySelector('.titel')?.textContent.trim() ?? null;
      const beschrijving = el.querySelector('.oneliner')?.textContent.trim() ?? null;
      const genreTekst = el.querySelector('.genre')?.textContent.trim() ?? '';
      const genres = genreTekst
        .split(',')
        .map((g) => g.trim())
        .filter(Boolean);
      const detailHref = el.querySelector('.info-wrapper a, .image-wrapper a')?.getAttribute('href') ?? null;
      const dagTekst = el.querySelector('.data-wrapper .date')?.textContent.trim() ?? null;
      const tijdTekst = el.querySelector('.data-wrapper .time')?.textContent.trim() ?? null;
      const ticketEl = el.querySelector('.ticket-wrapper a.btn');
      const ticketHref = ticketEl?.getAttribute('href') ?? null;
      const ticketText = ticketEl?.textContent.trim() ?? null;
      return { titel, beschrijving, genres, detailHref, dagTekst, tijdTekst, ticketHref, ticketText };
    });
  });

  log(`${rawItems.length} voorstellingen gevonden op de agendapagina`);

  const parseDay = createDutchDayParser();
  const buildId = createIdBuilder();
  const opgehaaldOp = new Date().toISOString();
  const shows = [];

  for (const item of rawItems) {
    if (!item.titel || !item.dagTekst) continue;
    const datum = parseDay(item.dagTekst);
    if (!datum) {
      log(`kon datum-label niet parsen: "${item.dagTekst}" (${item.titel}) — overgeslagen.`);
      continue;
    }
    const tijd = extractTime(item.tijdTekst);
    const detailUrl = item.detailHref ? new URL(item.detailHref, theater.baseUrl).toString() : theater.agendaUrl;

    shows.push({
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
      beschikbaarheid: classifyBeschikbaarheid(item.ticketText),
      beschrijving: item.beschrijving,
      reserverenUrl: item.ticketHref ? new URL(item.ticketHref, theater.baseUrl).toString() : detailUrl,
      bron: theater.agendaUrl,
      opgehaaldOp,
    });
  }

  return shows;
}
