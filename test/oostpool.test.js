// Huis Oostpool: de echte scraper op een ingekorte agendapagina
// (test/fixtures/oostpool-agenda.html, 7 okt 2026), in Chromium, zonder netwerk.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

import { scrapeOostpool, oostpoolStatus } from '../src/sites/oostpool.js';
import { THEATERS } from '../src/lib/config.js';

const agenda = readFileSync(new URL('./fixtures/oostpool-agenda.html', import.meta.url), 'utf-8');
const theater = THEATERS.find((t) => t.id === 'oostpool');

test('Huis Oostpool: alleen het eigen huis, jaar uit de maandkop, status en try-out/première', async () => {
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
    shows = await scrapeOostpool({ page, theater, robots: { isAllowed: () => true }, waitForTurn: async () => {}, log: (m) => logs.push(m) });
  } finally {
    await browser.close();
  }
  assert.equal(urls.length, 1);
  const kort = (s) => `${s.titel} | ${s.datum} ${s.tijd} | ${s.beschikbaarheid} | ${s.beschrijving ?? '-'}`;
  assert.deepEqual(shows.map(kort), [
    'The Drama | 2026-10-07 20:15 | uitverkocht | -',
    'The Drama | 2026-10-08 20:15 | uitverkocht | -',
    'The Drama | 2026-10-09 20:15 | uitverkocht | -',
    'The Drama | 2026-10-10 20:15 | uitverkocht | -',
    'The Drama | 2026-12-11 20:15 | uitverkocht | -',
    'The Drama | 2026-12-12 20:15 | uitverkocht | -',
    'Millennial II Browser History X | 2027-01-27 20:15 | beschikbaar | Try-out',
    'Millennial II Browser History X | 2027-01-28 20:15 | beschikbaar | Try-out',
    'Millennial II Browser History X | 2027-01-29 20:15 | beschikbaar | Try-out',
    'Millennial II Browser History X | 2027-01-30 20:15 | beschikbaar | Première',
  ]);
  assert.ok(shows.every((s) => s.podiumpas && s.theaterNaam === 'Huis Oostpool' && s.maker === 'Theater Oostpool'));
  assert.match(shows[0].reserverenUrl, /^https:\/\/bestellen\.oostpool\.nl\/ProgrammaDetail\.aspx\?id=\d+$/);
  assert.ok(logs.some((l) => /6 speeldatum\(s\) elders/.test(l)), logs.join('\n'));
});

test('Huis Oostpool: status', () => {
  assert.equal(oostpoolStatus('Uitverkocht'), 'uitverkocht');
  assert.equal(oostpoolStatus('Bestel Naar bestellen'), 'beschikbaar');
  assert.equal(oostpoolStatus('Verwacht'), 'onbekend');
});
