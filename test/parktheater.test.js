// Parktheater Eindhoven: gepauzeerd (BunnyCDN-wachtrij, 6 okt 2026); de
// scraper staat klaar. Getest op pagina 1 uit de verkenning
// (test/fixtures/parktheater-programma.html) en een nagemaakte
// productiepagina voor een reeks (parktheater-reeks.html), zonder netwerk.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

import { scrapeParktheater } from '../src/sites/parktheater.js';
import { THEATERS } from '../src/lib/config.js';

const lijst = readFileSync(new URL('./fixtures/parktheater-programma.html', import.meta.url), 'utf-8');
const reeks = readFileSync(new URL('./fixtures/parktheater-reeks.html', import.meta.url), 'utf-8');
const theater = THEATERS.find((t) => t.id === 'parktheater');

test('config: Parktheater is gepauzeerd (BunnyCDN-wachtrij), met reserveerinfo', () => {
  assert.deepEqual(theater.gepauzeerd, { sinds: '2026-10-06', reden: 'BunnyCDN-wachtrij (/csq/queue)' });
  assert.equal(theater.provincie, 'Noord-Brabant');
  assert.ok(theater.podiumpasReserveren.telefoon);
});

test('Parktheater: kaarten, reeks via de productiepagina, locatie, Podiumpas-regels', async () => {
  const browser = await chromium.launch();
  const urls = [];
  const waarschuwingen = [];
  let shows;
  try {
    const page = await browser.newPage();
    await page.route('**/*', (r) => {
      const url = r.request().url();
      urls.push(url);
      return r.fulfill({ status: 200, contentType: 'text/html', body: /\/programma(\?|$)/.test(url) ? lijst : reeks });
    });
    shows = await scrapeParktheater({ page, theater, robots: { isAllowed: () => true }, waitForTurn: async () => {}, log: () => {}, warn: (m) => waarschuwingen.push(m) });
  } finally {
    await browser.close();
  }
  assert.deepEqual(waarschuwingen, []);
  const van = (t) => shows.filter((s) => s.titel === t);

  // Cabaret op een externe locatie: "Voorstelling – Maker", geen Podiumpas.
  const kiki = van('Praktische bezwaren – Kiki Schippers')[0];
  assert.ok(kiki, shows.map((s) => s.titel).join(' | '));
  assert.equal(kiki.locatie, 'Natlab (Kastanjelaan 500)');
  assert.equal(kiki.podiumpas, false);
  assert.equal(kiki.prijs, 21.5);

  // In het Parktheater, onder € 50: Podiumpas; zaal; tijd uit data-event-start.
  const beatles = van('Best of The Beatles ’62 - ’65')[0];
  assert.equal(beatles.zaal, 'Hertog Jan Zaal');
  assert.equal(beatles.tijd, '20:00');
  assert.equal(beatles.podiumpas, true);
  assert.equal(beatles.maker, 'The Analogues present: The Young Analogues');

  // Pand P is eigen locatie; uitverkocht uit de knop.
  const fade = van('Fade out')[0];
  assert.equal(fade.locatie, undefined);
  assert.equal(fade.beschikbaarheid, 'uitverkocht');

  // Reeks ("Data & tijden"): speeldata van de productiepagina; boven € 50 geen Podiumpas.
  const titanique = van('Titanique');
  assert.equal(titanique.length, 3);
  assert.deepEqual(titanique.map((s) => `${s.datum} ${s.tijd} ${s.beschikbaarheid}`), ['2026-10-09 20:00 beschikbaar', '2026-10-10 14:30 uitverkocht', '2026-10-10 20:00 beschikbaar']);
  assert.ok(titanique.every((s) => s.podiumpas === false && s.prijs === 59));

  // Moord in het Parktheater: uitgesloten; bijeenkomst zonder genre weg.
  assert.ok(shows.filter((s) => s.maker === 'Moord in het Parktheater').every((s) => s.podiumpas === false));
  assert.equal(shows.some((s) => s.titel === 'Kansrijk Samen'), false);
  assert.equal(new Set(shows.map((s) => s.id)).size, shows.length);
});
