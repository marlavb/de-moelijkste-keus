// Gedeelde stukken voor theatersites van X-com met kaartverkoop via Itix
// (Rabo Theater De Meenthe, De Reggehof; okt 2026). De agenda komt van het
// eigen endpoint /shows.php?page=N&…, dat JSON teruggeeft met `pages` en
// `currentPage`, en per site óf de ruwe gegevens (`raw`, De Meenthe) óf
// kant-en-klare HTML-blokken (`html`, De Reggehof). Inventarisatie:
// debug/overijssel-groningen-inventarisatie.md (8 okt 2026).

import { gaNaar } from './diagnose.js';

const SHOWS_PATH = '/shows.php';
export const MAX_PAGINAS = 30;

/**
 * Alle pagina's van /shows.php met `query` (URLSearchParams-achtig object).
 * Geeft de JSON-antwoorden terug, in volgorde. Gooit als het endpoint niet
 * mag (robots.txt), geen 200 geeft of geen `pages` heeft (sanity check).
 */
export async function haalXcomPaginas({ page, theater, robots, waitForTurn, log, warn, query }) {
  if (!robots.isAllowed(SHOWS_PATH)) throw new Error(`robots.txt verbiedt ${SHOWS_PATH} — niet scrapen`);
  const antwoorden = [];
  let totaal = 1;
  for (let p = 1; p <= Math.min(totaal, MAX_PAGINAS); p++) {
    const params = new URLSearchParams({ ...query, page: String(p) });
    const url = `${theater.baseUrl}${SHOWS_PATH}?${params}`;
    await waitForTurn();
    const res = await gaNaar(page, url, { timeout: 45000 });
    if (!res || res.status() !== 200) throw new Error(`${SHOWS_PATH} gaf HTTP ${res?.status() ?? '?'} op ${url}`);
    let data;
    try {
      data = await res.json();
    } catch {
      throw new Error(`${SHOWS_PATH} gaf geen JSON op ${url} — veranderd of geblokkeerd?`);
    }
    if (typeof data?.pages !== 'number') throw new Error(`${SHOWS_PATH} zonder "pages" op ${url} — veranderd?`);
    antwoorden.push(data);
    if (p === 1) {
      totaal = data.pages;
      log(`${SHOWS_PATH}: ${data.pages} pagina's${data.countItemsTotal != null ? `, ${data.countItemsTotal} speeldata` : ''}`);
      if (data.pages > MAX_PAGINAS) warn(`${SHOWS_PATH}: ${data.pages} pagina's, meer dan ${MAX_PAGINAS} — alleen de eerste ${MAX_PAGINAS} gelezen.`);
    }
  }
  return antwoorden;
}

const AMSTERDAM = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Amsterdam',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** Unix-tijd (seconden, UTC) → { datum: 'YYYY-MM-DD', tijd: 'HH:MM' } in Amsterdam. */
export function amsterdamUitUnix(seconden) {
  if (!Number.isFinite(seconden)) return null;
  const d = Object.fromEntries(AMSTERDAM.formatToParts(new Date(seconden * 1000)).map((p) => [p.type, p.value]));
  return { datum: `${d.year}-${d.month}-${d.day}`, tijd: `${d.hour}:${d.minute}` };
}

/**
 * Itix-status → beschikbaarheid. Waarden gezien in de data of in het
 * site-script (okt 2026): reserveren, uitverkocht, wachtlijst, geannuleerd,
 * geen_webverkoop. Iets anders → null (de scraper telt en logt die).
 */
export function xcomBeschikbaarheid(status) {
  const s = String(status ?? '').trim().toLowerCase();
  if (s === 'reserveren') return 'beschikbaar';
  if (s === 'uitverkocht') return 'uitverkocht';
  if (s === 'wachtlijst') return 'wachtlijst';
  if (s === 'geannuleerd') return 'afgelast';
  if (s === 'geen_webverkoop' || s === '') return 'onbekend';
  return null;
}

/**
 * De status zoals de site hem toont (calculateStatus in het site-script van
 * X-com, okt 2026): status uit de lijst (`status`), webstatus uit het CMS
 * (`web`) en de actuele Itix-status (`itix`, van show.php?action=getStatus).
 */
export function xcomToonStatus(status, web, itix) {
  if (status === 'geannuleerd' || itix === 'geannuleerd') return 'geannuleerd';
  if (itix === 'geweest') return 'geweest';
  if (status === 'reserveren' && web) return web;
  if (status === 'reserveren') return itix ?? status;
  if (status === 'uitverkocht' && itix === 'wachtlijst') return 'wachtlijst';
  if (status === 'uitverkocht' || itix === 'uitverkocht') return 'uitverkocht';
  return status;
}

/**
 * Draait in de browser: de <article>-blokken uit de `html` van /shows.php
 * (De Reggehof): showid, startDate (ISO, lokale tijd), titel, ondertitel,
 * prijs, status, webstatus en de link naar de detailpagina.
 */
export function leesXcomArtikelen(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const t = (e) => e?.textContent.trim().replace(/\s+/g, ' ') || null;
  return [...doc.querySelectorAll('article.program-block')].map((a) => {
    const knop = a.querySelector('[data-hook="order-link-placeholder"]');
    const info = a.querySelector('a.icon-info');
    const klik = /location='([^']+)'/.exec(a.getAttribute('onclick') ?? '')?.[1] ?? null;
    return {
      showid: a.getAttribute('data-showid'),
      start: a.querySelector('[itemprop="startDate"]')?.getAttribute('content') ?? null,
      titel: t(a.querySelector('.program-block__title')),
      ondertitel: t(a.querySelector('.program-block__subtitle')),
      prijs: t(a.querySelector('.program-block__price')),
      status: knop?.getAttribute('data-status') ?? null,
      webstatus: knop?.getAttribute('data-webstatus') ?? null,
      href: info?.getAttribute('href') ?? klik,
    };
  });
}
