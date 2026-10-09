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

/** "15-10-2026" → "2026-10-15", anders null. */
export function karavaanDatum(dataDate) {
  const m = String(dataDate ?? '').trim().match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  return m ? `${m[3]}-${pad2(m[2])}-${pad2(m[1])}` : null;
}

/** "20:00 uur" → "20:00", anders null. */
export function karavaanTijd(tekst) {
  const m = String(tekst ?? '').match(/\b(\d{1,2})[:.](\d{2})\b/);
  return m ? `${pad2(m[1])}:${m[2]}` : null;
}

/**
 * Status uit het vak rechts naast een speeldatum. Leeg (zoals bij "De lente
 * vatte vlam", 9 okt 2026) of onbekend: "onbekend".
 */
export function karavaanStatus(tekst) {
  const t = String(tekst ?? '').toLowerCase();
  if (/uitverkocht|sold ?out/.test(t)) return 'uitverkocht';
  if (/wachtlijst/.test(t)) return 'wachtlijst';
  if (/geannuleerd|afgelast|gaat niet door/.test(t)) return 'afgelast';
  if (/verplaatst/.test(t)) return 'verplaatst';
  if (/bestel|tickets?|kaarten|koop/.test(t)) return 'beschikbaar';
  return 'onbekend';
}

/**
 * Haalt de agenda van Karavaan - Theater de Drukkerij op.
 *
 * Structuur (geïnspecteerd op
 * https://www.karavaan.nl/location/de-drukkerij/, aug 2026; detailpagina's
 * 9 okt 2026):
 * - robots.txt: alleen /wp-admin/ verboden (admin-ajax.php wel toegestaan),
 *   geen crawl-delay (9 okt 2026).
 * - Server-rendered. Elke productiekaart is een <div data-genres='[...]'>
 *   met een schone, JSON-achtige genre-lijst die al dicht bij ons eigen
 *   schema zit (Theater/Dans/Muziektheater) — normalizeGenreFromList()
 *   voor het geval er ooit meer dan één waarde in staat.
 * - .tag-list bevat geen genre maar een "motief"-label (Inspirerend, Samen
 *   uit, ...) — niet bruikbaar als genre, dus genegeerd.
 * - Geen paginering nodig: alle producties (~10) staan op deze ene
 *   locatiepagina, met alleen een datumlabel (<small>), zonder tijd.
 * - De tijden staan op de detailpagina (/voorstellingen/<slug>/, sinds 9 okt
 *   2026): "Dagen & tijden", ul#dates-list met per speeldatum een
 *   li.event[data-date="15-10-2026"], de aanvangstijd ("20:00 uur") en rechts
 *   een vak voor de status (bij de eerste controle leeg). Bij ~10 producties
 *   halen we elke nacht alle detailpagina's (geen detailcache): tijden en
 *   status zijn dan altijd actueel. Mislukt een detailpagina of staat er
 *   geen datumlijst, dan de kaart van de locatiepagina zonder tijd (en een
 *   waarschuwing).
 * - Boeken: "kaarten & info" op de kaart is de detailpagina; reserverenUrl
 *   blijft die pagina.
 */
export async function scrapeKaravaan({ page, theater, robots, waitForTurn, log, warn = log }) {
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

  // Sanity check: de locatiepagina toont altijd producties.
  if (rawItems.length === 0) throw new Error('geen productiekaarten ([data-genres]) op de locatiepagina — site veranderd of geblokkeerd?');

  const basis = (item, datum, tijd, beschikbaarheid, detailUrl) => ({
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
    beschikbaarheid,
    beschrijving: item.beschrijving,
    reserverenUrl: detailUrl,
    bron: theater.agendaUrl,
    opgehaaldOp,
  });

  let detailOk = 0;
  for (const item of rawItems) {
    if (!item.titel || !item.dagTekst) continue;
    const datum = parseDate(item.dagTekst);
    if (!datum) {
      log(`kon datum niet parsen: "${item.dagTekst}" (${item.titel}) — overgeslagen.`);
      continue;
    }
    const detailUrl = item.detailHref ? new URL(item.detailHref, theater.baseUrl).toString() : theater.agendaUrl;

    // Speeldata met tijd en status van de detailpagina.
    let speeldata = null;
    if (item.detailHref && robots.isAllowed(new URL(detailUrl).pathname)) {
      try {
        await waitForTurn();
        await page.goto(detailUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        speeldata = await page.evaluate(() => {
          const lijst = document.querySelector('#dates-list');
          if (!lijst) return null;
          return Array.from(lijst.querySelectorAll('li.event')).map((li) => {
            const tekst = Array.from(li.querySelectorAll('.font-inter')).map((d) => d.textContent.trim()).join(' ');
            const status = li.querySelector('span.text-right')?.textContent.trim() ?? '';
            return { dataDate: li.getAttribute('data-date'), tijdTekst: tekst, status };
          });
        });
      } catch (err) {
        warn(`detailpagina mislukt (${detailUrl}): ${err.message.split('\n')[0]} — kaart zonder tijd.`);
      }
    }
    const geldig = (speeldata ?? []).map((d) => ({ ...d, datum: karavaanDatum(d.dataDate) })).filter((d) => d.datum);
    if (speeldata && geldig.length === 0) warn(`geen speeldata in #dates-list op ${detailUrl} — kaart zonder tijd.`);
    if (!speeldata && item.detailHref) warn(`geen #dates-list op ${detailUrl} — kaart zonder tijd.`);
    if (geldig.length === 0) {
      shows.push(basis(item, datum, null, 'onbekend', detailUrl));
      continue;
    }
    detailOk++;
    for (const d of geldig) shows.push(basis(item, d.datum, karavaanTijd(d.tijdTekst), karavaanStatus(d.status), detailUrl));
  }
  log(`${detailOk} detailpagina('s) met speeldata en tijden gelezen.`);

  return shows;
}
