// Theater Orpheus: de echte scraper op een ingekorte agendapagina
// (test/fixtures/orpheus-agenda.html), in Chromium, zonder netwerk.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

import { scrapeOrpheus, orpheusStatus } from '../src/sites/orpheus.js';
import { THEATERS } from '../src/lib/config.js';

const agenda = readFileSync(new URL('./fixtures/orpheus-agenda.html', import.meta.url), 'utf-8');
const theater = THEATERS.find((t) => t.id === 'orpheus');

test('Orpheus: speeldata, eigen zaal (in-other-location) niet als tournee, Podiumpas tot €50, extern/gratis false, randprogramma weg', async () => {
  const browser = await chromium.launch();
  const urls = [];
  const logs = [];
  let shows;
  try {
    const page = await browser.newPage();
    await page.route('**/*', (r) => {
      urls.push(r.request().url());
      return r.fulfill({ status: 200, contentType: 'text/html', body: agenda });
    });
    shows = await scrapeOrpheus({ page, theater, robots: { isAllowed: () => true }, waitForTurn: async () => {}, log: (m) => logs.push(m), warn: (m) => logs.push(`WARN ${m}`) });
  } finally {
    await browser.close();
  }
  assert.ok(urls.every((u) => !/\/voorstellingen\/[a-z]/.test(u)), 'geen detailpagina\'s');
  const kort = (s) => `${s.titel} | ${s.datum.slice(5)} ${s.tijd} | ${s.beschikbaarheid} | pas ${s.podiumpas} | ${s.zaal ?? '-'}`;
  assert.deepEqual(shows.map(kort), [
    'Altijd Aan – Pieter Verelst | 10-14 20:00 | uitverkocht | pas true | Altioszaal',
    'Darkride | 06-12 20:00 | beschikbaar | pas true | Hanoszaal',
    'Darkride | 06-13 14:00 | afgelast | pas true | Hanoszaal',
    'Kerstconcert | 12-18 20:00 | beschikbaar | pas false | -',
    'Eloi Youssef | 10-16 20:30 | beschikbaar | pas false | -',
    'Open Podium | 10-11 15:00 | beschikbaar | pas false | -',
  ]);
  // Ondertitel: maker, voorstelling (cabaret) of omschrijving.
  assert.equal(shows[1].maker, null);
  assert.equal(shows[1].beschrijving, 'A mystical journey into the World of Wonders');
  assert.equal(shows[3].maker, 'Bombastisch Koor');
  assert.equal(shows[4].beschrijving, 'In de Grote Kerk');
  assert.equal(shows[0].genre, 'Cabaret');
  assert.equal(shows[4].genre, 'Muziek & Concert');
  assert.equal(shows[5].genre, 'Overig');
  assert.ok(logs.some((l) => /weggelaten: randprogramma/.test(l)), logs.join('\n'));
  assert.equal(logs.some((l) => /WARN onbekende brongenres/.test(l)), false, logs.join('\n'));
});

test('Orpheus: status', () => {
  assert.equal(orpheusStatus('laatste tickets'), 'beschikbaar');
  assert.equal(orpheusStatus('uitverkocht'), 'uitverkocht');
  assert.equal(orpheusStatus('geannuleerd'), 'afgelast');
  assert.equal(orpheusStatus('Vanaf wo 21 okt 2026 11:00'), 'onbekend');
  assert.equal(orpheusStatus('niet reserveerbaar'), 'onbekend');
});
