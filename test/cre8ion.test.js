// De drie sites van The Cre8ion.Lab (lib/cre8ion.js): Het Speelhuis,
// Schouwburg Concertzaal Tilburg en Toonzaal Willem Twee. De echte scrapers
// op pagina 1 van elke agenda (fixtures van 6 okt 2026), in Chromium, zonder
// netwerk. Pagina 2 krijgt dezelfde inhoud: dan stopt de paginering.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

import { scrapeSpeelhuis } from '../src/sites/speelhuis.js';
import { scrapeSchouwburgConcertzaal } from '../src/sites/schouwburgconcertzaal.js';
import { scrapeWillemTwee } from '../src/sites/willemtwee.js';
import { dataLayerDatum, datumMetJaar } from '../src/lib/cre8ion.js';
import { THEATERS } from '../src/lib/config.js';

async function draai(scraper, id, fixture) {
  const body = readFileSync(new URL(`./fixtures/${fixture}`, import.meta.url), 'utf-8');
  const browser = await chromium.launch();
  const urls = [];
  const waarschuwingen = [];
  try {
    const page = await browser.newPage();
    await page.route('**/*', (r) => {
      urls.push(r.request().url());
      return r.fulfill({ status: 200, contentType: 'text/html', body });
    });
    const shows = await scraper({ page, theater: THEATERS.find((t) => t.id === id), robots: { isAllowed: () => true }, waitForTurn: async () => {}, log: () => {}, warn: (m) => waarschuwingen.push(m) });
    return { shows, urls, waarschuwingen };
  } finally {
    await browser.close();
  }
}
const titels = (shows) => shows.map((s) => s.titel).join(' | ');

test('datums: dataLayer en zichtbare tekst met jaartal', () => {
  assert.equal(dataLayerDatum('15-10-2026'), '2026-10-15');
  assert.equal(dataLayerDatum('Meerdere datums'), null);
  assert.equal(datumMetJaar('do 08 okt 2026'), '2026-10-08');
  assert.equal(datumMetJaar('do 08 okt'), null);
});

test('Het Speelhuis: dataLayer-datum met jaar, zaal, status, titels, Podiumpas zonder prijsgrens', async () => {
  const { shows, urls, waarschuwingen } = await draai(scrapeSpeelhuis, 'speelhuis', 'speelhuis-programma.html');
  assert.deepEqual(waarschuwingen, []);
  assert.equal(urls.length, 2);
  assert.match(urls[1], /\/programma\?page=2$/);
  assert.equal(shows.length, 10);
  const marie = shows.find((s) => s.titel === 'Eindspel – Marie Koet');
  assert.ok(marie, titels(shows));
  assert.equal(marie.datum, '2026-10-15');
  assert.equal(marie.tijd, '20:15');
  assert.equal(marie.zaal, 'Pleinzaal');
  assert.equal(marie.beschikbaarheid, 'wachtlijst');
  assert.equal(marie.genre, 'Cabaret');
  // Voorwaarden onbekend (9 okt 2026): podiumpas null, ook bij € 48,50.
  const voorHaar = shows.find((s) => s.titel === 'Voor Haar');
  assert.equal(voorHaar.prijs, 48.5);
  assert.equal(voorHaar.podiumpas, null);
  assert.equal(voorHaar.maker, null, 'beschrijvende ondertitel is geen maker');
  // Titelvolgorde: Dans, College en Divers vast Maker / Titel → "Voorstelling – Maker".
  assert.ok(shows.some((s) => s.titel === 'Danslokaal 14 – Conny Janssen Danst'), titels(shows));
  assert.ok(shows.some((s) => s.titel === 'De toestand in de wereld volgens Harm Edens – Harm Edens'));
  assert.ok(shows.some((s) => s.titel === 'de BUS Whiskey Tour – Dennis Hurkmans'));
  // Jeugd wisselt: daar de oude aanpak (bronvolgorde).
  assert.ok(shows.some((s) => s.titel === 'Jeugdtheater Carrousel' && s.maker === 'Het Zakmes (4+)'));
  // Twee voorstellingen op één dag: twee speeldata.
  assert.equal(shows.filter((s) => /Carrousel/.test(s.titel)).length, 2);
  assert.equal(new Set(shows.map((s) => s.id)).size, shows.length);
});

test('Schouwburg Concertzaal: titel – maker, locaties, weglaten (De Nieuwe Vorst, Benee, workshops), gratis', async () => {
  const { shows, waarschuwingen } = await draai(scrapeSchouwburgConcertzaal, 'schouwburgconcertzaal', 'schouwburgconcertzaal-agenda.html');
  assert.deepEqual(waarschuwingen, []);
  const kordaat = shows.find((s) => s.titel === 'KORDAAT – Kor Hoebe');
  assert.ok(kordaat, titels(shows));
  assert.equal(kordaat.datum, '2026-10-06');
  assert.equal(kordaat.zaal, 'Schouwburg');
  assert.equal(kordaat.beschikbaarheid, 'wachtlijst');
  assert.equal(kordaat.genre, 'Cabaret');
  assert.equal(kordaat.podiumpas, null, 'voorwaarden onbekend');
  // Toneel: titel = voorstelling, maker = gezelschap.
  const kamer = shows.find((s) => s.titel === 'IK BEN KAMER 15');
  assert.equal(kamer.maker, 'Speels Collectief');
  // Fred van Leer speelt twee avonden: twee speeldata.
  assert.equal(shows.filter((s) => s.titel === 'Ik weet het eigenlijk niet').length, 2);
  // Weggelaten.
  assert.equal(shows.some((s) => /So You Think You Know Dance/.test(s.titel)), false, 'De Nieuwe Vorst komt van De Nieuwe Vorst');
  assert.equal(shows.some((s) => /pubquiz|diner/i.test(s.titel)), false);
  assert.equal(shows.some((s) => /masterclass|workshop|werksessie|professioneel programma/i.test(`${s.titel} ${s.maker ?? ''}`)), false, titels(shows));
  // Gratis toegang: geen Podiumpas; externe locatie in `locatie`.
  const making = shows.find((s) => s.titel === 'Making Space');
  assert.equal(making.podiumpas, false);
  assert.equal(making.locatie, 'Externe locatie');
  assert.equal(new Set(shows.map((s) => s.id)).size, shows.length);
});

test('Willem Twee: alleen de Toonzaal, Podiumpas volgens de tag, geen jaar in de datum', async () => {
  const { shows, waarschuwingen } = await draai(scrapeWillemTwee, 'willemtwee', 'willemtwee-toonzaal.html');
  assert.deepEqual(waarschuwingen, []);
  assert.equal(shows.length, 15, titels(shows));
  assert.ok(shows.every((s) => s.zaal === 'Toonzaal'));
  assert.equal(shows.some((s) => s.titel === 'Koffie bij de Piano'), false, 'in Theater aan de Parade');
  const callot = shows.find((s) => s.titel === 'Lunchconcert: Jacob Callot');
  assert.equal(callot.datum, '2026-10-28');
  assert.equal(callot.tijd, '12:30');
  assert.equal(callot.podiumpas, true);
  assert.equal(callot.prijs, 7.5);
  const boris = shows.find((s) => s.titel === 'Boris & the Joy');
  assert.equal(boris.podiumpas, false, 'geen tag Podiumpas');
  assert.equal(boris.prijs, 20);
  // "Gratis" is geen betrouwbare prijs.
  assert.equal(shows.find((s) => s.titel === 'Vicky Chow & Mivos Quartet').prijs, null);
  assert.equal(shows.find((s) => /Wibi Soerjadi ochtend/.test(s.titel)).beschikbaarheid, 'uitverkocht');
  assert.equal(shows.find((s) => /DJUMBALA/.test(s.titel)).genre, 'Familie & Jeugd');
  assert.ok(shows.every((s) => !/podiumpas/i.test(s.genreRuw ?? '')), 'de tag Podiumpas is geen genre');
});
