// End-to-end (okt 2026): een voorstelling op Gezien zetten haalt hem van de
// watchlist (melding "Ook van je watchlist gehaald · Ongedaan maken"), in
// Firestore met een tombstone; "Ongedaan maken" zet beide terug. Opnieuw op
// de watchlist zetten na Gezien blijft staan, ook na herladen (opruiming).
// Ingelogd tegen de emulators met de echte firestore.rules.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

import { controleerEmulators, startServer, wisEmulators, maakAccount, openGebruiker, ga, wachtOpTekst, wachtOpDoc, schermafbeelding, vasteShows } from './hulp.js';
import { watchlistSleutel } from '../public/js/watchlist.js';
import { vandaag as vandaagAmsterdam } from '../test/datum.js';

const ACCOUNT = { email: 'gerda@e2e.test', wachtwoord: 'geheim-gerda', naam: 'Gerda Smit' };
let uid;
let server;
let base;
let browser;
let ik;
let show;
let sleutel;

const opWatchlist = (d) => (d?.watchlist ?? []).some((i) => i.sleutel === sleutel);
const opGezien = (d) => (d?.gezien ?? []).some((i) => i.sleutel === sleutel);

before(async () => {
  controleerEmulators();
  await wisEmulators();
  uid = await maakAccount(ACCOUNT);
  const data = await vasteShows();
  const vandaag = vandaagAmsterdam();
  show = (Array.isArray(data) ? data : data.shows).find((s) => s.datum > vandaag && s.beschikbaarheid === 'beschikbaar' && !watchlistSleutel(s.titel, s.theaterId).includes('::'));
  sleutel = watchlistSleutel(show.titel, show.theaterId);
  ({ server, base } = await startServer());
  browser = await chromium.launch();
  ik = await openGebruiker(browser, base, ACCOUNT, `#/show/${encodeURIComponent(show.id)}`);
  // Het Firestore-document bestaat zodra de app na het inloggen heeft gesynchroniseerd.
  await wachtOpDoc(`users/${uid}`);
});

after(async () => {
  await ik?.ctx.close().catch(() => {});
  await browser?.close();
  await new Promise((r) => server.close(r));
});

test('aanvinken als Gezien → van de watchlist (tombstone) met "Ongedaan maken"; ongedaan zet beide terug', async () => {
  const { page } = ik;
  await ga(page, base, `#/show/${encodeURIComponent(show.id)}`);
  await page.click('#detailWatchIcon');
  await wachtOpDoc(`users/${uid}`, opWatchlist);
  await page.click('#detailGezienBtn');
  await wachtOpTekst(page, '#melding', /Ook van je watchlist gehaald\s*Ongedaan maken/);
  await schermafbeelding(page, 'watchlist-gezien-melding');
  const na = await wachtOpDoc(`users/${uid}`, (d) => opGezien(d) && !opWatchlist(d));
  assert.ok(na.watchlistVerwijderd.some((t) => t.sleutel === sleutel), 'tombstone op de watchlist');
  assert.equal(await page.getAttribute('#detailWatchIcon', 'aria-pressed'), 'false');

  await page.click('#melding .melding-actie');
  await wachtOpDoc(`users/${uid}`, (d) => !opGezien(d) && opWatchlist(d));
  assert.equal(await page.getAttribute('#detailWatchIcon', 'aria-pressed'), 'true');
  assert.equal(await page.getAttribute('#detailGezienBtn', 'aria-pressed'), 'false');
});

test('opnieuw op de watchlist na Gezien: blijft staan, ook na herladen', async () => {
  const { page } = ik;
  await page.click('#detailGezienBtn');
  await wachtOpDoc(`users/${uid}`, (d) => opGezien(d) && !opWatchlist(d));
  await page.click('#detailWatchIcon');
  await wachtOpDoc(`users/${uid}`, (d) => opGezien(d) && opWatchlist(d));
  await page.reload();
  await page.waitForSelector('.nav-item', { state: 'attached' });
  await page.waitForTimeout(1500);
  const d = await wachtOpDoc(`users/${uid}`);
  assert.ok(opGezien(d) && opWatchlist(d), 'na herladen nog op beide');
  assert.equal(await page.getAttribute('#detailWatchIcon', 'aria-pressed'), 'true');
});

test('geen fouten in de pagina', () => {
  assert.deepEqual(ik.fouten, []);
});
