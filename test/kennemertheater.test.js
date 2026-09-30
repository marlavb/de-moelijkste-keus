// Kennemer Theater (Beverwijk): de echte scraper op de programmapagina zoals
// die bij de verkenning op 1 okt 2026 binnenkwam (test/fixtures/
// kennemertheater-programma.html). Het theater staat gepauzeerd (BunnyCDN-
// controle voor de browser); de module blijft getest voor als ze ons toelaten.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

import { scrapeKennemerTheater } from '../src/sites/kennemertheater.js';
import { THEATERS } from '../src/lib/config.js';

const fixture = readFileSync(new URL('./fixtures/kennemertheater-programma.html', import.meta.url), 'utf-8');
const theater = { id: 'kennemertheater', naam: 'Kennemer Theater', stad: 'Beverwijk', podiumpas: false, baseUrl: 'https://www.kennemertheater.nl', agendaUrl: 'https://www.kennemertheater.nl/programma' };

test('Kennemer Theater: Jordy van Loon, cabaret omgedraaid, wervende ondertitel geen maker', async () => {
  const browser = await chromium.launch();
  let shows;
  try {
    const page = await browser.newPage();
    await page.route('**/*', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: fixture }));
    shows = await scrapeKennemerTheater({ page, theater, robots: { isAllowed: () => true }, waitForTurn: async () => {}, log: () => {}, warn: (m) => assert.fail(m) });
  } finally {
    await browser.close();
  }
  const jordy = shows.find((s) => s.maker === 'Jordy van Loon');
  assert.equal(jordy.titel, 'Louis Davids - De Grote, Kleine Man');
  assert.equal(jordy.datum, '2026-10-07');
  assert.equal(jordy.tijd, '20:30');
  assert.equal(jordy.genre, 'Muziektheater');
  assert.equal(jordy.podiumpas, false);
  assert.ok(shows.find((s) => s.titel === 'Verbroedering – Roel & Jos Maalderink'));
  assert.equal(shows.find((s) => s.titel === 'Titanique').maker, null);
  assert.equal(shows.every((s) => s.podiumpas === false), true);
});

test('Kennemer Theater staat gepauzeerd (geen verzoeken), zonder Podiumpas, in Noord-Holland', () => {
  const t = THEATERS.find((x) => x.id === 'kennemertheater');
  assert.deepEqual(t.gepauzeerd, { sinds: '2026-10-01', reden: 'BunnyCDN-botcontrole (403)' });
  assert.equal(t.podiumpas, false);
  assert.equal(t.provincie, 'Noord-Holland');
  assert.equal(t.podiumpasReserveren, undefined);
});
