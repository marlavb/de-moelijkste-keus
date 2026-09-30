// De Maaspoort (Venlo): de echte scraper op een uitsnede van de
// programmapagina's (test/fixtures/maaspoort-programma.html, uit de lokale
// cache van 30 sep 2026), in Chromium, zonder netwerk.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

import { scrapeMaaspoort } from '../src/sites/maaspoort.js';

const fixture = readFileSync(new URL('./fixtures/maaspoort-programma.html', import.meta.url), 'utf-8');
const theater = {
  id: 'maaspoort',
  naam: 'De Maaspoort Theater & Events',
  stad: 'Venlo',
  podiumpas: true,
  baseUrl: 'https://www.maaspoort.nl',
  agendaUrl: 'https://www.maaspoort.nl/programma/',
};

async function scrape() {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    // Elke pagina (ook ?page=2) geeft de uitsnede: pagina 2 levert niets nieuws, dus stop.
    await page.route('**/*', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: fixture }));
    const waarschuwingen = [];
    const shows = await scrapeMaaspoort({
      page,
      theater,
      robots: { isAllowed: () => true },
      waitForTurn: async () => {},
      log: () => {},
      warn: (m) => waarschuwingen.push(m),
    });
    return { shows, waarschuwingen };
  } finally {
    await browser.close();
  }
}

test('Maaspoort: titels, datums, status, Podiumpas, externe locatie, schoolvoorstelling', async () => {
  const { shows, waarschuwingen } = await scrape();
  const van = (titel) => shows.find((s) => s.titel === titel);
  assert.deepEqual(waarschuwingen, []);
  assert.equal(shows.length, 7); // 8 blokken, 1 schoolvoorstelling eruit

  // Cabaret: artiest in de titel, voorstelling in de ondertitel → omgedraaid.
  const koning = van('Overprikkeld – Martijn Koning');
  assert.equal(koning.datum, '2027-03-03');
  assert.equal(koning.tijd, '20:15');
  assert.equal(koning.maker, null);
  assert.ok(van('Oudejaarsconference 2026 | Try-out – Claudia de Breij'));

  // Anders: bronvolgorde, ondertitel als maker.
  const zt = van('This will not end well');
  assert.equal(zt.maker, 'Het Zuidelijk Toneel');
  assert.equal(zt.genre, 'Muziektheater');

  // Wervende ondertitel ("Met …") wordt geen maker; prijs > € 50 → geen Podiumpas.
  const bodyguard = van('The Bodyguard');
  assert.equal(bodyguard.maker, null);
  assert.equal(bodyguard.prijs, 66.5);
  assert.equal(bodyguard.podiumpas, false);

  // Label "verplaatst" staat op de nieuwe datum en is gewoon te boeken.
  const beeGees = van('Bee Gees by Maincourse');
  assert.equal(beeGees.beschikbaarheid, 'beschikbaar');
  assert.equal(beeGees.datum, '2027-07-08');

  // Externe locatie: getoond, met de plek, zonder Podiumpas.
  const garage = shows.find((s) => s.locatie);
  assert.equal(garage.locatie, 'Theater De Garage | Venlo');
  assert.equal(garage.podiumpas, false);

  // Status uit de bestelknop.
  assert.equal(van('Kende da!? – Christel de Laat').beschikbaarheid, 'uitverkocht');
  assert.equal(koning.podiumpas, true);
  assert.equal(koning.reserverenUrl.startsWith('https://www.maaspoort.nl/programma/'), true);
});
