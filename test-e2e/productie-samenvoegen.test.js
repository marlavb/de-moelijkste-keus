// End-to-end: Greg Shapiro – KING ME stond als drie producties in de data
// (Stadsgehoorzaal "Greg Shapiro", Cpunt "KING ME – 250 years of Donald
// Trump – Greg Shapiro", De Stoep "KING ME – Greg Shapiro"). Eén keer op de
// watchlist gezet werden het drie items (oude TITEL_MAPPING). Nu: één regel
// in Profiel, en na de nachtrun (productieSamenvoegen.js) één item, ook in
// Firestore en in de kopie voor vrienden. De agenda is vaste testdata (de
// bronrecords zoals de theaters ze gaven, overgenomen uit de data van 8 okt
// 2026, met datums vanaf vandaag), in twee standen via de browser geserveerd:
//   0. de bron (nog niet samengevoegd);
//   1. zoals de nachtrun hem maakt (samenvoegen, weergave en genre op meerderheid).
// Sinds de nachtrun van 8 okt staat in public/data/shows.json alleen nog
// "KING ME – Greg Shapiro" (met de oude titel in titelBron); daarom niet meer
// de echte data.
// Draai met `npm run test:e2e`. De tests bouwen op elkaar voort.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

import { controleerEmulators, startServer, wisEmulators, maakAccount, openGebruiker, ga, wachtOpDoc, schermafbeelding } from './hulp.js';
import { pasProductieSamenvoegingToe } from '../src/lib/productieSamenvoegen.js';
import { pasMeerderheidToe } from '../src/lib/weergaveMeerderheid.js';
import { pasGenreMeerderheidToe } from '../src/lib/genreMeerderheid.js';
import { dagenVerder } from '../test/datum.js';

const ACCOUNT = { email: 'greet@e2e.test', wachtwoord: 'geheim-greet', naam: 'Greet Smit', gebruikersnaam: 'greet' };
let uid;
let server;
let base;
let browser;
let ik;
const data = {};
let stand = 0;
let sgz; // Stadsgehoorzaal "Greg Shapiro"

const dag = (n) => dagenVerder(n);
// De bron per theater (titel, genre en beschrijving zoals de theaters ze gaven).
const voorstelling = (theaterId, theaterNaam, stad, n, titel, extra = {}) => ({
  id: `kingme-${theaterId}`, titel, theaterId, theaterNaam, stad, datum: dag(n), tijd: '20:30', maker: null,
  genre: 'Cabaret', genreRuw: 'Cabaret', volgordeZeker: true, beschikbaarheid: 'beschikbaar', podiumpas: true,
  beschrijving: null, reserverenUrl: 'https://example.invalid/', bron: '', opgehaaldOp: new Date().toISOString(), ...extra,
});
const BRON = [
  voorstelling('stoep', 'Theater de Stoep', 'Spijkenisse', 13, 'KING ME – Greg Shapiro'),
  voorstelling('cpunt', 'Cpunt', 'Hoofddorp', 15, 'KING ME – 250 years of Donald Trump – Greg Shapiro', { beschrijving: '250 years of Donald Trump' }),
  voorstelling('kleinekomedie', 'De Kleine Komedie', 'Amsterdam', 20, 'King Me – 250 years of Donald Trump – Greg Shapiro'),
  voorstelling('stadsgehoorzaal', 'Stadsgehoorzaal', 'Vlaardingen', 25, 'Greg Shapiro', { genre: 'Overig', genreRuw: 'Overig', beschrijving: 'KING ME | 250 years of Donald Trump' }),
  voorstelling('stadsschouwburgutrecht', 'Stadsschouwburg Utrecht', 'Utrecht', 28, 'KING ME – 250 Years of Donald Trump – Greg Shapiro'),
  voorstelling('omval', 'Theater de Omval', 'Diemen', 29, 'King Me – Greg Shapiro'),
  voorstelling('griffioen', 'VU Griffioen', 'Amsterdam', 40, 'KING ME – Greg Shapiro', { beschrijving: 'KING ME' }),
  // Iets anders in de agenda, zodat Profiel en de zoekfunctie niet leeg zijn.
  voorstelling('delamar', 'DeLaMar', 'Amsterdam', 10, 'Prikkelarme kermis – Sara Kroos', { id: 'ander-1' }),
];

before(async () => {
  controleerEmulators();
  await wisEmulators();
  uid = await maakAccount(ACCOUNT);
  data[0] = BRON;
  // Zoals scrapeRun: samenvoegen, weergave en genre op meerderheid.
  data[1] = pasGenreMeerderheidToe(pasMeerderheidToe(pasProductieSamenvoegingToe(structuredClone(BRON)).shows).shows).shows;
  assert.deepEqual([...new Set(data[1].filter((s) => /shapiro/i.test(s.titel)).map((s) => s.titel))], ['KING ME – Greg Shapiro'], 'de nachtrun voegt alles samen');
  sgz = data[0].find((s) => s.theaterId === 'stadsgehoorzaal');
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

// Eerst herladen met de nieuwe stand, dan naar de route: een onbekend id in
// de oude stand stuurt de app anders door naar de Agenda.
async function nieuweStand(page, n, hash) {
  stand = n;
  await page.reload();
  await page.waitForSelector('.nav-item', { state: 'attached' });
  await page.waitForTimeout(500);
  await ga(page, base, hash);
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
  // Eerst opgeslagen, dan pas herladen.
  await gebruiker((x) => x?.watchlist?.length >= 1);
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
