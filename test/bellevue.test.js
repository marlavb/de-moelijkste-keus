// Theater Bellevue: de echte scraper op een ingekorte agendapagina
// (test/fixtures/bellevue-agenda.html), in Chromium, zonder netwerk. Sinds
// okt 2026 alleen de agendapagina's: speeldata uit het paneel show{ID}Dates
// of van de kaart zelf, geen detailpagina's.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

import { scrapeBellevue } from '../src/sites/bellevue.js';
import { THEATERS } from '../src/lib/config.js';

const agenda = readFileSync(new URL('./fixtures/bellevue-agenda.html', import.meta.url), 'utf-8');
const theater = THEATERS.find((t) => t.id === 'bellevue');

async function scrape(html = agenda) {
  const browser = await chromium.launch();
  const urls = [];
  const logs = [];
  try {
    const page = await browser.newPage();
    await page.route('**/*', (r) => {
      urls.push(r.request().url());
      return r.fulfill({ status: 200, contentType: 'text/html', body: html });
    });
    const shows = await scrapeBellevue({ page, theater, robots: { isAllowed: () => true }, waitForTurn: async () => {}, log: (m) => logs.push(m), warn: (m) => logs.push(`WARN ${m}`) });
    return { shows, urls, logs };
  } finally {
    await browser.close();
  }
}

test('Bellevue: speeldata van de agendapagina, zonder detailpagina\'s; tournee, overzichtsrij, besloten en niet verkoopbaar eruit', async () => {
  const { shows, urls, logs } = await scrape();
  // Alleen agendapagina's (pagina 1 en de tweede die niets nieuws geeft), geen /agenda/<slug>.
  assert.ok(urls.every((u) => !/\/agenda\/[a-z]/.test(u)), urls.join('\n'));
  const teckel = shows.filter((s) => /Teckel/.test(s.titel));
  assert.deepEqual(teckel.map((s) => `${s.datum.slice(5)} ${s.tijd} ${s.beschikbaarheid}`), ['04-02 20:30 beschikbaar', '04-03 20:30 wachtlijst']);
  assert.equal(teckel[0].maker, 'Nina van Tongeren / Bellevue Producties');
  // JS-bestelknop → detailpagina als reserveerlink; een echte link blijft.
  assert.equal(teckel[0].reserverenUrl, 'https://www.theaterbellevue.nl/agenda/teckel-ab12');
  assert.equal(teckel[1].reserverenUrl, 'https://www.theaterbellevue.nl/pQ5QeSw/wachtlijst');
  // Losse kaart met één speeldatum.
  const vvv = shows.find((s) => /Volk en Vaderland/.test(s.titel));
  assert.equal(vvv.datum.slice(5), '03-31');
  assert.equal(vvv.tijd, '20:30');
  assert.equal(vvv.beschikbaarheid, 'beschikbaar');
  // Niet verkoopbaar en besloten weg; geannuleerd → afgelast.
  assert.equal(shows.some((s) => /Schrijversstudio/.test(s.titel)), false);
  const zouthuis = shows.filter((s) => /Zouthuis/.test(s.titel));
  assert.deepEqual(zouthuis.map((s) => s.beschikbaarheid), ['afgelast']);
  assert.ok(logs.some((l) => /1 speeldatum\(s\) op tournee en 2 besloten of niet verkoopbare/.test(l)), logs.join('\n'));
});

test('Bellevue: zonder paneel en zonder datum op de kaarten → fout (vangnet), niet stil leeg', async () => {
  const kaal = agenda.replace(/<div id="show\d+Dates"[\s\S]*?<\/ul><\/div>/g, '').replace(/<div class="dateTimeContainer">[\s\S]*?<\/div><\/div>/g, '');
  await assert.rejects(scrape(kaal), /geen enkele speeldatum/);
});
