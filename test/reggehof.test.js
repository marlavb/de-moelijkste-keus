// De Reggehof: de echte scraper op /shows.php-antwoorden uit de cache van
// 9 okt 2026 (test/fixtures/reggehof-shows.json: twee lijstpagina's en de
// genrefilters cabaret en familie), in Chromium, zonder netwerk.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

import { scrapeReggehof, GENRE_FILTERS } from '../src/sites/reggehof.js';
import { THEATERS } from '../src/lib/config.js';

const fx = JSON.parse(readFileSync(new URL('./fixtures/reggehof-shows.json', import.meta.url), 'utf-8'));
const theater = THEATERS.find((t) => t.id === 'reggehof');
const LEEG = { html: '', pages: 1, currentPage: 1, countItemsTotal: 0 };

test('De Reggehof: lijst + genrefilters, zitten/staan samengevoegd, cabaret als "Voorstelling – Artiest"', async () => {
  const browser = await chromium.launch();
  const urls = [];
  const logs = [];
  let shows;
  try {
    const page = await browser.newPage();
    await page.route('**/*', (r) => {
      const url = new URL(r.request().url());
      urls.push(url.pathname + url.search);
      const genre = url.searchParams.get('genres');
      const body = genre ? (fx[genre] ?? LEEG) : url.searchParams.get('page') === '2' ? fx.p2 : fx.p1;
      return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    });
    shows = await scrapeReggehof({ page, theater, robots: { isAllowed: () => true }, waitForTurn: async () => {}, log: (m) => logs.push(m), warn: (m) => logs.push(`WARN ${m}`) });
  } finally {
    await browser.close();
  }
  assert.equal(urls.length, 2 + GENRE_FILTERS.length, urls.join('\n'));
  assert.equal(urls.some((u) => /itix/.test(u)), false, 'geen Itix (robots.txt verbiedt het)');
  assert.equal(shows.length, 34);
  const per = (titel) => shows.find((s) => s.titel === titel);
  const boh = shows.filter((s) => s.titel === 'Boh Foi Toch & Drock');
  assert.equal(boh.length, 1, 'zitten en staan: één voorstelling');
  assert.equal(boh[0].prijs, 25);
  assert.deepEqual(
    ['Grip – Rayen Panday', 'Renaissance 2.0 – Karin Bloemen', 'Nationaal Theaterweekend', 'Dikkie Dik & Dirk Scheele'].map((t) => {
      const s = per(t);
      return s && `${s.titel} | ${s.datum} ${s.tijd} | ${s.genre} | ${s.beschikbaarheid} | ${s.prijs}`;
    }),
    [
      'Grip – Rayen Panday | 2026-11-14 20:00 | Cabaret | beschikbaar | 22.5',
      'Renaissance 2.0 – Karin Bloemen | 2027-01-15 20:00 | Cabaret | beschikbaar | 35',
      'Nationaal Theaterweekend | 2027-01-29 20:00 | Cabaret | beschikbaar | 10',
      'Dikkie Dik & Dirk Scheele | 2027-02-14 15:00 | Familie & Jeugd | beschikbaar | 16',
    ]
  );
  assert.equal(per('KNA').beschikbaarheid, 'onbekend', 'geen_webverkoop');
  assert.match(per('Grip – Rayen Panday').reserverenUrl, /^https:\/\/www\.reggehof\.nl\/bestel\/\d+$/);
  assert.ok(shows.every((s) => s.podiumpas === true));
  assert.equal(shows.some((s) => /sportgala|kunst van leven/i.test(s.titel)), false);
  assert.ok(logs.some((l) => /zitten\/staan samengevoegd \(4\)/.test(l)), logs.join('\n'));
  assert.equal(logs.some((l) => /WARN/.test(l)), false, logs.join('\n'));
});
