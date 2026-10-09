// Gedeelde stukken voor theatersites van The Cre8ion.Lab (Het Speelhuis,
// Schouwburg Concertzaal Tilburg, Willem Twee; okt 2026). Zelfde CMS:
// paginering met ?page=N (1 = de eerste pagina; "?page=0" is alleen de
// uitgeschakelde knop "vorige"), en bij Speelhuis en Schouwburg Concertzaal
// per programma een dataLayer-script met naam, prijs, genre, zaal en datum.
// De opmaak van de lijst verschilt per site; die lezen de scrapers zelf.

import { pagineerListing } from './peppered.js';

/**
 * Leest de dataLayer-gegevens uit de scripts van de pagina (draait in de
 * browser): per programma-id { naam, prijs, genre, zaal, datum, tijd }.
 * "datum" is "15-10-2026" of "Meerdere datums"; "tijd" alleen bij
 * Speelhuis (item_category4). Scripts van de site zelf laden we niet: dit
 * leest alleen de tekst van de inline scripts.
 */
export function leesDataLayerInBrowser() {
  const per = {};
  const re = /item_name: "((?:[^"\\]|\\.)*)",\s*item_id: (\d+),\s*price: ([\d.]+),\s*quantity: 1,(?:\s*index: \d+,)?\s*item_category: "((?:[^"\\]|\\.)*)",\s*item_category2: "((?:[^"\\]|\\.)*)",\s*item_category3: "((?:[^"\\]|\\.)*)"(?:,\s*item_category4: "((?:[^"\\]|\\.)*)")?/g;
  for (const script of document.querySelectorAll('script')) {
    const t = script.textContent;
    if (!t.includes('item_category')) continue;
    for (const m of t.matchAll(re)) {
      const id = m[2];
      if (per[id]) continue;
      per[id] = { naam: m[1], prijs: Number(m[3]), genre: m[4], zaal: m[5], datum: m[6], tijd: m[7] ?? null };
    }
  }
  return per;
}

/** "15-10-2026" → "2026-10-15"; anders null. */
export function dataLayerDatum(tekst) {
  const m = String(tekst ?? '').match(/^(\d{2})-(\d{2})-(\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

/**
 * Alle pagina's van een Cre8ion-agenda (agendaUrl, dan ?page=2, ?page=3, …),
 * tot een pagina niets nieuws oplevert. `extract` draait in de browser.
 */
export function pagineerCre8ion({ page, theater, robots, waitForTurn, log, warn, agendaPath, extract, sleutelVan, maxPages = 40, label = 'speeldata' }) {
  return pagineerListing({
    page,
    theater,
    robots,
    waitForTurn,
    log,
    warn,
    agendaPath,
    extract,
    sleutelVan,
    maxPages,
    parameter: 'page',
    leesParameter: false,
    leegIsFout: true,
    label,
  });
}

const MAANDEN = { jan: 1, feb: 2, mrt: 3, maa: 3, apr: 4, mei: 5, jun: 6, jul: 7, aug: 8, sep: 9, okt: 10, nov: 11, dec: 12 };

/** "do 08 okt 2026" → "2026-10-08" (alleen met jaartal; anders null). */
export function datumMetJaar(tekst) {
  const m = String(tekst ?? '').toLowerCase().match(/(\d{1,2})\s+([a-z]{3})[a-z]*\.?\s+(\d{4})/);
  if (!m || !MAANDEN[m[2]]) return null;
  return `${m[3]}-${String(MAANDEN[m[2]]).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}

/**
 * Productie-URL's uit sitemap.xml van een Cre8ion-site (alleen /agenda/<slug>,
 * niet koop-ticket). De agenda zelf laadt via /mvc/, dat robots.txt verbiedt
 * (Munttheater, MIMIK); de sitemap en de productiepagina's mogen wel.
 */
export function productieUrls(xml) {
  const urls = [...String(xml).matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1]);
  return [...new Set(urls.filter((u) => /\/agenda\/[^/?#]+$/.test(u) && !/\/agenda\/koop-ticket$/.test(u)))];
}
