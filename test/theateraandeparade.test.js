// Theater aan de Parade ('s-Hertogenbosch): de echte scraper op de Nuxt-state
// van pagina 1 en 2 (fixtures van 6 okt 2026), in Chromium, zonder netwerk;
// en de ontdubbeling met Willem Twee (zelfde concert op beide agenda's).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

import { scrapeTheaterAanDeParade, normaalPrijs } from '../src/sites/theateraandeparade.js';
import { scrapeWillemTwee } from '../src/sites/willemtwee.js';
import { ontdubbelTussenTheaters } from '../src/lib/dedupe.js';
import { THEATERS } from '../src/lib/config.js';

const fixture = (naam) => readFileSync(new URL(`./fixtures/${naam}`, import.meta.url), 'utf-8');
const p1 = fixture('theateraandeparade-p1.html');
const p2 = fixture('theateraandeparade-p2.html');
const theater = THEATERS.find((t) => t.id === 'theateraandeparade');

async function draaiParade() {
  const browser = await chromium.launch();
  const urls = [];
  const waarschuwingen = [];
  try {
    const page = await browser.newPage();
    await page.route('**/*', (r) => {
      const url = r.request().url();
      urls.push(url);
      return r.fulfill({ status: 200, contentType: 'text/html', body: /page=\d/.test(url) ? p2 : p1 });
    });
    const shows = await scrapeTheaterAanDeParade({ page, theater, robots: { isAllowed: () => true }, waitForTurn: async () => {}, log: () => {}, warn: (m) => waarschuwingen.push(m) });
    return { shows, urls, waarschuwingen };
  } finally {
    await browser.close();
  }
}

test('prijs: laagste Normaal-prijs, anders de prijs van het programma', () => {
  assert.equal(normaalPrijs({ prijzen: [{ prijs: 0, type: 'Podiumpas - Podiumpasbezoekers' }, { prijs: 34, type: 'Normaal' }, { prijs: 24, type: 'Normaal' }, { prijs: 24, type: 'Normaal - VRIEND (doorlopend)' }], prijs: null }), 24);
  assert.equal(normaalPrijs({ prijzen: [], prijs: 29.5 }), 29.5);
  assert.equal(normaalPrijs({ prijzen: [], prijs: null }), null);
});

test('Parade: Podiumpas uit het prijstype, status, titels, weglaten (Willem Twee, masterclasses, vrienden)', async () => {
  const { shows, urls, waarschuwingen } = await draaiParade();
  assert.deepEqual(waarschuwingen, []);
  assert.equal(urls.length, 3, 'pagina 1, 2 en 3 (3 = niets nieuws)');
  assert.match(urls[1], /\/nl\/programma\?page=2$/);

  const van = (t) => shows.find((s) => s.titel === t);
  const rene = van('Noodzakelijk kwaad – René van Meurs');
  assert.ok(rene, shows.map((s) => s.titel).join(' | '));
  assert.equal(rene.datum, '2026-10-07');
  assert.equal(rene.tijd, '20:00');
  assert.equal(rene.zaal, 'Casinozaal');
  assert.equal(rene.podiumpas, true);
  assert.equal(rene.prijs, 24);
  assert.equal(rene.genre, 'Cabaret');
  assert.match(rene.reserverenUrl, /^https:\/\/tix\.theateraandeparade\.nl\//);

  // Gastproductie zonder prijstype Podiumpas.
  const spitters = van('Spitters, Emma van het Verzet');
  assert.equal(spitters.podiumpas, false);
  const misdaad = van('Misdaadpodcast Live');
  assert.equal(misdaad.podiumpas, true);
  assert.equal(misdaad.maker, 'Paul Vugts, Wouter Laumans en Corrie Gerritsma');

  // Uitverkocht uit de knop.
  assert.equal(van('Yogaconcert').beschikbaarheid, 'uitverkocht');

  // Weggelaten: concerten van Willem Twee, IVC-masterclasses, vriendenactiviteit, Theaterlab.
  assert.equal(shows.some((s) => /Vicky Chow|Dutch Classical Talent/.test(s.titel)), false);
  assert.equal(shows.some((s) => /masterclass/i.test(`${s.titel} ${s.maker ?? ''} ${s.beschrijving ?? ''}`)), false);
  assert.equal(shows.some((s) => /Achter de schermen|Theaterlab/i.test(s.titel)), false);
  assert.equal(new Set(shows.map((s) => s.id)).size, shows.length);
});

test('Parade ↔ Willem Twee: geen speeldatum bij beide; het vangnet houdt een concert van Willem Twee bij Willem Twee', async () => {
  const { shows: parade } = await draaiParade();
  const browser = await chromium.launch();
  let w2;
  try {
    const page = await browser.newPage();
    const body = fixture('willemtwee-toonzaal.html');
    await page.route('**/*', (r) => r.fulfill({ status: 200, contentType: 'text/html', body }));
    w2 = await scrapeWillemTwee({ page, theater: THEATERS.find((t) => t.id === 'willemtwee'), robots: { isAllowed: () => true }, waitForTurn: async () => {}, log: () => {}, warn: () => {} });
  } finally {
    await browser.close();
  }
  // Beide agenda's noemen Vicky Chow (8 okt 20:30); Parade laat hem weg (locatie Willem Twee).
  assert.ok(w2.some((s) => s.titel === 'Vicky Chow & Mivos Quartet'));
  assert.equal(parade.some((s) => /Vicky Chow/.test(s.titel)), false);
  // Echte uitvoer van beide: geen enkele speeldatum dubbel.
  const sleutel = (s) => `${s.datum}|${s.tijd}|${s.titel.toLowerCase()}`;
  const w2Sleutels = new Set(w2.map(sleutel));
  assert.deepEqual(parade.filter((s) => w2Sleutels.has(sleutel(s))).map((s) => s.titel), []);
  assert.deepEqual(ontdubbelTussenTheaters([...w2, ...parade]).verwijderd, []);
  // Vangnet: zou Parade de locatie ooit weglaten, dan blijft het concert alleen bij Willem Twee.
  const vicky = w2.find((s) => s.titel === 'Vicky Chow & Mivos Quartet');
  const alsBijParade = { ...vicky, theaterId: 'theateraandeparade', zaal: 'Pleinzaal', id: 'theateraandeparade-x' };
  const { shows, verwijderd } = ontdubbelTussenTheaters([...w2, ...parade, alsBijParade]);
  assert.deepEqual(verwijderd.map((v) => `${v.theaterId}<${v.voorrang}:${v.titel}`), ['theateraandeparade<willemtwee:Vicky Chow & Mivos Quartet']);
  assert.equal(shows.filter((s) => s.titel === 'Vicky Chow & Mivos Quartet').length, 1);
});
