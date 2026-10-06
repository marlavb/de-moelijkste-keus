// Theater De Nieuwe Vorst (Tilburg): de echte scraper op pagina 1 van de
// agenda (test/fixtures/denieuwevorst-programma.html, 6 okt 2026), in
// Chromium, zonder netwerk.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

import { scrapeDeNieuweVorst } from '../src/sites/denieuwevorst.js';
import { THEATERS } from '../src/lib/config.js';

const fixture = readFileSync(new URL('./fixtures/denieuwevorst-programma.html', import.meta.url), 'utf-8');
const theater = THEATERS.find((t) => t.id === 'denieuwevorst');

test('De Nieuwe Vorst: "Volgende" volgen, uitgelichte items niet dubbel, titels, weglaten', async () => {
  const browser = await chromium.launch();
  const urls = [];
  const waarschuwingen = [];
  let shows;
  try {
    const page = await browser.newPage();
    await page.route('**/*', (r) => {
      urls.push(r.request().url());
      return r.fulfill({ status: 200, contentType: 'text/html', body: fixture });
    });
    shows = await scrapeDeNieuweVorst({ page, theater, robots: { isAllowed: () => true }, waitForTurn: async () => {}, log: () => {}, warn: (m) => waarschuwingen.push(m) });
  } finally {
    await browser.close();
  }
  assert.deepEqual(waarschuwingen, []);
  assert.deepEqual(urls, ['https://denieuwevorst.nl/programma', 'https://denieuwevorst.nl/programma/p2']);
  assert.deepEqual(shows.map((s) => s.titel).sort(), ['I Like Art and Art Likes me', 'Mystiek lichaam', 'NOISE', 'POR (6+)', 'So You Think You Know Dance']);
  const mystiek = shows.find((s) => s.titel === 'Mystiek lichaam');
  assert.equal(mystiek.maker, 'Toneelschuur producties');
  assert.equal(mystiek.datum, '2026-10-15');
  assert.equal(mystiek.tijd, '20:30');
  assert.equal(mystiek.genre, 'Toneel');
  assert.equal(mystiek.beschikbaarheid, 'onbekend');
  assert.equal(mystiek.podiumpas, true);
  // Uitgelicht én in de lijst: één speeldatum.
  assert.equal(shows.filter((s) => s.titel === 'So You Think You Know Dance').length, 1);
  assert.equal(shows.find((s) => s.titel === 'POR (6+)').genre, 'Toneel');
  // Uitgelicht item eerder in de lijst dan zijn datum: het jaar klopt toch.
  assert.equal(shows.find((s) => s.titel === 'I Like Art and Art Likes me').datum, '2026-10-31');
});
