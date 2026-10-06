// Paradox (Tilburg): de echte scraper op een uitsnede van de agenda
// (test/fixtures/paradox-agenda.html, 6 okt 2026) en een nagebootst antwoord
// op "Laad meer" (paradox-laadmeer.json), in Chromium, zonder netwerk.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

import { scrapeParadox, parseParadoxDatum } from '../src/sites/paradox.js';

const agenda = readFileSync(new URL('./fixtures/paradox-agenda.html', import.meta.url), 'utf-8');
const laadMeer = readFileSync(new URL('./fixtures/paradox-laadmeer.json', import.meta.url), 'utf-8');
const theater = { id: 'paradox', naam: 'Paradox', stad: 'Tilburg', podiumpas: true, baseUrl: 'https://www.paradoxtilburg.nl', agendaUrl: 'https://www.paradoxtilburg.nl/agenda/' };

async function draai({ ajax = (r, n) => r.fulfill({ status: 200, contentType: 'application/json', body: n === 1 ? laadMeer : '{"status":999}' }) } = {}) {
  const browser = await chromium.launch();
  const posts = [];
  const waarschuwingen = [];
  let beurten = 0;
  try {
    const page = await browser.newPage();
    await page.route('**/*', (r) => {
      if (r.request().url().includes('admin-ajax.php')) {
        posts.push(Object.fromEntries(new URLSearchParams(r.request().postData() ?? '')));
        return ajax(r, posts.length);
      }
      return r.fulfill({ status: 200, contentType: 'text/html', body: agenda });
    });
    const shows = await scrapeParadox({ page, theater, robots: { isAllowed: () => true }, waitForTurn: async () => { beurten++; }, log: () => {}, warn: (m) => waarschuwingen.push(m) });
    return { shows, posts, waarschuwingen, beurten };
  } finally {
    await browser.close();
  }
}

test('cursus, workshop en masterclass zijn geen concert; de jazzsessie wel', async () => {
  const { GEEN_CONCERT_TITEL } = await import('../src/sites/paradox.js');
  for (const t of ['Cursus The Story of jazz', 'Workshop improvisatie', 'Masterclass zang', 'Science Café']) assert.ok(GEEN_CONCERT_TITEL.test(t), t);
  for (const t of ['Jazzsessie', 'FAA recital', 'Paravocaal']) assert.equal(GEEN_CONCERT_TITEL.test(t), false, t);
});

test('datum met jaartal', () => {
  assert.equal(parseParadoxDatum('zo 11 okt 2026'), '2026-10-11');
  assert.equal(parseParadoxDatum('di 6 jan 2027'), '2027-01-06');
  assert.equal(parseParadoxDatum('morgen'), null);
});

test('Paradox: "Laad meer" zoals de knop, concerten, status, Podiumpas, weglaten', async () => {
  const { shows, posts, waarschuwingen, beurten } = await draai();
  assert.deepEqual(waarschuwingen, []);
  // Eén POST zoals de knop: action, show, nonce uit de pagina, offset = aantal getoonde.
  assert.equal(posts.length, 1);
  assert.equal(posts[0].action, 'programm_filter');
  assert.equal(posts[0].show, 'total');
  assert.match(posts[0].nonce, /^[0-9a-f]{10}$/);
  assert.equal(posts[0].offset, '5');
  assert.equal(beurten, 2, 'waitForTurn vóór de pagina en vóór de POST');

  const van = (t) => shows.filter((s) => s.titel === t);
  // 13 gelezen; Science Café (debat) en Eric Vloeimans (tickets via SCT) weg.
  assert.equal(shows.length, 11, shows.map((s) => s.titel).join(' | '));
  assert.equal(van('Science Café').length, 0);
  assert.equal(shows.some((s) => /Vloeimans/.test(s.titel)), false);

  const susanne = van('Susanne Alt & Dark Horse')[0];
  assert.equal(susanne.datum, '2026-10-09');
  assert.equal(susanne.tijd, '20:30');
  assert.equal(susanne.prijs, 18);
  assert.equal(susanne.podiumpas, true);
  assert.equal(susanne.genre, 'Muziek & Concert');
  assert.equal(susanne.beschikbaarheid, 'beschikbaar');

  // Jazzsessies: mee, gratis toegang → geen Podiumpas, kleine regel als beschrijving.
  const sessies = van('Jazzsessie');
  assert.equal(sessies.length, 2);
  assert.equal(sessies[0].podiumpas, false);
  assert.equal(sessies[0].prijs, 0);
  assert.match(sessies[0].beschrijving, /Tijn Trommelen/);
  assert.equal(sessies[0].maker, null);

  // Uitverkocht uit span.soldout; middagconcert met de aanvang (niet de UTC-tijd uit content).
  const cesar = van('Cesar: Het verhaal van een Drummer')[0];
  assert.equal(cesar.beschikbaarheid, 'uitverkocht');
  assert.equal(cesar.tijd, '15:00');
  assert.equal(cesar.beschrijving, 'Live in het theater');
});

test('Paradox: "Laad meer" faalt → waarschuwing, de eerste concerten blijven', async () => {
  const { shows, waarschuwingen } = await draai({ ajax: (r) => r.fulfill({ status: 403, body: 'nee' }) });
  assert.equal(shows.length, 5);
  assert.match(waarschuwingen.join('\n'), /HTTP 403/);
});
