// Kattendans (Bergeijk): de echte scraper op een uitsnede van de
// programmapagina (test/fixtures/kattendans-programma.html, 6 okt 2026), in
// Chromium, zonder netwerk. Zelfde plugin als DOK6 (lib/wpTheatre.js).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

import { scrapeKattendans } from '../src/sites/kattendans.js';

const fixture = readFileSync(new URL('./fixtures/kattendans-programma.html', import.meta.url), 'utf-8');
const theater = { id: 'kattendans', naam: 'Kattendans', stad: 'Bergeijk', podiumpas: true, baseUrl: 'https://kattendans.nl', agendaUrl: 'https://kattendans.nl/programma/' };

test('Kattendans: titels, datums, status, Podiumpas (prijsgrens, film, Uit de regio, gratis)', async () => {
  const browser = await chromium.launch();
  let shows;
  const waarschuwingen = [];
  try {
    const page = await browser.newPage();
    await page.route('**/*', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: fixture }));
    shows = await scrapeKattendans({ page, theater, robots: { isAllowed: () => true }, waitForTurn: async () => {}, log: () => {}, warn: (m) => waarschuwingen.push(m) });
  } finally {
    await browser.close();
  }
  const van = (t) => shows.find((s) => s.titel === t);
  assert.deepEqual(waarschuwingen, []);
  assert.equal(shows.length, 11);

  // Cabaret omgedraaid ("Voorstelling – Maker"), wachtlijst uit de knop.
  const rundfunk = van('Wagyu – Rundfunk');
  assert.ok(rundfunk, shows.map((s) => s.titel).join(' | '));
  assert.equal(rundfunk.beschikbaarheid, 'wachtlijst');
  assert.equal(rundfunk.podiumpas, true);
  assert.equal(rundfunk.genre, 'Cabaret');
  assert.match(rundfunk.datum, /^20\d\d-\d\d-\d\d$/);
  assert.match(rundfunk.tijd, /^\d\d:\d\d$/);
  assert.match(rundfunk.reserverenUrl, /apps\.ticketmatic\.com\/widgets\/kattendans/);
  assert.equal(van("Wina's Wereld – Wina Ricardo").beschikbaarheid, 'beschikbaar');

  // "door Oortwolk" → maker Oortwolk; jeugd; is_free (kinderen gratis) telt niet.
  const boink = van('BOINK! ◆ 4+');
  assert.equal(boink.maker, 'Oortwolk');
  assert.equal(boink.genre, 'Familie & Jeugd');
  assert.equal(boink.podiumpas, true);

  // Film en Uit de regio: in de data, zonder Podiumpas.
  assert.equal(van("L'Attachement").podiumpas, false);
  assert.equal(van("L'Attachement").genre, 'Overig');
  const regio = shows.find((s) => /Abele Spel/.test(s.titel));
  assert.equal(regio.podiumpas, false);

  // € 0 (geen kaartverkoop): geen Podiumpas, niet omgedraaid.
  const harmonie = shows.find((s) => /Riethovens/.test(s.titel));
  assert.equal(harmonie.podiumpas, false);
  assert.equal(harmonie.prijs, 0);

  // Boven € 50: geen Podiumpas.
  assert.equal(van('Running in the Family II – Testvoorstelling Duur').podiumpas, false);
  assert.equal(van('Running in the Family II – Testvoorstelling Duur').prijs, 52.5);

  // Uitverkocht zonder knop (alleen een statusregel).
  assert.equal(shows.find((s) => /Tobi Kooiman/.test(s.titel)).beschikbaarheid, 'uitverkocht');

  // Titelvolgorde (vast per genre, zie VOLGORDE_PER_GENRE in kattendans.js):
  // Muziek Maker / Titel; Jeugdtheater "door X" → maker; Film → reeks in de beschrijving;
  // een content warning wordt nooit maker.
  const tangarine = van('Running in the Family II – Tangarine');
  assert.ok(tangarine, shows.map((s) => s.titel).join(' | '));
  assert.equal(tangarine.maker, null);
  assert.equal(van('BOINK! ◆ 4+').maker, 'Oortwolk');
  assert.equal(van("L'Attachement").maker, null);
  assert.equal(van("L'Attachement").beschrijving, 'Dinsdagmiddagfilm');
  const speels = van('Speels Collectief');
  assert.equal(speels.maker, null);
  assert.equal(speels.beschrijving, 'CONTENT WARNING: weinig prikkels');
  assert.ok(shows.some((s) => /^De Vloek Van Toetang En Zijn Amon – Toneelvereniging/.test(s.titel)), 'Uit de regio: Maker / Titel');
});
