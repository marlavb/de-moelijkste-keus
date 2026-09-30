// DOK6 (Panningen): de echte scraper op een uitsnede van de programmapagina
// (test/fixtures/dok6-programma.html, uit de lokale cache van 30 sep 2026),
// in Chromium, zonder netwerk.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

import { scrapeDok6 } from '../src/sites/dok6.js';

const fixture = readFileSync(new URL('./fixtures/dok6-programma.html', import.meta.url), 'utf-8');
const theater = { id: 'dok6', naam: 'DOK6', stad: 'Panningen', podiumpas: true, baseUrl: 'https://dok6.eu', agendaUrl: 'https://dok6.eu/theater/programma/' };

test('DOK6: titels, datums, status, Podiumpas, schoolvoorstelling, gratis', async () => {
  const browser = await chromium.launch();
  let shows;
  const waarschuwingen = [];
  try {
    const page = await browser.newPage();
    await page.route('**/*', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: fixture }));
    shows = await scrapeDok6({ page, theater, robots: { isAllowed: () => true }, waitForTurn: async () => {}, log: () => {}, warn: (m) => waarschuwingen.push(m) });
  } finally {
    await browser.close();
  }
  const van = (t) => shows.find((s) => s.titel === t);
  assert.deepEqual(waarschuwingen, []);
  assert.equal(shows.length, 7); // 8 blokken, 1 schoolvoorstelling eruit

  // Cabaret omgedraaid; datum "za 3 okt ‘26" met tijd.
  const max = van('Maxikozi – Max van den Burg');
  assert.equal(max.datum, '2026-10-03');
  assert.equal(max.tijd, '20:15');
  assert.equal(max.podiumpas, true);
  assert.equal(max.beschikbaarheid, 'beschikbaar');
  assert.match(max.reserverenUrl, /apps\.ticketmatic\.com\/widgets\/dok6/);

  // Uit de regio: geen Podiumpas; wachtlijst uit de knop.
  const dorper = van('Dörper Revue');
  assert.equal(dorper.podiumpas, false);
  assert.equal(dorper.beschikbaarheid, 'wachtlijst');
  assert.equal(dorper.maker, 'Heerlik Helje');

  // is_free (€ 16,50, "kinderen gratis") telt niet; € 0 wel: geen Podiumpas en niet omdraaien.
  assert.equal(van('Joes | 3 t/m 8 jaar').podiumpas, true);
  const tv = van("De Cabaret Club op z'n Limburgs");
  assert.ok(tv, 'titel niet omgedraaid');
  assert.equal(tv.podiumpas, false);
  assert.equal(van('Uitreiking Cultuurprijs Peel en Maas 2026').podiumpas, false);

  // Andere genres: bronvolgorde met de ondertitel als maker; wervende zin niet.
  assert.equal(van("Century's Crime").maker, 'A Tribute to Supertramp');
  assert.equal(van('De Gierende Hormonen Show').maker, null);

  // Schoolvoorstelling (Educatie, geen kaartverkoop) staat er niet in.
  assert.equal(shows.some((s) => /gr\. \d/.test(s.titel)), false);
});
