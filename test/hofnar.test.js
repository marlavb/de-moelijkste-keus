// Theater de Hofnar (Valkenswaard): de echte scraper op een uitsnede van het
// overzicht en één productiepagina (fixtures van 6 okt 2026), in Chromium,
// zonder netwerk. Elke productiepagina krijgt in de test dezelfde inhoud.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

import { scrapeHofnar, hofnarStatus } from '../src/sites/hofnar.js';
import { THEATERS } from '../src/lib/config.js';

const overzicht = readFileSync(new URL('./fixtures/hofnar-theater.html', import.meta.url), 'utf-8');
const detail = readFileSync(new URL('./fixtures/hofnar-detail.html', import.meta.url), 'utf-8');
const theater = THEATERS.find((t) => t.id === 'hofnar');

test('status', () => {
  assert.equal(hofnarStatus('Uitverkocht | wachtlijst'), 'wachtlijst');
  assert.equal(hofnarStatus('Uitverkocht'), 'uitverkocht');
  assert.equal(hofnarStatus('Info & tickets'), 'beschikbaar');
  assert.equal(hofnarStatus('Laatste tickets'), 'beschikbaar');
  assert.equal(hofnarStatus('Geannuleerd'), 'afgelast');
});

test('Hofnar: één pagina per productie (niet dubbel), tijden uit de productiepagina, Podiumpas, festival weg', async () => {
  const browser = await chromium.launch();
  const urls = [];
  const waarschuwingen = [];
  let beurten = 0;
  let shows;
  try {
    const page = await browser.newPage();
    await page.route('**/*', (r) => {
      const url = r.request().url();
      urls.push(url);
      return r.fulfill({ status: 200, contentType: 'text/html', body: url === theater.agendaUrl ? overzicht : detail });
    });
    shows = await scrapeHofnar({ page, theater, robots: { isAllowed: () => true }, waitForTurn: async () => { beurten++; }, log: () => {}, warn: (m) => waarschuwingen.push(m) });
  } finally {
    await browser.close();
  }
  assert.deepEqual(waarschuwingen, []);
  // Overzicht + 5 producties (7 items: 1 dubbel, 1 festival).
  assert.equal(urls.length, 6, urls.join('\n'));
  assert.equal(new Set(urls).size, 6, 'geen productiepagina twee keer');
  assert.equal(beurten, 6, 'waitForTurn vóór elk verzoek');
  assert.equal(shows.length, 5);

  const bert = shows.find((s) => /Bert Visscher/.test(s.titel));
  assert.equal(bert.titel, '65 Dat Zou Je Niet Zeggen – Bert Visscher');
  assert.equal(bert.datum, '2026-10-31');
  assert.equal(bert.tijd, '20:15');
  assert.equal(bert.beschikbaarheid, 'wachtlijst');
  assert.equal(bert.prijs, 29.5);
  assert.equal(bert.podiumpas, true);
  assert.match(bert.reserverenUrl, /^https:\/\/bestellen\.hofnar\.nl\/widgets\/hofnar\//);

  // Yes Jazz (kaartverkoop door derden): geen Podiumpas. "Yes Jazz" is de
  // concertreeks: geen titel en geen maker, maar de beschrijving.
  const jazz = shows.find((s) => /Yes Jazz/.test(`${s.titel} ${s.maker ?? ''} ${s.beschrijving ?? ''}`));
  assert.ok(jazz);
  assert.equal(jazz.podiumpas, false);
  assert.equal(jazz.titel, 'Trio Happy Village met Frank Montis');
  assert.equal(jazz.maker, null);
  assert.equal(jazz.beschrijving, 'Yes Jazz');
  // Klassiek wisselt (oude aanpak): "Bram Invites" blijft de titel.
  assert.ok(shows.some((s) => s.titel === 'Bram Invites'));
  // Festival weggelaten.
  assert.equal(shows.some((s) => s.genreRuw === 'Festival'), false);
});
