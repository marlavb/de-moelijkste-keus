// TAR: de echte scraper op een ingekorte agendapagina en één antwoord van
// het lijst-endpoint (test/fixtures/tar-*.html/json, 7 okt 2026), in
// Chromium, zonder netwerk.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

import { scrapeTar } from '../src/sites/tar.js';
import { THEATERS } from '../src/lib/config.js';

const agenda = readFileSync(new URL('./fixtures/tar-agenda.html', import.meta.url), 'utf-8');
const lijst = readFileSync(new URL('./fixtures/tar-lijst.json', import.meta.url), 'utf-8');
const theater = THEATERS.find((t) => t.id === 'tar');

test('TAR: agenda + lijst-endpoint, Happy Hour/residenties/workshops weg, maker, première', async () => {
  const browser = await chromium.launch();
  const urls = [];
  const logs = [];
  let shows;
  try {
    const page = await browser.newPage();
    await page.route('**/*', (r) => {
      const url = r.request().url();
      urls.push(url);
      if (url.includes('/wp-json/tar/v1/list')) return r.fulfill({ status: 200, contentType: 'application/json', body: lijst });
      return r.fulfill({ status: 200, contentType: 'text/html', body: agenda });
    });
    shows = await scrapeTar({ page, theater, robots: { isAllowed: () => true }, waitForTurn: async () => {}, log: (m) => logs.push(m), warn: (m) => logs.push(`WARN ${m}`) });
  } finally {
    await browser.close();
  }
  const kort = (s) => `${s.titel} | ${s.datum} ${s.tijd} | ${s.genre} | ${s.maker ?? '-'} | ${s.beschikbaarheid}`;
  assert.deepEqual(shows.map(kort), [
    'Schaduwstemmen | 2026-10-09 20:00 | Dans | PEELED COLLECTIVE | beschikbaar',
    'Enfin, Barbin. | 2026-10-13 20:00 | Overig | Marleen Hendrickx | beschikbaar',
    'Museum of Black Futures | 2026-10-23 20:00 | Dans | Richard Kofi | beschikbaar',
    'Before the Story Starts | 2026-10-29 20:00 | Overig | URLAND | beschikbaar',
    'Het Debuut 2026 | 2026-11-05 20:00 | Toneel | - | beschikbaar',
    'BANG | 2026-11-12 20:00 | Toneel | Hanneke van der Paardt | beschikbaar',
    'Motherland: The Return of Katinka | 2026-11-24 20:00 | Toneel | Jip Smit | beschikbaar',
    'Draagkracht | 2026-11-25 20:00 | Dans | Cheroney Pelupessy | onbekend',
    'Stuntwoman! | 2026-11-26 20:00 | Overig | Ika Schwander & Lizzy Deacon / Frascati Producties | beschikbaar',
  ]);
  assert.deepEqual(urls, ['https://tar.nl/agenda/', 'https://tar.nl/wp-json/tar/v1/list?post=38&block=2&offset=8&size=8']);
  assert.match(shows[0].beschrijving, /^Première/);
  assert.match(shows[0].reserverenUrl, /^https:\/\/apps\.ticketmatic\.com\//);
  assert.ok(shows.every((s) => s.podiumpas === null), 'TAR: Podiumpas nog niet bekend (null)');
  assert.ok(logs.some((l) => l === 'weggelaten: Happy Hour (3), workshop (4)'), logs.join('\n'));
  assert.equal(logs.some((l) => /WARN/.test(l)), false, logs.join('\n'));
});
