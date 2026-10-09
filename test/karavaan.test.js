// Karavaan (Theater de Drukkerij): de echte scraper op de locatiepagina en
// drie detailpagina's uit de cache van 9 okt 2026 (test/fixtures/karavaan-*,
// zonder scripts), in Chromium, zonder netwerk. De andere detailpagina's
// geven 404: dan de kaart zonder tijd, met een waarschuwing.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { scrapeKaravaan, karavaanDatum, karavaanTijd, karavaanStatus } from '../src/sites/karavaan.js';
import { THEATERS } from '../src/lib/config.js';

const theater = THEATERS.find((t) => t.id === 'karavaan');
const lees = (naam) => readFileSync(new URL(`./fixtures/${naam}`, import.meta.url), 'utf-8');
const DETAIL = ['het-wakker-liggen-van-wanda', 'de-lente-vatte-vlam', 'heddagabber'];

test('Karavaan: tijden en status van de detailpagina, elke productie elke nacht; zonder detailpagina de kaart zonder tijd', async () => {
  const browser = await chromium.launch();
  const urls = [];
  const logs = [];
  try {
    const page = await browser.newPage();
    await page.route('**/*', (r) => {
      const url = new URL(r.request().url());
      urls.push(url.pathname);
      if (url.pathname === '/location/de-drukkerij/') return r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: lees('karavaan-locatie.html') });
      const slug = url.pathname.match(/^\/voorstellingen\/([^/]+)\/$/)?.[1];
      if (DETAIL.includes(slug)) return r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: lees(`karavaan-${slug}.html`) });
      return r.fulfill({ status: 404, contentType: 'text/html', body: '<html><body>Niet gevonden</body></html>' });
    });
    const shows = await scrapeKaravaan({ page, theater, robots: { isAllowed: () => true }, waitForTurn: async () => {}, log: (m) => logs.push(m), warn: (m) => logs.push(`WARN ${m}`) });
    // Elke productie: één detailpagina.
    assert.equal(urls.filter((u) => u.startsWith('/voorstellingen/')).length, 9);
    const kort = (s) => `${s.titel} | ${s.datum} ${s.tijd ?? '-'} | ${s.beschikbaarheid}`;
    const per = Object.fromEntries(shows.map((s) => [s.titel, kort(s)]));
    assert.equal(per['De lente vatte vlam'], 'De lente vatte vlam | 2026-10-15 20:00 | onbekend');
    assert.equal(per['Het wakker liggen van Wanda'], 'Het wakker liggen van Wanda | 2026-10-29 20:00 | uitverkocht');
    assert.equal(per['Hedda Gabber'], 'Hedda Gabber | 2026-11-12 20:00 | onbekend');
    // Zonder detailpagina (404): de kaart, zonder tijd.
    assert.equal(per['Club Roxy'], 'Club Roxy | 2027-01-14 - | onbekend');
    assert.equal(shows.length, 9);
    assert.equal(shows.find((s) => s.titel === 'Hedda Gabber').reserverenUrl, 'https://www.karavaan.nl/voorstellingen/heddagabber/');
    assert.equal(logs.filter((l) => l.startsWith('WARN') && /geen #dates-list/.test(l)).length, 6, logs.join('\n'));
    assert.ok(logs.some((l) => /3 detailpagina\('s\) met speeldata en tijden gelezen/.test(l)), logs.join('\n'));
  } finally {
    await browser.close();
  }
});

test('Karavaan: datum, tijd en status uit de detailpagina', () => {
  assert.equal(karavaanDatum('15-10-2026'), '2026-10-15');
  assert.equal(karavaanDatum('5-1-2027'), '2027-01-05');
  assert.equal(karavaanDatum(''), null);
  assert.equal(karavaanTijd('20:00 uur'), '20:00');
  assert.equal(karavaanTijd('14.30 uur'), '14:30');
  assert.equal(karavaanTijd(''), null);
  assert.equal(karavaanStatus('uitverkocht'), 'uitverkocht');
  assert.equal(karavaanStatus(''), 'onbekend');
  assert.equal(karavaanStatus('Bestel tickets'), 'beschikbaar');
  assert.equal(karavaanStatus('Geannuleerd'), 'afgelast');
});
