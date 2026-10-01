// UI-test voor het profiel (vrienden, stap 1): de eenmalige vraag "Kies je
// gebruikersnaam" na inloggen, opslaan, bezet, wijzigen, en wat er gebeurt
// als Firestore niet bereikbaar is. Echte app uit public/ via een lokaal
// servertje; Firebase vervangen door nepFirebase (Firestore in het geheugen).

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

import { nepFirebase } from './nepFirebase.js';

const ROOT = new URL('../public/', import.meta.url).pathname;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };
const ANNA = { uid: 'u1', displayName: 'Anna de Vries', email: 'anna@example.com', photoURL: null };
let server;
let base;
let browser;

before(async () => {
  server = createServer(async (req, res) => {
    const pad = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const file = path.join(ROOT, pad.endsWith('/') ? `${pad}index.html` : pad);
    try {
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}/`;
  browser = await chromium.launch();
});

after(async () => {
  await browser?.close();
  await new Promise((r) => server.close(r));
});

async function openApp({ gebruiker = null, docs = {}, hash = '#/profiel', offline = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  await ctx.route(`${base}js/firebase.js`, (r) =>
    r.fulfill({ contentType: 'text/javascript', body: nepFirebase({ gebruiker, docs }) })
  );
  if (offline) await ctx.addInitScript(() => { window.__nepOffline = true; });
  const page = await ctx.newPage();
  const fouten = [];
  page.on('pageerror', (e) => fouten.push(e.message));
  await page.goto(`${base}${hash}`);
  await page.waitForSelector('.nav-item');
  await page.waitForTimeout(400);
  return { ctx, page, fouten };
}

const opslag = (page, pad) => page.evaluate((p) => window.__nepFirestore.get(p) ?? null, pad);
const zichtbaar = (page, sel) => page.isVisible(sel);

test('uitgelogd: Profiel zoals voorheen, geen profielregel; het instelscherm stuurt terug naar Profiel', async () => {
  const { ctx, page, fouten } = await openApp();
  assert.equal(await zichtbaar(page, '.google-btn'), true);
  assert.equal(await page.locator('.profiel-regel').count(), 0);
  await page.goto(`${base}#/profiel/instellen`);
  await page.waitForTimeout(400);
  assert.equal(new URL(page.url()).hash, '#/profiel');
  assert.equal(await zichtbaar(page, '#screen-profiel'), true);
  assert.deepEqual(fouten, []);
  await ctx.close();
});

test('ingelogd zonder profiel: één keer "Kies je gebruikersnaam", met voorstel; Later laat het daarna met rust', async () => {
  const { ctx, page, fouten } = await openApp({ gebruiker: ANNA });
  assert.equal(new URL(page.url()).hash, '#/profiel/instellen');
  assert.equal(await page.textContent('#profielInstellenTitel'), 'Kies je gebruikersnaam');
  assert.equal(await page.inputValue('#profielGebruikersnaam'), 'anna.de.vries');
  assert.equal(await page.inputValue('#profielNaam'), 'Anna de Vries');
  assert.equal(await zichtbaar(page, '#profielLater'), true);
  assert.equal(await zichtbaar(page, '#bottomNav'), false);
  assert.equal((await opslag(page, 'users/u1')).profielGevraagd, true);

  await page.click('#profielLater');
  await page.waitForTimeout(200);
  assert.equal(new URL(page.url()).hash, '#/profiel');
  assert.match(await page.textContent('.profiel-regel'), /Nog geen gebruikersnaam/);
  // Profiel opnieuw openen: geen tweede keer vanzelf.
  await page.click('.nav-item[data-tab="agenda"]');
  await page.click('.nav-item[data-tab="profiel"]');
  await page.waitForTimeout(200);
  assert.equal(new URL(page.url()).hash, '#/profiel');
  assert.deepEqual(fouten, []);
  await ctx.close();

  // Een volgende keer (ander apparaat): users/{uid}.profielGevraagd onthoudt het.
  const tweede = await openApp({ gebruiker: ANNA, docs: { 'users/u1': { profielGevraagd: true } } });
  assert.equal(new URL(tweede.page.url()).hash, '#/profiel');
  await tweede.page.click('.profiel-regel .text-btn-small');
  await tweede.page.waitForTimeout(200);
  assert.equal(new URL(tweede.page.url()).hash, '#/profiel/instellen');
  await tweede.ctx.close();
});

test('opslaan: ongeldig → melding bij het veld; bezet → melding; geldig → terug naar Profiel met @naam', async () => {
  const { ctx, page, fouten } = await openApp({
    gebruiker: ANNA,
    docs: { 'usernames/anna': { uid: 'u2', gebruikersnaam: 'anna', naam: 'Een ander' } },
  });
  await page.fill('#profielGebruikersnaam', 'an');
  await page.fill('#profielNaam', '   ');
  await page.click('#profielOpslaan');
  assert.match(await page.textContent('#profielGebruikersnaamFout'), /minstens 3/);
  assert.match(await page.textContent('#profielNaamFout'), /Vul je naam in/);
  assert.equal(await page.getAttribute('#profielGebruikersnaam', 'aria-invalid'), 'true');

  await page.fill('#profielGebruikersnaam', 'ANNA');
  await page.fill('#profielNaam', 'Anna de Vries');
  await page.click('#profielOpslaan');
  await page.waitForSelector('#profielGebruikersnaamFout:not([hidden])');
  assert.match(await page.textContent('#profielGebruikersnaamFout'), /al bezet/);
  assert.equal(await page.getAttribute('#profielNaam', 'aria-invalid'), null);

  await page.fill('#profielGebruikersnaam', 'Anna_V');
  await page.click('#profielOpslaan');
  await page.waitForTimeout(300);
  assert.equal(new URL(page.url()).hash, '#/profiel');
  assert.match(await page.textContent('.profiel-regel'), /@Anna_V · Anna de Vries/);
  assert.deepEqual(await opslag(page, 'usernames/anna_v'), { uid: 'u1', gebruikersnaam: 'Anna_V', naam: 'Anna de Vries' });
  assert.equal((await opslag(page, 'profielen/u1')).gebruikersnaamLaag, 'anna_v');
  assert.equal((await opslag(page, 'usernames/anna')).uid, 'u2');
  assert.deepEqual(fouten, []);
  await ctx.close();
});

test('bestaand profiel: Wijzigen toont de huidige gegevens zonder "Later"; nieuwe naam geeft de oude vrij', async () => {
  const docs = {
    'users/u1': { profielGevraagd: true },
    'profielen/u1': { gebruikersnaam: 'anna', gebruikersnaamLaag: 'anna', naam: 'Anna', aangemaaktOp: 'TOEN', gewijzigdOp: 'TOEN', v: 1 },
    'usernames/anna': { uid: 'u1', gebruikersnaam: 'anna', naam: 'Anna' },
  };
  const { ctx, page, fouten } = await openApp({ gebruiker: ANNA, docs });
  assert.match(await page.textContent('.profiel-regel'), /@anna · Anna/);
  await page.click('.profiel-regel .text-btn-small');
  await page.waitForTimeout(200);
  assert.equal(await page.textContent('#profielInstellenTitel'), 'Profiel wijzigen');
  assert.equal(await page.inputValue('#profielGebruikersnaam'), 'anna');
  assert.equal(await zichtbaar(page, '#profielLater'), false);

  await page.fill('#profielGebruikersnaam', 'anna.v');
  await page.click('#profielOpslaan');
  await page.waitForTimeout(300);
  assert.equal(new URL(page.url()).hash, '#/profiel');
  assert.equal(await opslag(page, 'usernames/anna'), null);
  assert.equal((await opslag(page, 'usernames/anna.v')).uid, 'u1');
  assert.equal((await opslag(page, 'profielen/u1')).aangemaaktOp, 'TOEN');

  // Terug (app-knop) vanaf het instelscherm gaat naar Profiel.
  await page.click('.profiel-regel .text-btn-small');
  await page.waitForTimeout(200);
  await page.click('#profielInstellenBack');
  await page.waitForTimeout(200);
  assert.equal(new URL(page.url()).hash, '#/profiel');
  assert.deepEqual(fouten, []);
  await ctx.close();
});

test('Firestore onbereikbaar: duidelijke melding met "Opnieuw", de app blijft werken', async () => {
  const { ctx, page, fouten } = await openApp({ gebruiker: ANNA, offline: true });
  assert.match(await page.textContent('.profiel-regel'), /kon niet worden geladen/);
  // De rest van de app werkt gewoon.
  await page.click('.nav-item[data-tab="agenda"]');
  assert.equal(await zichtbaar(page, '#screen-agenda'), true);
  await page.click('.nav-item[data-tab="profiel"]');

  // Weer online: Opnieuw laadt het profiel (er is er nog geen).
  await page.evaluate(() => { window.__nepOffline = false; });
  await page.click('.profiel-regel .text-btn-small');
  await page.waitForTimeout(300);
  assert.match(await page.textContent('.profiel-regel'), /Nog geen gebruikersnaam/);

  // Opslaan terwijl het weer offline is: melding, knop weer bruikbaar, niets opgeslagen.
  await page.click('.profiel-regel .text-btn-small');
  await page.waitForTimeout(200);
  await page.evaluate(() => { window.__nepOffline = true; });
  await page.fill('#profielGebruikersnaam', 'anna_v');
  await page.click('#profielOpslaan');
  await page.waitForSelector('#profielStatus:not([hidden])');
  assert.match(await page.textContent('#profielStatus'), /Controleer je verbinding/);
  assert.equal(await page.isEnabled('#profielOpslaan'), true);
  assert.equal(new URL(page.url()).hash, '#/profiel/instellen');
  assert.equal(await opslag(page, 'profielen/u1'), null);
  assert.deepEqual(fouten, []);
  await ctx.close();
});

test('instelscherm direct openen terwijl het profiel nog laadt of mislukt: melding in plaats van een leeg formulier', async () => {
  const { ctx, page, fouten } = await openApp({ gebruiker: ANNA, offline: true, hash: '#/profiel/instellen' });
  assert.equal(new URL(page.url()).hash, '#/profiel/instellen');
  assert.equal(await zichtbaar(page, '#profielInstellenLaadFout'), true);
  assert.equal(await zichtbaar(page, '#profielForm'), false);
  await page.evaluate(() => { window.__nepOffline = false; });
  await page.click('#profielInstellenOpnieuw');
  await page.waitForTimeout(300);
  assert.equal(await zichtbaar(page, '#profielForm'), true);
  assert.equal(await page.inputValue('#profielNaam'), 'Anna de Vries');
  assert.deepEqual(fouten, []);
  await ctx.close();
});
