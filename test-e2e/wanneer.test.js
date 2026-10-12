// End-to-end voor het datumfilter "Wanneer" (okt 2026) op de vaste agenda
// (test-e2e/fixtures, vasteShows in hulp.js), uitgelogd. De verwachte
// speeldata rekent de test zelf uit met wanneer.js, vanaf vandaag in
// Amsterdam (zoals de fixture). Draai met `npm run test:e2e`.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

import { controleerEmulators, startServer, openGebruiker, schermafbeelding, vasteShows } from './hulp.js';
import { vandaag as vandaagAmsterdam } from '../test/datum.js';
import { snelBereik, weekdagVan } from '../public/js/wanneer.js';

let server;
let base;
let browser;
let ik; // { ctx, page, fouten }
let shows;
const vandaag = vandaagAmsterdam();

before(async () => {
  controleerEmulators();
  const data = await vasteShows();
  shows = (Array.isArray(data) ? data : data.shows).filter((s) => s.datum >= vandaag);
  ({ server, base } = await startServer());
  browser = await chromium.launch();
  ik = await openGebruiker(browser, base, null, '#/');
  await ik.page.waitForSelector('#agendaList .show-row');
});

after(async () => {
  await ik?.ctx.close().catch(() => {});
  await browser?.close();
  await new Promise((r) => server.close(r));
});

/** Speeldata in de agenda: [datum, titel] per rij, uit de data-attributen of de kop. */
async function rijen(page) {
  return page.evaluate(() =>
    [...document.querySelectorAll('#agendaList .date-group')].flatMap((g) =>
      [...g.querySelectorAll('.show-row')].map((r) => r.querySelector('.show-title-text')?.textContent.trim())
    )
  );
}

async function kies(page, naam) {
  await page.locator('#filterSheet').getByRole('button', { name: naam, exact: true }).click();
  await page.waitForTimeout(150);
}

test('Wanneer op de vaste agenda: "Volgende week" toont precies ma–zo van volgende week', async () => {
  const { page } = ik;
  await page.click('#filterToggle');
  await kies(page, 'Volgende week');
  const { van, tot } = snelBereik('volgendeWeek', vandaag);
  const verwacht = shows.filter((s) => s.datum >= van && s.datum <= tot);
  assert.ok(verwacht.length > 0, 'de fixture heeft speeldata volgende week');
  assert.equal((await rijen(page)).length, verwacht.length);
  assert.equal(await page.locator('#filterBadge').innerText(), '1');
  await schermafbeelding(page, 'wanneer-volgende-week');
  await kies(page, 'Volgende week'); // uit
  assert.equal(await page.locator('#filterBadge').isHidden(), true);
  assert.equal(ik.fouten.length, 0, ik.fouten.join('\n'));
});

test('Wanneer op de vaste agenda: za + zo met stad Amsterdam, binnen het 30-dagenvenster; wissen geeft alles terug', async () => {
  const { page } = ik;
  const alles = (await rijen(page)).length;
  await kies(page, 'zaterdag');
  await kies(page, 'zondag');
  await page.locator('#sheetCityFilters').getByRole('button', { name: 'Amsterdam', exact: true }).click();
  await page.waitForTimeout(150);
  const grens = new Date(Date.parse(`${vandaag}T12:00:00Z`) + 30 * 86_400_000).toISOString().slice(0, 10);
  const verwacht = shows.filter((s) => s.stad === 'Amsterdam' && [6, 7].includes(weekdagVan(s.datum)) && s.datum <= grens);
  assert.ok(verwacht.length > 0, 'de fixture heeft weekendvoorstellingen in Amsterdam');
  assert.equal((await rijen(page)).length, verwacht.length);
  assert.equal(await page.locator('#filterBadge').innerText(), '2');
  await page.click('#clearFilters');
  await page.waitForTimeout(150);
  assert.equal((await rijen(page)).length, alles);
  assert.equal(ik.fouten.length, 0, ik.fouten.join('\n'));
});
