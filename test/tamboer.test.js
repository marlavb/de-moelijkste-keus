// De Tamboer: de echte scraper op een ingekorte programmapagina uit de cache
// van 8 okt 2026 (test/fixtures/tamboer-programma.html), in Chromium, zonder netwerk.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

import { scrapeTamboer, tamboerDatum, tamboerBeschikbaarheid } from '../src/sites/tamboer.js';
import { THEATERS } from '../src/lib/config.js';

const lees = (naam) => readFileSync(new URL(`./fixtures/${naam}`, import.meta.url), 'utf-8');
const html = (body, status = 200) => ({ status, contentType: 'text/html; charset=utf-8', body });

async function draai(scraper, id, route) {
  const browser = await chromium.launch();
  const urls = [];
  const logs = [];
  try {
    const page = await browser.newPage();
    await page.route('**/*', (r) => {
      const url = new URL(r.request().url());
      urls.push(url.pathname + url.search);
      return r.fulfill(route(url));
    });
    const theater = THEATERS.find((t) => t.id === id);
    const shows = await scraper({ page, theater, robots: { isAllowed: () => true }, waitForTurn: async () => {}, log: (m) => logs.push(m), warn: (m) => logs.push(`WARN ${m}`) });
    return { shows, urls, logs };
  } finally {
    await browser.close();
  }
}

const kort = (s) => `${s.titel} | ${s.datum} ${s.tijd ?? '-'} | ${s.beschikbaarheid} | pas ${s.podiumpas} | ${s.prijs ?? '-'}${s.zaal ? ` | ${s.zaal}` : ''}`;

test('De Tamboer: één verzoek, alle kaarten; cabaret "Voorstelling – Artiest"; Het Podium als zaal', async () => {
  const { shows, urls, logs } = await draai(scrapeTamboer, 'tamboer', () => html(lees('tamboer-programma.html')));
  assert.deepEqual(urls, ['/programma?resultaten=30']);
  assert.deepEqual(shows.map(kort), [
    'Irish Festival | 2026-10-10 20:00 | beschikbaar | pas true | 39.5',
    'Het Orkest van de Koninklijke Luchtmacht presenteert | 2026-10-15 20:00 | beschikbaar | pas true | -',
    'Altijd aan – Pieter Verelst | 2026-10-15 20:00 | beschikbaar | pas true | 22',
    'Danny Vera | 2026-10-16 20:00 | uitverkocht | pas true | 49.5',
    'Juf Braaksel De Musical (6+) | 2026-10-17 19:00 | beschikbaar | pas true | 27.5',
    'Dimitris Karkoulias trio | 2026-10-18 15:00 | beschikbaar | pas true | 17.5 | Het Podium',
    '23 Brieven van Vincent van Gogh | 2026-10-20 20:00 | wachtlijst | pas true | 19.5',
    'Contra | 2026-10-22 20:00 | beschikbaar | pas true | 20',
  ]);
  assert.match(shows[0].reserverenUrl, /^https:\/\/detamboer\.nl\/programma\/irish-festival-2026\/bestel\/\d+$/);
  assert.equal(logs.some((l) => /WARN/.test(l)), false, logs.join('\n'));
});

test('De Tamboer: Cloudflare-challenge of 403 → geblokkeerd (geen omweg)', async () => {
  await assert.rejects(draai(scrapeTamboer, 'tamboer', () => html('<html><head><title>Just a moment...</title></head><body></body></html>')), { name: 'ScrapeBlockedError' });
  await assert.rejects(draai(scrapeTamboer, 'tamboer', () => html('', 403)), { name: 'ScrapeBlockedError' });
});

test('De Tamboer: datum en knop', () => {
  assert.deepEqual(tamboerDatum('zaterdag 10 oktober 2026 20.00 uur'), { datum: '2026-10-10', tijd: '20:00' });
  assert.deepEqual(tamboerDatum('zaterdag 14 november 2026'), { datum: '2026-11-14', tijd: null });
  assert.equal(tamboerBeschikbaarheid('Geannuleerd'), 'afgelast');
  assert.equal(tamboerBeschikbaarheid('Wachtlijst'), 'wachtlijst');
  assert.equal(tamboerBeschikbaarheid('Bestel'), 'beschikbaar');
});

