// PLT (Heerlen, Kerkrade, Sittard): de echte scraper op pagina 1 van de
// agenda (test/fixtures/plt-programma.html, 6 okt 2026), in Chromium,
// zonder netwerk. Elke ?page=N krijgt dezelfde pagina: niets nieuws, dus stop.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

import { scrapeAllPlt, leesPltDetails, pltStatus } from '../src/sites/plt.js';
import { THEATERS } from '../src/lib/config.js';

const fixture = readFileSync(new URL('./fixtures/plt-programma.html', import.meta.url), 'utf-8');
const theater = THEATERS.find((t) => t.id === 'pltheerlen');

test('PLT: tegels per zaal, status, titels, film weg', async () => {
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
    shows = await scrapeAllPlt({ page, theater, robots: { isAllowed: () => true }, waitForTurn: async () => {}, log: () => {}, warn: (m) => waarschuwingen.push(m) });
  } finally {
    await browser.close();
  }
  assert.deepEqual(urls, ['https://www.plt.nl/programma', 'https://www.plt.nl/programma?page=2']);
  // Pagina 2 gaf niets nieuws: gestopt vóór de teller (55).
  assert.deepEqual(waarschuwingen, ['gestopt bij pagina 2 van 55.']);
  // 12 tegels: 1 film en 1 zonder zaallogo ("Bij de Buren", buiten de eigen theaters).
  assert.equal(shows.length, 10);
  assert.ok(!shows.some((s) => /Juste une Illusion|Douwe Bob/i.test(s.titel)));
  const controle = shows.find((s) => s.titel === 'Controle');
  assert.equal(controle.theaterId, 'pltheerlen');
  assert.equal(controle.maker, '155 & Maas theater en dans');
  assert.equal(controle.datum, '2026-10-07');
  assert.equal(controle.tijd, '19:30');
  assert.equal(controle.genre, 'Dans');
  assert.equal(controle.podiumpas, false);
  assert.equal(shows.find((s) => /Waylon/.test(s.titel)).titel, 'Time Jumper (reprise) – Waylon');
  assert.equal(shows.find((s) => /Napleiten/.test(s.titel)).beschikbaarheid, 'afgelast');
  assert.equal(shows.find((s) => /Pieter Derks/.test(s.titel)).beschikbaarheid, 'wachtlijst');
  assert.equal(shows.find((s) => /Zonder invloed/.test(s.titel)).genre, 'Cabaret');
  assert.deepEqual([...new Set(shows.map((s) => s.theaterId))].sort(), ['pltheerlen', 'pltkerkrade', 'pltsittard']);
});

test('PLT: hulpfuncties', () => {
  assert.deepEqual(leesPltDetails('Klassiek & Opera - Zo 11 okt. 2026 - 11:00 uur'), { genre: 'Klassiek & Opera', datum: '2026-10-11', tijd: '11:00' });
  assert.equal(pltStatus(null), 'beschikbaar');
  assert.equal(pltStatus('Geannuleerd'), 'afgelast');
  assert.equal(pltStatus('Uitverkocht'), 'uitverkocht');
});
