// Het Cenakel (Tilburg): De Link en S.M.E.T. uit één agenda
// (test/fixtures/cenakel-agenda.html, 6 okt 2026), in Chromium, zonder netwerk.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

import { scrapeAllCenakel, scrapeCenakelGroep, theaterIdVoorReeks, parseCenakelDatum } from '../src/sites/cenakel.js';
import { THEATERS } from '../src/lib/config.js';

const fixture = readFileSync(new URL('./fixtures/cenakel-agenda.html', import.meta.url), 'utf-8');
const theater = THEATERS.find((t) => t.id === 'delink');

async function metPagina(fn) {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    let verzoeken = 0;
    await page.route('**/*', (r) => {
      verzoeken++;
      return r.fulfill({ status: 200, contentType: 'text/html', body: fixture });
    });
    const uit = await fn(page);
    return { ...uit, verzoeken };
  } finally {
    await browser.close();
  }
}
const ctx = (page, extra = {}) => ({ page, theater, robots: { isAllowed: () => true }, waitForTurn: async () => {}, log: () => {}, warn: () => {}, ...extra });

test('reeks → theater; datum', () => {
  assert.equal(theaterIdVoorReeks('De Link'), 'delink');
  assert.equal(theaterIdVoorReeks('S.M.E.T. Kamermuziek'), 'smet');
  assert.equal(theaterIdVoorReeks('S.M.E.T. Kamermuziek jong talent'), 'smet');
  assert.equal(theaterIdVoorReeks('Betoverende Pianisten'), null);
  assert.equal(theaterIdVoorReeks('Bachcantates'), null);
  assert.equal(parseCenakelDatum('11 oktober 2026'), '2026-10-11');
  assert.equal(parseCenakelDatum('10 januari 2027'), '2027-01-10');
});

test('Het Cenakel: alleen De Link en S.M.E.T., titel = uitvoerenden, locatie, Podiumpas', async () => {
  const waarschuwingen = [];
  const { shows } = await metPagina(async (page) => ({ shows: await scrapeAllCenakel(ctx(page, { warn: (m) => waarschuwingen.push(m) })) }));
  assert.deepEqual(waarschuwingen, []);
  const link = shows.filter((s) => s.theaterId === 'delink');
  const smet = shows.filter((s) => s.theaterId === 'smet');
  assert.equal(link.length, 7);
  assert.equal(smet.length, 7);
  assert.equal(shows.length, 14, 'andere reeksen weg');
  const skazka = smet.find((s) => s.titel === 'Skazka Quartet');
  assert.equal(skazka.datum, '2026-10-11');
  assert.equal(skazka.tijd, '12:30');
  assert.equal(skazka.theaterNaam, 'S.M.E.T.');
  assert.equal(skazka.locatie, 'Het Cenakel | Tilburg');
  assert.equal(skazka.podiumpas, true);
  assert.equal(skazka.genre, 'Muziek & Concert');
  assert.equal(skazka.beschikbaarheid, 'onbekend');
  assert.match(skazka.reserverenUrl, /^https:\/\/www\.cenakel\.nl\/agenda\/544-/);
  assert.ok(link.some((s) => s.titel === 'Spaceship Ensemble' && s.theaterNaam === 'De Link'));
  // Geen dubbele speeldata.
  assert.equal(new Set(shows.map((s) => s.id)).size, shows.length);
});

test('groep: één scrape voor De Link en S.M.E.T., elk zijn eigen concerten', async () => {
  const { link, smet, verzoeken } = await metPagina(async (page) => {
    const smetTheater = THEATERS.find((t) => t.id === 'smet');
    const [link, smet] = await Promise.all([scrapeCenakelGroep(ctx(page)), scrapeCenakelGroep(ctx(page, { theater: smetTheater }))]);
    return { link, smet };
  });
  assert.equal(verzoeken, 1);
  assert.ok(link.every((s) => s.theaterId === 'delink'));
  assert.ok(smet.every((s) => s.theaterId === 'smet'));
  assert.equal(link.length + smet.length, 14);
});
