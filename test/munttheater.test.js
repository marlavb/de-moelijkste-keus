// Munttheater (Weert): de echte scraper op een ingekorte sitemap en twee
// productiepagina's (test/fixtures/munttheater-*, 6 okt 2026), in Chromium,
// zonder netwerk.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

import { scrapeMunttheater, productieUrls, genreUitTags, muntStatus } from '../src/sites/munttheater.js';
import { THEATERS } from '../src/lib/config.js';

const lees = (n) => readFileSync(new URL(`./fixtures/${n}`, import.meta.url), 'utf-8');
const sitemap = lees('munttheater-sitemap.xml');
const theater = THEATERS.find((t) => t.id === 'munttheater');

test('Munttheater: sitemap + productiepagina\'s, JSON-LD-data, knoppen', async () => {
  const browser = await chromium.launch();
  const urls = [];
  const waarschuwingen = [];
  let shows;
  try {
    const page = await browser.newPage();
    await page.route('**/*', (r) => {
      const url = r.request().url();
      urls.push(url);
      if (url.endsWith('/sitemap.xml')) return r.fulfill({ status: 200, contentType: 'application/xml', body: sitemap });
      const body = url.endsWith('/agenda/contra') ? lees('munttheater-contra.html') : lees('munttheater-tineke.html');
      return r.fulfill({ status: 200, contentType: 'text/html', body });
    });
    shows = await scrapeMunttheater({ page, theater, robots: { isAllowed: () => true }, waitForTurn: async () => {}, log: () => {}, warn: (m) => waarschuwingen.push(m), vandaag: '2026-10-06' });
  } finally {
    await browser.close();
  }
  assert.deepEqual(waarschuwingen, []);
  assert.deepEqual(urls, [
    'https://www.munttheater.nl/sitemap.xml',
    'https://www.munttheater.nl/agenda/contra',
    'https://www.munttheater.nl/agenda/tineke-schouten-femme-vitaal',
  ]);
  assert.equal(shows.length, 3);
  const tineke = shows.filter((s) => /Tineke/.test(s.titel));
  assert.deepEqual(tineke.map((s) => `${s.datum} ${s.tijd}`), ['2026-10-07 20:15', '2026-10-08 20:15']);
  assert.equal(tineke[0].titel, 'Femme Vitaal – Tineke Schouten');
  assert.equal(tineke[0].genreRuw, 'Show');
  assert.equal(tineke[0].beschikbaarheid, 'beschikbaar');
  assert.equal(tineke[0].prijs, 41.5);
  assert.equal(tineke[0].podiumpas, false);
  const contra = shows.find((s) => s.titel === 'CONTRA');
  assert.equal(contra.datum, '2026-11-03');
  assert.equal(contra.genre, 'Muziektheater');
  assert.equal(contra.beschikbaarheid, 'beschikbaar');
});

test('Munttheater: hulpfuncties', () => {
  assert.deepEqual(productieUrls(sitemap), ['https://www.munttheater.nl/agenda/contra', 'https://www.munttheater.nl/agenda/tineke-schouten-femme-vitaal']);
  assert.equal(genreUitTags(['Toneelserie', 'Toneel']), 'Toneel');
  assert.equal(genreUitTags(['Komedie / Cabaret']), 'Komedie');
  assert.equal(muntStatus('Uitverkocht'), 'uitverkocht');
  assert.equal(muntStatus('Kaarten', 'https://schema.org/EventCancelled'), 'afgelast');
});

// ICE en Loïs Lane (8 okt 2026): de Tineke-pagina met andere JSON-LD-gegevens.
test('Munttheater: "ICE" → "Live in Theater – ICE" (VOORSTELLING_BIJ_ARTIEST); jubileum als performer → "Loïs Lane in concert: 40 jaar"', async () => {
  const tineke = lees('munttheater-tineke.html');
  const ice = tineke.replaceAll('Tineke Schouten', 'ICE').replaceAll('Femme Vitaal', 'Live in theater');
  const lois = tineke.replaceAll('Tineke Schouten', 'Loïs Lane in concert').replaceAll('Femme Vitaal', '40 jaar');
  const browser = await chromium.launch();
  let shows;
  try {
    const page = await browser.newPage();
    await page.route('**/*', (r) => {
      const url = r.request().url();
      if (url.endsWith('/sitemap.xml')) return r.fulfill({ status: 200, contentType: 'application/xml', body: sitemap });
      return r.fulfill({ status: 200, contentType: 'text/html', body: url.endsWith('/agenda/contra') ? ice : lois });
    });
    shows = await scrapeMunttheater({ page, theater, robots: { isAllowed: () => true }, waitForTurn: async () => {}, log: () => {}, warn: () => {}, vandaag: '2026-10-06' });
  } finally {
    await browser.close();
  }
  const titels = [...new Set(shows.map((s) => `${s.titel} | ${s.maker ?? '-'} | ${s.beschrijving ?? '-'}`))].sort();
  assert.deepEqual(titels, ['Live in Theater – ICE | - | Live in theater', 'Loïs Lane in concert: 40 jaar | - | -']);
});
