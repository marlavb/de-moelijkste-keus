// De Kleine Komedie: de echte scraper op een uitsnede van de agendapagina
// (test/fixtures/kleinekomedie-agenda.html), in Chromium. Tot sep 2026
// kwamen speeldata uit een datumpaneel zonder tijd mee: de tijd staat daar
// niet in .time .start maar in dl.intermission en data-event-start.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

import { scrapeKleineKomedie } from '../src/sites/kleinekomedie.js';

const fixture = readFileSync(new URL('./fixtures/kleinekomedie-agenda.html', import.meta.url), 'utf-8');
const theater = {
  id: 'kleinekomedie',
  naam: 'De Kleine Komedie',
  stad: 'Amsterdam',
  podiumpas: true,
  baseUrl: 'https://www.dekleinekomedie.nl',
  agendaUrl: 'https://www.dekleinekomedie.nl/agenda',
};

test('Kleine Komedie: speeldata uit het datumpaneel krijgen hun tijd; Jenny Arean klopt', async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    // Elke pagina (ook ?p54_page=2) geeft de uitsnede: de helper stopt dan
    // omdat pagina 2 niets nieuws oplevert.
    await page.route('**/*', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: fixture }));
    const shows = await scrapeKleineKomedie({
      page,
      theater,
      robots: { isAllowed: () => true },
      waitForTurn: async () => {},
      log: () => {},
      warn: (m) => assert.fail(`onverwachte waarschuwing: ${m}`),
    });
    const merijn = shows.filter((s) => s.titel === 'Lemming - reprise – Merijn Scholten').map((s) => `${s.datum} ${s.tijd} ${s.beschikbaarheid}`);
    assert.deepEqual(merijn, [
      '2026-09-29 20:15 wachtlijst',
      '2026-09-30 20:15 wachtlijst',
      '2026-10-01 20:15 wachtlijst',
      '2026-10-02 20:15 wachtlijst',
      '2026-10-03 20:15 beschikbaar', // "laatste kaarten"
    ]);
    const jenny = shows.filter((s) => s.titel === 'Jenny Arean zingt');
    // Titelconventie: voorstelling – artiest (de voorstellingsnaam uit
    // data-production-subtitle); Jenny Arean heeft er geen, dus blijft zo.
    assert.equal(jenny.length, 1);
    assert.equal(jenny[0].datum, '2026-10-10');
    assert.equal(jenny[0].tijd, '14:00');
    assert.equal(jenny[0].beschikbaarheid, 'wachtlijst');
    assert.ok(shows.every((s) => s.tijd), 'geen voorstelling zonder tijd');
  } finally {
    await browser.close();
  }
});
