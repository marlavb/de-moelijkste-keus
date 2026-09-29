import { pagineerListing } from '../lib/peppered.js';
import { createDutchAbbrevDayParser, extractTime, createIdBuilder } from '../lib/normalize.js';
import { normalizeGenreFromList } from '../lib/genre.js';

const AGENDA_PATH = '/nl/agenda';
const MAX_LISTING_PAGES = 60;

function classifyBeschikbaarheid(ctrlText) {
  const tekst = (ctrlText ?? '').trim().toLowerCase();
  if (tekst.includes('wachtlijst')) return 'wachtlijst';
  if (tekst.includes('uitverkocht') || tekst.includes('volgeboekt')) return 'uitverkocht';
  if (
    tekst.includes('kaarten') ||
    tekst.includes('tickets') ||
    tekst.includes('verkoop elders') ||
    tekst.includes('aanmelden')
  )
    return 'beschikbaar';
  return 'onbekend';
}

/**
 * Haalt de volledige agenda van Frascati op.
 *
 * Structuur (geïnspecteerd op https://www.frascatitheater.nl/nl/agenda, aug
 * 2026) — hetzelfde platform als Theater Bellevue (zelfde robots.txt,
 * dezelfde CSS-classes, dezelfde ticketvendor tickets.tf.nl), maar met een
 * belangrijke ontdekking t.o.v. hoe we Bellevue hebben gebouwd: elke
 * kaart (<li data-entry-id="ID">) bevat, naast de zichtbare info, al een
 * volledig server-gerenderd (maar CSS-verborgen) paneel
 * <div id="show{ID}Dates"> met dezelfde <li class="subshow">-rijen die we
 * bij Bellevue via een apart detailpagina-bezoek ophaalden. Voor
 * shows-met-één-datum ontbreekt dat paneel; die tonen hun ene datum/tijd/
 * ticketlink direct op de kaart (.dateTimeContainer). Dat betekent dat we
 * voor Frascati géén detailpagina's hoeven te bezoeken — alles staat al op
 * de agendapagina('s) zelf, dus alleen de paginering (?page=N) kost
 * requests.
 * - Genre-tags zijn een ongeordende mix van echte genres ("theater", "dans",
 *   "mime", "performance", "muziektheater", "multidisciplinair") en
 *   niet-genre-tags (taal: "Nederlands/Engels gesproken", producenten:
 *   "Frascati Producties") — normalizeGenreFromList() pakt de eerste tag
 *   die wél een bekend genre is en negeert de rest.
 * - Wél een "uitverkocht"-status gevonden op dit platform (niet bij
 *   Bellevue aangetroffen, maar dezelfde CSS-class bestaat duidelijk site-
 *   breed) — zie classifyBeschikbaarheid hierboven.
 */
export async function scrapeFrascati({ page, theater, robots, waitForTurn, log, warn }) {
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
        const genres = Array.from(card.querySelectorAll('.genres__link')).map((a) => a.textContent.trim());

        const rows = [];
        const panel = document.getElementById(`show${entryId}Dates`);
        if (panel) {
          for (const li of panel.querySelectorAll('li.subshow')) {
            const dagTekst = li.querySelector('.date .start')?.textContent.trim() ?? null;
            if (!dagTekst) continue;
            const tijdTekst = li.querySelector('.time .start')?.textContent.trim() ?? null;
            const ctrl = li.querySelector('.buttonBox a, .buttonBox button, .buttonBox span');
            rows.push({
              dagTekst,
              tijdTekst,
              ctrlText: ctrl?.textContent.trim().replace(/\s+/g, ' ') ?? null,
              href: ctrl?.getAttribute('href') ?? null,
              // Tournee/andere zaal ("Verkoop elders", "Kaarten via"): het
              // platform markeert die rij zelf met in-other-location.
              andereLocatie: li.classList.contains('in-other-location'),
            });
          }
        } else {
          const dtInner = card.querySelector('.dateTimeContainer .dateTimeInner');
          const dagTekst = dtInner?.querySelector('.datetime .date .start')?.textContent.trim() ?? null;
          if (dagTekst) {
            const tijdTekst = dtInner?.querySelector('.datetime .time .start')?.textContent.trim() ?? null;
            const ctrl = dtInner?.querySelector('a.btn, button.btn, span.btn');
            rows.push({
              dagTekst,
              tijdTekst,
              ctrlText: ctrl?.textContent.trim().replace(/\s+/g, ' ') ?? null,
              href: ctrl?.getAttribute('href') ?? null,
            });
          }
        }

        return { entryId, titel, beschrijving, detailHref, genres, rows };
      });
    },
  });

  const buildId = createIdBuilder();
  const opgehaaldOp = new Date().toISOString();
  const shows = [];
  let andereLocatie = 0;

  for (const card of cards) {
    if (!card.titel || card.rows.length === 0) continue;
    const parseDay = createDutchAbbrevDayParser();
    const detailUrl = card.detailHref ? new URL(card.detailHref, theater.baseUrl).toString() : theater.agendaUrl;

    for (const row of card.rows) {
      // Langlopende producties tonen soms ook al voorbije uitvoeringen
      // ("Geweest") in hetzelfde paneel — die horen niet in een
      // toekomstgerichte agenda.
      if (row.ctrlText?.trim().toLowerCase() === 'geweest') continue;
      const datum = parseDay(row.dagTekst);
      if (!datum) {
        log(`kon datum-label niet parsen: "${row.dagTekst}" (${card.titel}) — overgeslagen.`);
        continue;
      }
      // Pas ná parseDay overslaan, zodat de jaar-rollover dezelfde volgorde
      // van datums blijft zien.
      if (row.andereLocatie) {
        andereLocatie++;
        continue;
      }
      const tijd = extractTime(row.tijdTekst);
      const ticketUrl =
        row.href && !row.href.startsWith('javascript:') ? new URL(row.href, theater.baseUrl).toString() : null;

      shows.push({
        id: buildId(theater.id, card.titel, datum, tijd),
        titel: card.titel,
        theaterId: theater.id,
        theaterNaam: theater.naam,
        stad: theater.stad,
        podiumpas: theater.podiumpas,
        datum,
        tijd,
        genre: normalizeGenreFromList(card.genres),
        genreRuw: card.genres.join(', ') || null,
        beschikbaarheid: classifyBeschikbaarheid(row.ctrlText),
        beschrijving: card.beschrijving,
        reserverenUrl: ticketUrl ?? detailUrl,
        bron: theater.agendaUrl,
        opgehaaldOp,
      });
    }
  }

  if (andereLocatie > 0) log(`${andereLocatie} speeldatum(s) op een andere locatie (tournee) overgeslagen.`);
  return shows;
}
