// Theater aan het Vrijthof en AINSI: de echte scraper op de pagina en een
// ingekorte Algolia-respons (test/fixtures/vrijthof-*.{html,json}, 6 okt
// 2026), in Chromium, zonder netwerk.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

import { scrapeAllVrijthof, voorstellingEnMaker, plaatsVoorHit, unixNaarAmsterdam, leesAlgoliaConfig } from '../src/sites/vrijthof.js';
import { THEATERS } from '../src/lib/config.js';

const pagina = readFileSync(new URL('./fixtures/vrijthof-voorstellingen.html', import.meta.url), 'utf-8');
const algolia = readFileSync(new URL('./fixtures/vrijthof-algolia.json', import.meta.url), 'utf-8');
const theater = THEATERS.find((t) => t.id === 'vrijthof');

async function scrape() {
  const browser = await chromium.launch();
  const urls = [];
  const waarschuwingen = [];
  try {
    const page = await browser.newPage();
    await page.route('**/*', (r) => {
      const url = r.request().url();
      urls.push(url);
      if (url.includes('algolia.net')) return r.fulfill({ status: 200, contentType: 'application/json', body: algolia });
      return r.fulfill({ status: 200, contentType: 'text/html', body: pagina });
    });
    const shows = await scrapeAllVrijthof({ page, theater, robots: { isAllowed: () => true }, waitForTurn: async () => {}, log: () => {}, warn: (m) => waarschuwingen.push(m) });
    return { shows, urls, waarschuwingen };
  } finally {
    await browser.close();
  }
}

test('Vrijthof: één pagina + één Algolia-query, AINSI apart, reizen en arrangementen weg', async () => {
  const { shows, urls, waarschuwingen } = await scrape();
  assert.deepEqual(waarschuwingen, []);
  assert.equal(urls.length, 2);
  assert.match(urls[1], /^https:\/\/b90ibx217z-dsn\.algolia\.net\/1\/indexes\/rootnet_event_pages_nl_NL\?/);
  const titels = shows.map((s) => s.titel);
  assert.ok(!titels.some((t) => /theaterreis|Terrasarrangement|EVITA/i.test(t)), titels.join(', '));
  const thuis = shows.find((s) => s.titel === 'Thuis');
  assert.equal(thuis.maker, 'Ahmed Aboutaleb');
  assert.equal(thuis.theaterId, 'ainsi');
  assert.equal(thuis.theaterNaam, 'AINSI');
  assert.equal(thuis.podiumpas, false);
  const titanique = shows.find((s) => s.titel === 'Titanique');
  assert.equal(titanique.theaterId, 'vrijthof');
  assert.equal(titanique.beschrijving, 'Niets komt tussen Jack & Rose... behalve Céline Dion!');
  assert.equal(shows.find((s) => s.titel === 'Nora').maker, 'Waldemar Torenstra, Judith Noyons e.a.');
  // Cabaret: "Voorstelling – Maker".
  assert.ok(titels.includes('We zien het wel even – Hokjesdenker'), titels.join(', '));
  // Externe locatie in Maastricht.
  assert.equal(shows.find((s) => s.titel === 'Weihnachtsoratorium').locatie, 'Sint Janskerk | Maastricht');
  assert.ok(shows.some((s) => s.beschikbaarheid === 'afgelast'));
  // Vervolgdatum (titel = datum) krijgt de echte titel uit company/name.
  assert.ok(!titels.some((t) => /^\d\d-\d\d-\d{4}/.test(t)), titels.join(', '));
});

test('Vrijthof: hulpfuncties', () => {
  assert.deepEqual(unixNaarAmsterdam(1791309600), { datum: '2026-10-06', tijd: '20:00' });
  assert.deepEqual(leesAlgoliaConfig(pagina), { app: 'B90IBX217Z', sleutel: '6797e823c469081bf74bc1b34a973f97', index: 'rootnet_event_pages_nl_NL' });
  assert.equal(plaatsVoorHit({ eventLocations: 'Overige locaties', eventLocationAddition: 'PLT Kerkrade' }), null);
  assert.equal(plaatsVoorHit({ eventLocations: 'Overige locaties', eventLocationAddition: 'Mondo Verde Landgraaf' }), null);
  assert.deepEqual(plaatsVoorHit({ eventLocations: 'AINSI: AINSI Foyer' }), { theaterId: 'ainsi', locatie: null });
  assert.deepEqual(plaatsVoorHit({ eventLocations: 'Overige locaties', eventLocationAddition: 'Theatercafé' }), { theaterId: 'vrijthof', locatie: null });
  assert.deepEqual(plaatsVoorHit({ eventLocations: 'Kumulus Theater' }), { theaterId: 'vrijthof', locatie: 'Kumulus Theater | Maastricht' });
  assert.deepEqual(voorstellingEnMaker({ company: 'Patrick Duijtshoff', name: 'Alle kinderen stinken', switchCompanyTitle: null }), { voorstelling: 'Alle kinderen stinken', maker: 'Patrick Duijtshoff', beschrijving: null });
  assert.deepEqual(voorstellingEnMaker({ company: '', name: 'Baby Reindeer', switchCompanyTitle: true }), { voorstelling: 'Baby Reindeer', maker: null, beschrijving: null });
});
