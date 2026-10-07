// End-to-end: Greg Shapiro – KING ME stond als drie producties in de data
// (Stadsgehoorzaal "Greg Shapiro", Cpunt "KING ME – 250 years of Donald
// Trump – Greg Shapiro", De Stoep "KING ME – Greg Shapiro"). Eén keer op de
// watchlist gezet werden het drie items (oude TITEL_MAPPING). Nu: één regel
// in Profiel, en na de nachtrun (productieSamenvoegen.js) één item, ook in
// Firestore en in de kopie voor vrienden. De agenda komt uit
// public/data/shows.json, in twee standen via de browser geserveerd:
//   0. zoals hij nu is (nog niet samengevoegd);
//   1. zoals de nachtrun hem maakt (samenvoegen, weergave en genre op meerderheid).
// Draai met `npm run test:e2e`. De tests bouwen op elkaar voort.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

import { controleerEmulators, startServer, wisEmulators, maakAccount, openGebruiker, ga, wachtOpDoc, schermafbeelding } from './hulp.js';
import { pasProductieSamenvoegingToe } from '../src/lib/productieSamenvoegen.js';
import { pasMeerderheidToe } from '../src/lib/weergaveMeerderheid.js';
import { pasGenreMeerderheidToe } from '../src/lib/genreMeerderheid.js';

const ACCOUNT = { email: 'greet@e2e.test', wachtwoord: 'geheim-greet', naam: 'Greet Smit', gebruikersnaam: 'greet' };
const vandaag = new Date().toISOString().slice(0, 10);
let uid;
let server;
let base;
let browser;
let ik;
const data = {};
let stand = 0;
let sgz; // Stadsgehoorzaal "Greg Shapiro"

before(async () => {
  controleerEmulators();
  await wisEmulators();
  uid = await maakAccount(ACCOUNT);
  const ruw = JSON.parse(await readFile(path.join(new URL('../public/', import.meta.url).pathname, 'data/shows.json'), 'utf-8'));
  data[0] = Array.isArray(ruw) ? ruw : ruw.shows;
  // Zoals scrapeRun: terug naar de bron, samenvoegen, weergave en genre op meerderheid.
  const bron = data[0].map(({ titelBron, genreBron, beschrijvingBron, genres, ...s }) => ({
    ...s,
    titel: titelBron ?? s.titel,
    ...(genreBron !== undefined ? { genre: genreBron } : {}),
    ...(beschrijvingBron !== undefined ? { beschrijving: beschrijvingBron } : {}),
  }));
  data[1] = pasGenreMeerderheidToe(pasMeerderheidToe(pasProductieSamenvoegingToe(bron).shows).shows).shows;
  sgz = data[0].find((s) => s.theaterId === 'stadsgehoorzaal' && s.titel === 'Greg Shapiro' && s.datum >= vandaag);
  assert.ok(sgz, 'Stadsgehoorzaal "Greg Shapiro" staat niet (meer) in de data');
  ({ server, base } = await startServer());
  browser = await chromium.launch();
  ik = await openGebruiker(browser, base, ACCOUNT);
  await ik.ctx.route(/\/data\/shows\.json/, (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify(data[stand]) }));
});

after(async () => {
  await ik?.ctx.close().catch(() => {});
  await browser?.close();
  await new Promise((r) => server.close(r));
});

async function nieuweStand(page, n, hash) {
  stand = n;
  await ga(page, base, hash);
  await page.reload();
  await page.waitForSelector('.nav-item', { state: 'attached' });
}

const gebruiker = (t) => wachtOpDoc(`users/${uid}`, t);
const shapiroRijen = (page) => page.locator('#favoritesList .watchlist-item', { hasText: /Shapiro|KING ME/i });

test('profiel en delen aan', async () => {
  const { page } = ik;
  await page.waitForFunction(() => location.hash === '#/profiel/instellen', null, { timeout: 15000 });
  await page.fill('#profielGebruikersnaam', ACCOUNT.gebruikersnaam);
  await page.fill('#profielNaam', ACCOUNT.naam);
  await page.click('#profielOpslaan');
  await page.waitForFunction(() => location.hash === '#/profiel', null, { timeout: 15000 });
  await page.click('.delen-melding >> text="Oké"');
  await wachtOpDoc(`gedeeld/${uid}`, (d) => d?.watchlist === true);
});

test('huidige data: "Greg Shapiro" op de watchlist wordt drie items (oude mapping), maar één regel in Profiel', async () => {
  const { page } = ik;
  await nieuweStand(page, 0, `#/show/${encodeURIComponent(sgz.id)}`);
  await page.waitForSelector('#screen-detail:not([hidden])');
  await page.click('#detailWatchIcon');
  await page.waitForSelector('#detailWatchIcon.is-on');
  await nieuweStand(page, 0, '#/profiel');
  const d = await gebruiker((x) => x?.watchlist?.length === 3);
  assert.deepEqual(d.watchlist.map((i) => i.sleutel).sort(), ['250 years of donald trump | greg shapiro | king me', 'greg shapiro', 'greg shapiro | king me']);
  await shapiroRijen(page).first().waitFor();
  assert.equal(await shapiroRijen(page).count(), 1);
  await shapiroRijen(page).first().scrollIntoViewIfNeeded();
  await schermafbeelding(page, '17-king-me-een-regel-voor');
});

test('na de nachtrun: één productie "KING ME – Greg Shapiro", één item (Firestore en kopie voor vrienden), agenda overal op de watchlist', async () => {
  const { page } = ik;
  await nieuweStand(page, 1, '#/profiel');
  const d = await gebruiker((x) => x?.watchlist?.length === 1);
  assert.equal(d.watchlist[0].sleutel, 'greg shapiro | king me');
  const kopie = await wachtOpDoc(`gedeeld/${uid}/onderdelen/watchlist`, (x) => x?.items?.length === 1);
  assert.equal(kopie.items[0].titel, 'KING ME – Greg Shapiro');
  await shapiroRijen(page).first().waitFor();
  assert.equal(await shapiroRijen(page).count(), 1);
  assert.match(await shapiroRijen(page).first().locator('.show-title').textContent(), /^KING ME – Greg Shapiro$/);
  assert.match(await shapiroRijen(page).first().locator('.show-meta').textContent(), /andere theaters/);
  await shapiroRijen(page).first().scrollIntoViewIfNeeded();
  await schermafbeelding(page, '18-king-me-een-regel-na');

  await ga(page, base, '#/');
  if (!(await page.locator('#searchInput').isVisible())) await page.click('#searchToggle');
  await page.fill('#searchInput', 'Greg Shapiro');
  await page.waitForTimeout(500);
  const rijen = page.locator('#agendaList .show-row');
  const aantal = await rijen.count();
  assert.ok(aantal >= 5, `${aantal} rijen`);
  for (let i = 0; i < aantal; i++) {
    assert.equal(await rijen.nth(i).locator('.show-title-text').textContent(), 'KING ME – Greg Shapiro');
    assert.equal(await rijen.nth(i).locator('.watchlist-icon').count(), 1);
  }
  await schermafbeelding(page, '19-king-me-agenda');
  assert.deepEqual(ik.fouten, []);
});
