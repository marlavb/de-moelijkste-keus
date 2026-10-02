// UI-test voor delen met vrienden (stap 3): de eenmalige melding, "Oké" en
// "Aanpassen", de schakelaars, het schrijven van de kopie (pas na een keuze,
// met debounce, niet zonder wijziging) en offline. Echte app uit public/;
// Firebase is nepFirebase (zonder rules: die staan in firebase/tests/gedeeld.test.js).

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

import { nepFirebase } from './nepFirebase.js';
import { watchlistSleutel } from '../public/js/watchlist.js';

const ROOT = new URL('../public/', import.meta.url).pathname;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };
const ANNA = { uid: 'u1', displayName: 'Anna de Vries', email: 'anna@example.com', photoURL: null };
let server;
let base;
let browser;
let show; // een toekomstige voorstelling uit de echte data
let docs; // beginstand: profiel, watchlist met die voorstelling, één gezien voorstelling

before(async () => {
  const data = JSON.parse(await readFile(path.join(ROOT, 'data/shows.json'), 'utf-8'));
  const shows = Array.isArray(data) ? data : data.shows;
  const vandaag = new Date().toISOString().slice(0, 10);
  show = shows.find((s) => s.datum > vandaag);
  const sleutel = watchlistSleutel(show.titel, show.theaterId);
  docs = {
    'users/u1': {
      profielGevraagd: true,
      watchlist: [{ sleutel, titel: show.titel, theaterId: show.theaterId, toegevoegdOp: 100, v: 4 }],
      watchlistVerwijderd: [],
      gezien: [{
        sleutel: 'oude voorstelling', titel: 'Oude voorstelling', sleutelTitel: 'Oude voorstelling', theaterId: 'ita', bron: 'handmatig',
        toegevoegdOp: 50, gewijzigdOp: 60, v: 4, beoordeling: 4, beoordeeldOp: 70,
        bezoeken: [{ datum: '2026-05-01', tijd: '20:00', theaterId: 'ita', zaal: 'Rabozaal', genre: 'Toneel' }],
      }],
      gezienVerwijderd: [],
      gepland: [],
      geplandVerwijderd: [],
    },
    'profielen/u1': { gebruikersnaam: 'Anna_V', gebruikersnaamLaag: 'anna_v', naam: 'Anna de Vries', aangemaaktOp: 1, gewijzigdOp: 1, v: 1 },
    'usernames/anna_v': { uid: 'u1', gebruikersnaam: 'Anna_V', naam: 'Anna de Vries' },
  };

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

async function openApp({ gebruiker = ANNA, beginDocs = docs, hash = '#/profiel', offline = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  await ctx.route(`${base}js/firebase.js`, (r) => r.fulfill({ contentType: 'text/javascript', body: nepFirebase({ gebruiker, docs: beginDocs }) }));
  if (offline) await ctx.addInitScript(() => { window.__nepOffline = true; });
  const page = await ctx.newPage();
  const fouten = [];
  page.on('pageerror', (e) => fouten.push(e.message));
  await page.goto(`${base}${hash}`);
  await page.waitForSelector('.nav-item', { state: 'attached' });
  await page.waitForTimeout(500);
  return { ctx, page, fouten };
}

const opslag = (page, pad) => page.evaluate((p) => window.__nepFirestore.get(p) ?? null, pad);
const delenSchrijf = (page) => page.evaluate(() => window.__nepSchrijf.filter(([, p]) => p.startsWith('gedeeld/')));
const alles = (page) => page.evaluate(() => Object.fromEntries(window.__nepFirestore));
const hash = (page) => new URL(page.url()).hash;
const tekst = (page, sel) => page.textContent(sel);

test('uitgelogd: geen melding en geen tegels', async () => {
  const { ctx, page, fouten } = await openApp({ gebruiker: null, beginDocs: {} });
  assert.equal(await page.locator('.delen-melding').count(), 0);
  assert.equal(await page.isVisible('#profielTegels'), false);
  await page.goto(`${base}#/profiel/delen`);
  await page.waitForTimeout(300);
  assert.equal(hash(page), '#/profiel');
  assert.deepEqual(fouten, []);
  await ctx.close();
});

test('eenmalige melding: er wordt niets gedeeld tot "Oké"; daarna instelling en kopieën', async () => {
  const { ctx, page, fouten } = await openApp();
  assert.match(await tekst(page, '.delen-melding'), /Je vrienden kunnen je Gezien \(met sterren\) en Watchlist zien/);
  assert.match(await tekst(page, '#delenTegel'), /Nog niet ingesteld/);
  await page.waitForTimeout(3500); // langer dan de debounce
  assert.deepEqual(await delenSchrijf(page), []);

  await page.click('.delen-melding >> text=Oké');
  await page.waitForTimeout(300);
  assert.equal(await page.locator('.delen-melding').count(), 0);
  assert.match(await tekst(page, '#delenTegel'), /Gezien en Watchlist/);
  const instelling = await opslag(page, 'gedeeld/u1');
  assert.equal(instelling.gezien, true);
  assert.equal(instelling.watchlist, true);
  const watchlist = await opslag(page, 'gedeeld/u1/onderdelen/watchlist');
  assert.deepEqual(Object.keys(watchlist).sort(), ['bijgewerktOp', 'items', 'nv', 'stand', 'v']);
  assert.equal(watchlist.items.length, 1);
  assert.deepEqual(Object.keys(watchlist.items[0]).filter((k) => !['sleutel', 'titel', 'maker', 'genre'].includes(k)), []);
  assert.equal(watchlist.stand, 100);
  const gezien = await opslag(page, 'gedeeld/u1/onderdelen/gezien');
  assert.deepEqual(gezien.items, [{ sleutel: 'oude voorstelling', titel: 'Oude voorstelling', genre: 'Toneel', beoordeling: 4, laatsteBezoek: '2026-05-01', aantal: 1 }]);
  assert.ok(!JSON.stringify(gezien).includes('Rabozaal'));
  assert.deepEqual(fouten, []);
  await ctx.close();
});

test('"Aanpassen": terug zonder keuze deelt niets; een keuze met Opslaan wel', async () => {
  const { ctx, page, fouten } = await openApp();
  await page.click('.delen-melding >> text=Aanpassen');
  await page.waitForTimeout(200);
  assert.equal(hash(page), '#/profiel/delen');
  assert.equal(await page.getAttribute('#delenSchakelaar-gezien', 'aria-checked'), 'true');
  assert.equal(await page.getAttribute('#delenSchakelaar-watchlist', 'aria-checked'), 'true');
  await page.click('#delenSchakelaar-watchlist');
  assert.equal(await page.getAttribute('#delenSchakelaar-watchlist', 'aria-checked'), 'false');
  await page.click('#delenBack');
  await page.waitForTimeout(300);
  assert.equal(hash(page), '#/profiel');
  assert.deepEqual(await delenSchrijf(page), []);
  assert.equal(await page.locator('.delen-melding').count(), 1);

  await page.click('.delen-melding >> text=Aanpassen');
  await page.waitForTimeout(200);
  await page.click('#delenSchakelaar-watchlist');
  await page.click('#delenInhoud >> text=Opslaan');
  await page.waitForTimeout(300);
  assert.deepEqual({ ...(await opslag(page, 'gedeeld/u1')), gewijzigdOp: 0 }, { gezien: true, watchlist: false, gewijzigdOp: 0 });
  assert.ok(await opslag(page, 'gedeeld/u1/onderdelen/gezien'));
  assert.equal(await opslag(page, 'gedeeld/u1/onderdelen/watchlist'), null);
  assert.match(await tekst(page, '#delenInhoud'), /Opgeslagen/);
  assert.equal(await page.locator('#delenInhoud >> text=Opslaan').count(), 0);
  assert.deepEqual(fouten, []);
  await ctx.close();
});

test('uitzetten haalt de kopie weg, weer aanzetten schrijft hem opnieuw', async () => {
  const beginDocs = { ...docs, 'gedeeld/u1': { gezien: true, watchlist: true, gewijzigdOp: 1 } };
  const { ctx, page, fouten } = await openApp({ beginDocs, hash: '#/profiel/delen' });
  await page.waitForTimeout(3500); // eerste kopieën na de sync
  assert.ok(await opslag(page, 'gedeeld/u1/onderdelen/gezien'));
  await page.click('#delenSchakelaar-gezien');
  await page.waitForTimeout(300);
  assert.equal(await page.getAttribute('#delenSchakelaar-gezien', 'aria-checked'), 'false');
  assert.equal(await opslag(page, 'gedeeld/u1/onderdelen/gezien'), null);
  assert.equal((await opslag(page, 'gedeeld/u1')).gezien, false);
  await page.click('#delenSchakelaar-gezien');
  await page.waitForTimeout(300);
  assert.ok(await opslag(page, 'gedeeld/u1/onderdelen/gezien'));
  assert.deepEqual(fouten, []);
  await ctx.close();
});

test('kopie: met debounce, en geen schrijfactie als er niets veranderd is (ook niet op een tweede apparaat)', async () => {
  const beginDocs = { ...docs, 'gedeeld/u1': { gezien: true, watchlist: true, gewijzigdOp: 1 } };
  const een = await openApp({ beginDocs });
  await een.page.waitForTimeout(3500);
  assert.equal((await delenSchrijf(een.page)).length, 2); // eerste keer beide kopieën
  const stand = await alles(een.page);
  await een.ctx.close();

  // Tweede apparaat met dezelfde data: niets te schrijven.
  const twee = await openApp({ beginDocs: stand, hash: `#/show/${encodeURIComponent(show.id)}` });
  await twee.page.waitForTimeout(3500);
  assert.deepEqual(await delenSchrijf(twee.page), []);

  // Twee tikken (eraf en er weer op): na de debounce één schrijfactie,
  // alleen voor de watchlist (de stand is veranderd, de inhoud niet: geen schrijfactie).
  await twee.page.click('#detailWatchBtn');
  await twee.page.click('#detailWatchBtn');
  await twee.page.waitForTimeout(3500);
  assert.deepEqual(await delenSchrijf(twee.page), []);
  // Eén tik (eraf): pas na de debounce, één keer.
  await twee.page.click('#detailWatchBtn');
  await twee.page.waitForTimeout(1000);
  assert.deepEqual(await delenSchrijf(twee.page), []);
  await twee.page.waitForTimeout(2500);
  assert.deepEqual(await delenSchrijf(twee.page), [['set', 'gedeeld/u1/onderdelen/watchlist']]);
  assert.equal((await opslag(twee.page, 'gedeeld/u1/onderdelen/watchlist')).items.length, 0);
  assert.deepEqual(twee.fouten, []);
  await twee.ctx.close();
});

test('offline: opslaan geeft een nette melding en slaat niets op; de app blijft werken', async () => {
  const { ctx, page, fouten } = await openApp({ offline: true });
  // Ook het profiel laadt dan niet; weer online en profiel opnieuw laden.
  await page.evaluate(() => { window.__nepOffline = false; });
  await page.click('.profiel-regel .text-btn-small');
  await page.waitForTimeout(400);
  assert.match(await tekst(page, '.delen-melding'), /Je vrienden kunnen/);
  // Nu het scherm offline openen en een keuze opslaan: melding, niets opgeslagen.
  await page.click('.delen-melding >> text=Aanpassen');
  await page.waitForTimeout(200);
  await page.evaluate(() => { window.__nepOffline = true; });
  await page.click('#delenInhoud >> text=Opslaan');
  await page.waitForTimeout(300);
  assert.match(await tekst(page, '#delenInhoud'), /Controleer je verbinding/);
  assert.equal(await opslag(page, 'gedeeld/u1'), null);
  await page.click('#delenBack');
  await page.click('.nav-item[data-tab="agenda"]');
  assert.equal(await page.isVisible('#screen-agenda'), true);
  assert.deepEqual(fouten, []);
  await ctx.close();
});
