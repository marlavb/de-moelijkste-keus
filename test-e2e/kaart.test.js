// End-to-end voor de kaart bij Mijn theaters (okt 2026), ingelogd tegen de
// Firebase-emulators met de echte firestore.rules en de vaste agenda
// (test-e2e/fixtures). Leaflet en tegels lokaal (test/kaartNep.js).
// Aan/uit op de kaart = dezelfde opslag als de lijst, direct in Firestore.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

import { controleerEmulators, startServer, wisEmulators, maakAccount, openGebruiker, ga, wachtOpDoc, schermafbeelding } from './hulp.js';
import { routeKaart } from '../test/kaartNep.js';

const ACCOUNT = { email: 'kaart@e2e.test', wachtwoord: 'geheim-kaart', naam: 'Kaart Kijker' };
let uid;
let server;
let base;
let browser;
let ik;

before(async () => {
  controleerEmulators();
  await wisEmulators();
  uid = await maakAccount(ACCOUNT);
  ({ server, base } = await startServer());
  browser = await chromium.launch();
  ik = await openGebruiker(browser, base, ACCOUNT, '#/profiel', { voorbereid: (ctx) => routeKaart(ctx) });
  await wachtOpDoc(`users/${uid}`, (d) => d?.profielGevraagd === true);
});

after(async () => {
  await ik?.ctx.close().catch(() => {});
  await browser?.close();
  await new Promise((r) => server.close(r));
});

const rustigeKaart = (page) =>
  page.waitForFunction(() => document.querySelector('#theatersKaart')?.dataset.klaar === '1' && !document.querySelector('.leaflet-zoom-anim, .leaflet-cluster-anim'));

test('Kaart (ingelogd): speldje uit → users/{uid}.enabledTheaters; na wisselen Lijst/Kaart weer aan', async () => {
  const { page } = ik;
  await ga(page, base, '#/theaters');
  await page.waitForSelector('.provincie-vak');
  await page.click('#theatersKaartKnop');
  await rustigeKaart(page);
  await schermafbeelding(page, 'kaart-overzicht');
  // Een los speldje (op het overzicht staan er een paar los).
  const pin = page.locator('.kaart-pin').first();
  const naam = await pin.getAttribute('title');
  const id = await page.evaluate(async (naam) => {
    const info = (await (await fetch('data/theaters.json')).json()).theaters;
    return Object.entries(info).find(([, t]) => t.naam === naam)?.[0];
  }, naam);
  assert.ok(id, `id van ${naam}`);
  await pin.click();
  await page.waitForSelector('.kaart-popup-knop.is-aan');
  await page.click('.kaart-popup-knop');
  await page.waitForSelector('.kaart-popup-knop:not(.is-aan)');
  await wachtOpDoc(`users/${uid}`, (d) => d?.enabledTheaters?.[id] === false);
  // (Dat de lijst meegaat, test test/kaart-ui.test.js; hier telt de opslag.)
  await page.click('#theatersLijstKnop');
  await page.click('#theatersKaartKnop');
  await rustigeKaart(page);
  await page.locator(`.kaart-pin[title="${naam}"]`).click();
  await page.click('.kaart-popup-knop');
  await wachtOpDoc(`users/${uid}`, (d) => d?.enabledTheaters?.[id] === true);
  assert.equal(ik.fouten.length, 0, ik.fouten.join('\n'));
});
