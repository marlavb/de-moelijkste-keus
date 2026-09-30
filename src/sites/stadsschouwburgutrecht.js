import { pagineerListing } from '../lib/peppered.js';
import { createIdBuilder } from '../lib/normalize.js';
import { normalizeGenre } from '../lib/genre.js';
import { pasTitelConventieToe } from '../lib/titels.js';
import { vervallenStatus } from '../lib/beschikbaarheid.js';

const AGENDA_PATH = '/agenda';
const MAX_LISTING_PAGES = 60;

function pad2(n) {
  return String(n).padStart(2, '0');
}

// Datum staat als "22-8-2026 19:00:00" (dag-maand-jaar, niet met voorloop-
// nullen) in het datetime-attribuut — geen ISO-formaat, dus eigen parser.
function parseDateTime(raw) {
  const match = raw?.match(/(\d{1,2})-(\d{1,2})-(\d{4})\s+(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const [, day, month, year, hour, minute] = match;
  return { datum: `${year}-${pad2(month)}-${pad2(day)}`, tijd: `${pad2(hour)}:${minute}` };
}

// Een afgelaste voorstelling heeft knoptekst "geannuleerd" en het label
// (.tag) "geannuleerd" op de plek van het genre.
function classifyBeschikbaarheid(ticketText, tag) {
  const vervallen = vervallenStatus(ticketText) ?? vervallenStatus(tag);
  if (vervallen) return vervallen;
  const tekst = (ticketText ?? '').trim().toLowerCase();
  if (tekst.includes('wachtlijst')) return 'wachtlijst';
  if (tekst.includes('uitverkocht')) return 'uitverkocht';
  if (tekst.includes('bestel') || tekst.includes('koop') || tekst.includes('kaarten') || tekst.includes('inloop'))
    return 'beschikbaar';
  return 'onbekend';
}

/**
 * Haalt de volledige agenda van Stadsschouwburg Utrecht op.
 *
 * Structuur (geïnspecteerd op https://stadsschouwburg-utrecht.nl/agenda,
 * aug 2026):
 * - Server-rendered, gepagineerd via ?page=N (20 pagina's, 30 items per
 *   pagina; eigen platform, geen page-selection). Via pagineerListing
 *   (lib/peppered.js): stoppen zodra een pagina niets nieuws oplevert.
 *   robots.txt geeft geen crawl-delay op.
 * - Elk item (.event) heeft titel+link (.title a), beschrijving
 *   (.subtitle.oneliner), genre (.tag-wrapper .tag) en een verborgen
 *   <time datetime="D-M-JJJJ UU:MM:SS"> met de exacte datum/tijd.
 * - Ticketstatus staat in de EERSTE .btn-ticket-knop binnen .btn-wrapper
 *   (bv. "koop kaarten", "bestel gratis kaarten", "vrije inloop",
 *   "uitverkocht"). Bij uitverkocht toont de site een TWEEDE,
 *   irrelevante "meer van dit genre"-link — die negeren we door alleen
 *   de eerste .btn-ticket te gebruiken. Dezelfde Ticketmatic-vendor als
 *   Amstelveen/Frascati/Bellevue.
 */
export async function scrapeStadsschouwburgUtrecht({ page, theater, robots, waitForTurn, log, warn }) {
  if (!robots.isAllowed(AGENDA_PATH)) {
    log(`robots.txt verbiedt ${AGENDA_PATH} op ${theater.baseUrl} — sla over.`);
    return [];
  }

  const rawItems = await pagineerListing({
    page,
    theater,
    robots,
    waitForTurn,
    log,
    warn,
    agendaPath: AGENDA_PATH,
    maxPages: MAX_LISTING_PAGES,
    leesParameter: false,
    label: 'items',
    sleutelVan: (item) => `${item.detailHref}|${item.iso}`,
    extract: () => {
      return Array.from(document.querySelectorAll('.event')).map((el) => {
        const titel = el.querySelector('.title a')?.textContent.trim() ?? null;
        // Hier is de titel de voorstelling; de artiest staat in de eerste
        // ondertitel (p.subtitle.notranslate, niet de .oneliner).
        const artiest = el.querySelector('p.subtitle.notranslate:not(.oneliner)')?.textContent.trim() || null;
        const detailHref = el.querySelector('.title a')?.getAttribute('href') ?? null;
        const beschrijving = el.querySelector('.subtitle.oneliner')?.textContent.trim() ?? null;
        const genre = el.querySelector('.tag-wrapper .tag')?.textContent.trim() ?? null;
        const iso = el.querySelector('time')?.getAttribute('datetime') ?? null;
        const ticketEl = el.querySelector('.btn-wrapper .btn-ticket');
        const ticketHref = ticketEl?.getAttribute('href') ?? null;
        const ticketText = ticketEl?.querySelector('span')?.textContent.trim() ?? ticketEl?.textContent.trim() ?? null;
        return { titel, artiest, detailHref, beschrijving, genre, iso, ticketHref, ticketText };
      });
    },
  });

  const buildId = createIdBuilder();
  const opgehaaldOp = new Date().toISOString();
  const shows = [];

  for (const item of rawItems) {
    if (!item.titel || !item.iso) continue;
    const parsed = parseDateTime(item.iso);
    if (!parsed) {
      log(`kon datum niet parsen: "${item.iso}" (${item.titel}) — overgeslagen.`);
      continue;
    }
    const detailUrl = item.detailHref ? new URL(item.detailHref, theater.baseUrl).toString() : theater.agendaUrl;
    const ticketUrl = item.ticketHref && item.ticketHref.trim() !== '' ? item.ticketHref : null;

    shows.push(pasTitelConventieToe({
      id: buildId(theater.id, item.titel, parsed.datum, parsed.tijd),
      titel: item.titel,
      theaterId: theater.id,
      theaterNaam: theater.naam,
      stad: theater.stad,
      podiumpas: theater.podiumpas,
      datum: parsed.datum,
      tijd: parsed.tijd,
      // Het label "geannuleerd" is een status, geen genre.
      genre: vervallenStatus(item.genre) ? null : normalizeGenre(item.genre),
      genreRuw: vervallenStatus(item.genre) ? null : item.genre,
      beschikbaarheid: classifyBeschikbaarheid(item.ticketText, item.genre),
      beschrijving: item.beschrijving,
      reserverenUrl: ticketUrl ?? detailUrl,
      bron: theater.agendaUrl,
      opgehaaldOp,
    }, { artiest: item.artiest, voorstelling: item.titel }));
  }

  return shows;
}
