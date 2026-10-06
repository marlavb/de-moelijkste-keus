// Markant Theater Maashorst (Uden): de echte scraper op pagina 1 van de
// agenda (test/fixtures/markant-agenda.html, 6 okt 2026), in Chromium,
// zonder netwerk.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

import { scrapeMarkant, laagstePrijs } from '../src/sites/markant.js';
import { THEATERS } from '../src/lib/config.js';

const fixture = readFileSync(new URL('./fixtures/markant-agenda.html', import.meta.url), 'utf-8');
const theater = THEATERS.find((t) => t.id === 'markant');

async function draai(body = fixture) {
  const browser = await chromium.launch();
  const urls = [];
  const waarschuwingen = [];
  try {
    const page = await browser.newPage();
    await page.route('**/*', (r) => {
      urls.push(r.request().url());
      return r.fulfill({ status: 200, contentType: 'text/html', body });
    });
    const shows = await scrapeMarkant({ page, theater, robots: { isAllowed: () => true }, waitForTurn: async () => {}, log: () => {}, warn: (m) => waarschuwingen.push(m) });
    return { shows, urls, waarschuwingen };
  } finally {
    await browser.close();
  }
}

test('prijs uit de kaarttekst', () => {
  assert.equal(laagstePrijs('beschikbaar Normaal € 49,50 Deze prijs is inclusief ticketkosten (2 Euro per ticket) € 49,50'), 49.5);
  assert.equal(laagstePrijs('€ 35,50'), 35.5);
  assert.equal(laagstePrijs('Rang 1 € 52,- Rang 2 € 45,-'), 45);
  assert.equal(laagstePrijs(null), null);
});

test('Markant: speeldata uit de kaarten, titels, status, Podiumpas, weglaten', async () => {
  const { shows, urls, waarschuwingen } = await draai();
  assert.deepEqual(waarschuwingen, []);
  assert.equal(urls.length, 2, 'pagina 1 en 2 (pagina 2 heeft niets nieuws)');
  assert.match(urls[1], /\/nl\/agenda\?p54_page=2$/);

  const van = (t) => shows.filter((s) => s.titel === t);
  // Cabaret omgedraaid.
  const sara = van('Prikkelarme Kermis (reprise) – Sara Kroos')[0];
  assert.ok(sara, shows.map((s) => s.titel).join(' | '));
  assert.equal(sara.datum, '2026-10-09');
  assert.equal(sara.tijd, '20:15');
  assert.equal(sara.zaal, 'Theaterzaal');
  assert.equal(sara.prijs, 30);
  assert.equal(sara.podiumpas, true);
  assert.equal(sara.genre, 'Cabaret');
  assert.equal(sara.maker, null);

  // Reeks: 9 losse speeldata, allemaal wachtlijst.
  const christel = van('Kende da!? (reprise) – Christel de Laat');
  assert.equal(christel.length, 9);
  assert.ok(christel.every((s) => s.beschikbaarheid === 'wachtlijst'));

  // Wervende ondertitel wordt geen maker.
  const piaf = van('Piaf Musical (reprise)')[0];
  assert.equal(piaf.maker, null);
  assert.equal(piaf.prijs, 49.5);
  assert.equal(piaf.podiumpas, true);

  // Externe verkoop = verkoop door derden: geen Podiumpas.
  const sta = shows.find((s) => s.titel === 'Nu Sta Je Hier');
  assert.equal(sta.podiumpas, false);
  assert.equal(sta.genre, 'Muziek & Concert');

  // Taxatiedag (geen genre, alleen "Meer info") is geen voorstelling.
  assert.equal(shows.some((s) => /taxatie/i.test(s.titel)), false);
  assert.equal(new Set(shows.map((s) => s.id)).size, shows.length, 'geen dubbele speeldata');
});

test('Markant: een BunnyCDN-wachtrijpagina geeft een fout, geen lege lijst', async () => {
  const wachtrij = '<html><head><title>Markant Theater Maashorst</title></head><body>Je staat in de wachtrij &hellip; Je staat op positie 1 van 1 in de wachtrij.</body></html>';
  await assert.rejects(() => draai(wachtrij), /geen agendakaarten/);
});
