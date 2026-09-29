import { pagineerListing } from '../lib/peppered.js';
import { createDutchAbbrevDayParser, extractTime, createIdBuilder } from '../lib/normalize.js';
import { normalizeGenreFromList } from '../lib/genre.js';

const AGENDA_PATH = '/agenda';
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
 * Haalt de volledige agenda van De Kleine Komedie op.
 *
 * Zelfde platform als Theater Bellevue en Frascati (identieke robots.txt,
 * CSS-classes en ticketvendor tickets.tf.nl) — zie frascati.js voor de
 * volledige toelichting op de structuur. Net als bij Frascati staat de
 * volledige datalijst (ook voor langlopende, meerdaagse producties) al in
 * een verborgen paneel op de agendapagina zelf, dus geen detailpagina-
 * bezoeken nodig.
 *
 * Genre-tags zijn hier een bonte verzameling thema-labels (PREMIÈRE,
 * ACTUEEL, MET GASTEN, ALLEEN IN DE KLEINE KOMEDIE, ...) naast de eigenlijke
 * genres (CABARET, TONEEL, KLEINKUNST, STAND-UP, ...) — normalizeGenreFromList()
 * pakt de eerste tag die wél een bekend genre is.
 */
export async function scrapeKleineKomedie({ page, theater, robots, waitForTurn, log, warn }) {
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
            // In het datumpaneel staat de tijd niet in .time .start maar in
            // <dl class="intermission"> ("Start 20.15 uur"); betrouwbaarder is
            // data-event-start ("2026-09-29 20:15:00", met jaartal) op de
            // wenslijstknop van de rij. Tot sep 2026 kwam hier geen tijd mee.
            const start = li.querySelector('[data-event-start]')?.getAttribute('data-event-start') ?? null;
            const startDt = [...li.querySelectorAll('dl.intermission dt')].find((dt) => /start/i.test(dt.textContent));
            const tijdTekst =
              li.querySelector('.time .start')?.textContent.trim() ?? startDt?.nextElementSibling?.textContent.trim() ?? null;
            const ctrl = li.querySelector('.buttonBox a, .buttonBox button, .buttonBox span');
            rows.push({
              start,
              dagTekst,
              tijdTekst,
              ctrlText: ctrl?.textContent.trim().replace(/\s+/g, ' ') ?? null,
              href: ctrl?.getAttribute('href') ?? null,
              // Tournee/andere zaal: De Kleine Komedie markeert élke rij met
              // in-other-location (ook eigen voorstellingen), dus die class
              // zegt hier niets. Speeldata elders herken je aan een
              // "Kaarten via"-knop naar een andere site (bv. KIEM in Klein
              // Bellevue → theaterbellevue.nl).
              andereLocatie: (() => {
                const href = ctrl?.getAttribute('href') ?? '';
                if (!/^https?:/.test(href)) return false;
                return !new URL(href).hostname.endsWith(location.hostname.replace(/^www\./, ''));
              })(),
            });
          }
        } else {
          const dtInner = card.querySelector('.dateTimeContainer .dateTimeInner');
          const dagTekst = dtInner?.querySelector('.datetime .date .start')?.textContent.trim() ?? null;
          if (dagTekst) {
            const tijdTekst = dtInner?.querySelector('.datetime .time .start')?.textContent.trim() ?? null;
            const ctrl = dtInner?.querySelector('a.btn, button.btn, span.btn');
            rows.push({
              start: card.querySelector('[data-event-start]')?.getAttribute('data-event-start') ?? null,
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
      // data-event-start heeft voorrang (met jaartal); parseDay blijft lopen
      // zodat de jaar-rollover dezelfde volgorde van datums blijft zien.
      const uitTekst = parseDay(row.dagTekst);
      const vanStart = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(row.start ?? '') ? row.start : null;
      const datum = vanStart ? vanStart.slice(0, 10) : uitTekst;
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
      const startTijd = vanStart?.slice(11, 16);
      const tijd = startTijd && startTijd !== '00:00' ? startTijd : extractTime(row.tijdTekst);
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
