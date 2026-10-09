// "Vandaag" in tests (test/datum.js) tegen wat de browser als vandaag ziet,
// met een vastgezette klok: vlak na middernacht en laat op de avond, in
// zomer- en wintertijd. Zo maakt het tijdstip waarop de tests draaien niet
// meer uit (9 okt 2026: om 00:11 faalde een UI-test op de UTC-datum).

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

import { vandaag, dagenVerder, amsterdamTijdstip, TIJDZONE } from './datum.js';

let browser;
before(async () => {
  browser = await chromium.launch();
});
after(async () => {
  await browser?.close();
});

const GEVALLEN = [
  { naam: 'zomertijd 00:30', datum: '2026-10-09', tijd: '00:30', utc: '2026-10-08T22:30:00.000Z' },
  { naam: 'zomertijd 23:30', datum: '2026-10-09', tijd: '23:30', utc: '2026-10-09T21:30:00.000Z' },
  { naam: 'wintertijd 00:30', datum: '2027-01-15', tijd: '00:30', utc: '2027-01-14T23:30:00.000Z' },
  { naam: 'wintertijd 23:30', datum: '2027-01-15', tijd: '23:30', utc: '2027-01-15T22:30:00.000Z' },
];

for (const g of GEVALLEN) {
  test(`vandaag() = de datum die de app ziet (${g.naam})`, async () => {
    const nu = amsterdamTijdstip(g.datum, g.tijd);
    assert.equal(new Date(nu).toISOString(), g.utc);
    assert.equal(vandaag(nu), g.datum);

    const ctx = await browser.newContext({ timezoneId: TIJDZONE });
    const page = await ctx.newPage();
    await page.clock.setFixedTime(nu);
    // Zoals todayIsoDate() in public/js/app.js: de lokale datum van het toestel.
    const app = await page.evaluate(() => {
      const d = new Date();
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    });
    await ctx.close();
    assert.equal(app, g.datum);
  });
}

test('de oude manier (UTC-datum) zit er om 00:30 een dag naast; vandaag() niet', () => {
  const nu = amsterdamTijdstip('2026-10-09', '00:30');
  assert.equal(new Date(nu).toISOString().slice(0, 10), '2026-10-08');
  assert.equal(vandaag(nu), '2026-10-09');
});

test('dagenVerder: over maand-, jaar- en zomertijdgrens', () => {
  assert.equal(dagenVerder(1, amsterdamTijdstip('2026-10-31', '23:30')), '2026-11-01');
  assert.equal(dagenVerder(-1, amsterdamTijdstip('2027-01-01', '00:30')), '2026-12-31');
  assert.equal(dagenVerder(1, amsterdamTijdstip('2026-10-24', '23:30')), '2026-10-25');
  assert.equal(dagenVerder(0, amsterdamTijdstip('2026-03-29', '03:30')), '2026-03-29');
});
