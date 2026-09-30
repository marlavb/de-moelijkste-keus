// Cpunt (Hoofddorp): de echte scraper op een uitsnede van de agenda
// (test/fixtures/cpunt-agenda.html, uit de lokale cache van 1 okt 2026), in
// Chromium, zonder netwerk.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

import { scrapeCpunt } from '../src/sites/cpunt.js';
import { watchlistSleutel } from '../public/js/watchlist.js';

const fixture = readFileSync(new URL('./fixtures/cpunt-agenda.html', import.meta.url), 'utf-8');
const theater = { id: 'cpunt', naam: 'Cpunt', stad: 'Hoofddorp', podiumpas: false, baseUrl: 'https://www.cpunt.nl', agendaUrl: 'https://www.cpunt.nl/agenda' };

test('Cpunt: alleen Theater, Jordy van Loon in de Kleine Pier, status en titels', async () => {
  const browser = await chromium.launch();
  let shows;
  const waarschuwingen = [];
  try {
    const page = await browser.newPage();
    await page.route('**/*', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: fixture }));
    shows = await scrapeCpunt({ page, theater, robots: { isAllowed: () => true }, waitForTurn: async () => {}, log: () => {}, warn: (m) => waarschuwingen.push(m) });
  } finally {
    await browser.close();
  }
  assert.deepEqual(waarschuwingen, []);
  // 10 items: 2 buiten de categorie Theater en 1 testitem eruit.
  assert.equal(shows.length, 7);
  assert.equal(shows.some((s) => /TESTING/.test(s.titel)), false);

  const jordy = shows.find((s) => s.titel === 'Jordy van Loon');
  assert.equal(jordy.maker, 'Speelt Louis Davids');
  assert.equal(jordy.datum, '2026-10-02');
  assert.equal(jordy.tijd, '20:00');
  assert.equal(jordy.zaal, 'Kleine Pier');
  assert.equal(jordy.locatie, undefined);
  assert.equal(jordy.podiumpas, false);
  assert.equal(watchlistSleutel(jordy.titel, 'cpunt'), 'jordy van loon');

  // Cabaret omgedraaid; slogan vóór de hoofdcategorie wordt beschrijving.
  const guido = shows.find((s) => s.titel === 'Oudejaarsconference 2026 – Guido Weijers');
  assert.equal(guido.beschrijving, 'Zeven Punt Een - 7.1');
  assert.equal(guido.beschikbaarheid, 'wachtlijst');
  assert.ok(shows.find((s) => s.titel === 'Ruim – Kasper van der Laan'));

  // Anders bronvolgorde met de ondertitel (hier de cast) als maker.
  assert.equal(shows.find((s) => s.titel === 'Next to Normal').maker, 'Willemijn Verkaik, Edwin Jonker e.a.');

  // "Geannuleerd" op de knop → afgelast.
  assert.equal(shows.find((s) => /Myrte Siebinga/.test(s.titel)).beschikbaarheid, 'afgelast');
});
