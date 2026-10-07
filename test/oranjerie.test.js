// Theater De Oranjerie (Roermond): de echte scraper op een ingekorte agenda
// en de productiepagina van Titanique (test/fixtures/oranjerie-*.html, 6 okt
// 2026), in Chromium, zonder netwerk.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

import { scrapeOranjerie, oranjerieStatus } from '../src/sites/oranjerie.js';
import { THEATERS } from '../src/lib/config.js';

const agenda = readFileSync(new URL('./fixtures/oranjerie-agenda.html', import.meta.url), 'utf-8');
const titanique = readFileSync(new URL('./fixtures/oranjerie-titanique.html', import.meta.url), 'utf-8');
const theater = THEATERS.find((t) => t.id === 'oranjerie');

test('De Oranjerie: kaarten, "Meer data" via de productiepagina, extern niet', async () => {
  const browser = await chromium.launch();
  const urls = [];
  const waarschuwingen = [];
  let shows;
  try {
    const page = await browser.newPage();
    await page.route('**/*', (r) => {
      const url = r.request().url();
      urls.push(url);
      return r.fulfill({ status: 200, contentType: 'text/html', body: /\/agenda\/titanique$/.test(url) ? titanique : agenda });
    });
    shows = await scrapeOranjerie({ page, theater, robots: { isAllowed: () => true }, waitForTurn: async () => {}, log: () => {}, warn: (m) => waarschuwingen.push(m) });
  } finally {
    await browser.close();
  }
  assert.deepEqual(waarschuwingen, []);
  // De Kleine Zeemeermin (verhuring, "+ Meer data") linkt naar ticketshop.nl: niet bezocht.
  assert.deepEqual(urls, ['https://www.theaterroermond.nl/agenda', 'https://www.theaterroermond.nl/agenda/titanique']);
  const kor = shows.find((s) => /Kor Hoebe/.test(s.titel));
  assert.equal(kor.titel, 'KORDAAT – Kor Hoebe');
  assert.equal(kor.beschikbaarheid, 'wachtlijst');
  assert.equal(kor.tijd, '20:00');
  assert.equal(kor.podiumpas, false);
  const tenors = shows.find((s) => s.titel === 'The Dutch Tenors');
  assert.equal(tenors.beschrijving, 'Rise Up');
  assert.equal(tenors.beschikbaarheid, 'beschikbaar');
  assert.equal(shows.find((s) => /Scratch Orchestra/.test(s.titel)).beschikbaarheid, 'afgelast');
  const tit = shows.filter((s) => s.titel === 'Titanique');
  assert.deepEqual(tit.map((s) => s.datum.slice(5)), ['11-27', '11-28']);
  assert.equal(tit[0].genre, 'Musical');
  assert.equal(shows.find((s) => s.titel === 'Boeing Boeing').prijs, 37.5);
  // Het item van oktober volgend jaar.
  assert.equal(shows.find((s) => s.titel === 'Al het blauw van de hemel').datum, '2027-10-02');
});

test('De Oranjerie: status', () => {
  assert.equal(oranjerieStatus('Laatste kaarten', 'btn-laatste-kaarten'), 'beschikbaar');
  assert.equal(oranjerieStatus('Geannuleerd', 'btn-geannuleerd'), 'afgelast');
  assert.equal(oranjerieStatus('', 'btn-'), 'onbekend');
});

test('De Oranjerie: besloten verhuring (geen kaartlink, geen prijs) weg; openbare verhuring blijft; Komedie → Toneel', async () => {
  const { normalizeGenreVoor } = await import('../src/lib/genre.js');
  assert.equal(normalizeGenreVoor('oranjerie', 'Komedie'), 'Toneel');
  assert.equal(normalizeGenreVoor('munttheater', 'komedie'), 'Toneel');
  assert.equal(normalizeGenreVoor('kattendans', 'Komedie'), 'Cabaret');
  assert.equal(normalizeGenreVoor('oranjerie', 'Theaterconcert'), 'Muziektheater');
  // Stand-up blijft Cabaret (besluit 7 okt 2026).
  assert.equal(normalizeGenreVoor('munttheater', 'Komedie', 'A Comedy Double with Dave and Hermes Furry Fury!'), 'Cabaret');
  assert.equal(normalizeGenreVoor('oranjerie', 'Komedie', 'Stand-up avond'), 'Cabaret');
  assert.equal(normalizeGenreVoor('oranjerie', 'Komedie', 'Een avond met een comedian'), 'Cabaret');
  assert.equal(normalizeGenreVoor('oranjerie', 'Komedie', 'Boeing Boeing'), 'Toneel');

  // Een kopie van de Zeemeermin-kaart (verhuring) zonder link en prijs: besloten.
  const begin = agenda.indexOf('event-type-verhuring');
  const kaartStart = agenda.lastIndexOf('<div', agenda.lastIndexOf('event-col', begin));
  const kaartEind = agenda.indexOf('event-col', begin);
  const kaart = agenda.slice(kaartStart, kaartEind === -1 ? undefined : agenda.lastIndexOf('<div', kaartEind));
  const besloten = kaart
    .replace(/<a href="https:\/\/ticketshop[^"]*" class="event-image"[^>]*>/g, '<a class="event-image">')
    .replace(/<(span|strong)>€ 20,-<\/\1>/g, '')
    .replace(/De Kleine Zeemeermin de Musical/gi, 'Besloten personeelsfeest');
  assert.notEqual(besloten, kaart);
  const metBesloten = agenda.slice(0, kaartStart) + besloten + agenda.slice(kaartStart);
  const browser = await chromium.launch();
  const logs = [];
  let shows;
  try {
    const page = await browser.newPage();
    await page.route('**/*', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: /\/agenda\/titanique$/.test(r.request().url()) ? titanique : metBesloten }));
    shows = await scrapeOranjerie({ page, theater, robots: { isAllowed: () => true }, waitForTurn: async () => {}, log: (m) => logs.push(m), warn: () => {} });
  } finally {
    await browser.close();
  }
  assert.equal(shows.some((s) => /personeelsfeest/i.test(s.titel)), false);
  assert.ok(logs.some((l) => /weggelaten: besloten verhuur \(1\)/.test(l)), logs.join('\n'));
  const zeemeermin = shows.find((s) => /Zeemeermin/.test(s.titel));
  assert.equal(zeemeermin.genre, 'Overig');
  assert.match(zeemeermin.reserverenUrl, /ticketshop\.nl/);
});
