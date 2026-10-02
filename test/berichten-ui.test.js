// UI-test voor Berichten (stap 4b): de teller (live) op de tegel en de
// Profiel-tab, openen (gelezen, opruimen na 60 dagen), "Ik ga mee" en "Kan
// niet", de titel naar het detailscherm en terug, de actuele stand van een
// uitnodiging, berichten aan de organisator, alles als tekst (XSS), offline,
// uitgelogd, en "met wie" bij het bezoek in Gezien. Echte app uit public/;
// Firebase is nepFirebase (zonder rules: die staan in firebase/tests/plannen.test.js).

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

import { nepFirebase } from './nepFirebase.js';
import { planIn, legeGepland } from '../public/js/gepland.js';
import { speeldagVan } from '../public/js/plannen.js';

const ROOT = new URL('../public/', import.meta.url).pathname;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };
const ANNA = { uid: 'u1', displayName: 'Anna de Vries', email: 'anna@example.com', photoURL: null };
const BOB = { uid: 'u2', displayName: 'Bob Jansen', email: 'bob@example.com', photoURL: null };
const DAG = 24 * 3600 * 1000;
let server;
let base;
let browser;
let show;
let item;

const profiel = (gebruikersnaam, naam) => ({ gebruikersnaam, gebruikersnaamLaag: gebruikersnaam.toLowerCase(), naam, aangemaaktOp: 1, gewijzigdOp: 1, v: 1 });
const gebruiker = (uid, { gepland = [], gezien = [] } = {}) => ({
  [`users/${uid}`]: { profielGevraagd: true, gepland, geplandVerwijderd: [], watchlist: [], watchlistVerwijderd: [], gezien, gezienVerwijderd: [] },
  [`gedeeld/${uid}`]: { gezien: false, watchlist: false, gewijzigdOp: 1 },
});
const bericht = (soort, van, planId = 'P1', extra = {}) => ({ soort, van, planId, aangemaaktOp: Date.now(), gelezen: false, ...extra });
let BASIS;

function plan({ leden = [{ uid: 'u1', rol: 'organisator', status: 'gaat' }, { uid: 'u2', rol: 'gast', status: 'uitgenodigd' }], opgeheven = false, voorstelling = null, datum = null } = {}) {
  const v = voorstelling ?? { titel: item.titel, theaterId: item.theaterId, theaterNaam: item.theaterNaam, stad: item.stad, datum: datum ?? item.datum, tijd: item.tijd };
  const docs = {
    'plannen/P1': {
      eigenaar: 'u1', sleutel: item.sleutel, sleutelV: 4, voorstelling: v, speeldag: speeldagVan(v.datum).getTime(),
      genodigden: leden.filter((l) => l.rol === 'gast').map((l) => l.uid), opgeheven, aangemaaktOp: 1, gewijzigdOp: 1,
    },
  };
  for (const l of leden) docs[`plannen/P1/leden/${l.uid}`] = { planId: 'P1', uitgenodigdDoor: 'u1', uitgenodigdOp: 1, kaarten: false, ...l };
  return docs;
}

before(async () => {
  const data = JSON.parse(await readFile(path.join(ROOT, 'data/shows.json'), 'utf-8'));
  const shows = Array.isArray(data) ? data : data.shows;
  const vandaag = new Date().toISOString().slice(0, 10);
  show = shows.find((s) => s.datum > vandaag && s.tijd);
  item = planIn(legeGepland(), show, 100).gepland[0];
  BASIS = {
    'profielen/u1': profiel('Anna_V', 'Anna de Vries'),
    'profielen/u2': profiel('bob', 'Bob Jansen'),
    'vrienden/u1/lijst/u2': { uid: 'u2', sinds: 1, via: 'verzoek' },
    'vrienden/u2/lijst/u1': { uid: 'u1', sinds: 1, via: 'verzoek' },
    ...gebruiker('u1', { gepland: [{ ...item, planId: 'P1' }] }),
    ...gebruiker('u2'),
    ...plan(),
    'inbox/u2/berichten/m1': bericht('uitnodiging', 'u1'),
    'inbox/u2/berichten/m0': bericht('uitnodiging', 'u1', 'oud', { aangemaaktOp: Date.now() - 61 * DAG, gelezen: true }),
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

async function openApp({ wie = BOB, docs = BASIS, hash = '#/profiel', offline = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  await ctx.route(`${base}js/firebase.js`, (r) => r.fulfill({ contentType: 'text/javascript', body: nepFirebase({ gebruiker: wie, docs }) }));
  if (offline) await ctx.addInitScript(() => { window.__nepOffline = true; });
  const page = await ctx.newPage();
  const fouten = [];
  page.on('pageerror', (e) => fouten.push(e.message));
  page.on('dialog', (d) => { fouten.push(`dialoog: ${d.message()}`); d.dismiss(); });
  await page.goto(`${base}${hash}`);
  await page.waitForSelector('.nav-item', { state: 'attached' });
  await page.waitForTimeout(600);
  return { ctx, page, fouten };
}

const opslag = (page, pad) => page.evaluate((p) => window.__nepFirestore.get(p) ?? null, pad);
const inbox = (page, uid) => page.evaluate((u) => [...window.__nepFirestore.entries()].filter(([k]) => k.startsWith(`inbox/${u}/`)).map(([, v]) => `${v.van}:${v.soort}`), uid);
const hash = (page) => new URL(page.url()).hash;
const tekst = (page, sel) => page.textContent(sel);
const even = (page, ms = 300) => page.waitForTimeout(ms);
const tab = (page) => page.locator('.nav-item[data-tab="profiel"]');

test('uitgelogd: geen teller en geen tegel; #/berichten gaat naar Profiel', async () => {
  const { ctx, page, fouten } = await openApp({ wie: null, docs: {} });
  assert.equal(await page.isVisible('#profielBadge'), false);
  assert.equal(await page.locator('#berichtenTegel').count(), 0);
  await page.goto(`${base}#/berichten`);
  await even(page);
  assert.equal(hash(page), '#/profiel');
  assert.deepEqual(fouten, []);
  await ctx.close();
});

test('teller (live) op de tegel en de Profiel-tab; openen zet gelezen en ruimt oude berichten op', async () => {
  const { ctx, page, fouten } = await openApp();
  assert.equal(await tekst(page, '#profielBadge'), '1');
  assert.equal(await tab(page).getAttribute('aria-label'), 'Profiel, 1 ongelezen bericht');
  assert.match(await tekst(page, '#berichtenTegel'), /Berichten.*1 ongelezen/);

  await page.click('#berichtenTegel');
  await even(page, 500);
  assert.equal(hash(page), '#/berichten');
  const kaart = page.locator('.bericht').first();
  assert.match(await kaart.textContent(), new RegExp(`Nieuw@Anna_V nodigt je uit voor ${item.titel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  assert.match(await kaart.textContent(), new RegExp(`· ${item.tijd} · ${item.theaterNaam}`));
  assert.equal(await page.locator('.bericht').count(), 1); // het oude is opgeruimd
  assert.equal(await opslag(page, 'inbox/u2/berichten/m0'), null);
  assert.equal((await opslag(page, 'inbox/u2/berichten/m1')).gelezen, true);
  await even(page);
  assert.equal(await page.isVisible('#profielBadge'), false);
  assert.equal(await tab(page).getAttribute('aria-label'), null);
  assert.deepEqual(fouten, []);
  await ctx.close();
});

test('Ik ga mee: status in het plan, bericht aan de organisator, plan in eigen Gepland', async () => {
  const { ctx, page, fouten } = await openApp({ hash: '#/berichten' });
  await page.click('.bericht >> text=Ik ga mee');
  await even(page, 500);
  assert.equal((await opslag(page, 'plannen/P1/leden/u2')).status, 'gaat');
  assert.deepEqual(await inbox(page, 'u1'), ['u2:gaat-mee']);
  const gepland = (await opslag(page, 'users/u2')).gepland;
  assert.equal(gepland.length, 1);
  assert.equal(gepland[0].planId, 'P1');
  assert.equal(gepland[0].status, 'gepland');
  assert.match(await tekst(page, '#berichtenInhoud'), /Je gaat mee\. Het staat in je Gepland\./);
  assert.match(await tekst(page, '.bericht'), /Je gaat mee$/);
  // In Gepland: met wie.
  await page.click('#berichtenBack');
  await even(page, 600);
  assert.match(await tekst(page, '#geplandList .plan-samen-tekst'), /Met @Anna_V/);
  assert.deepEqual(fouten, []);
  await ctx.close();
});

test('Ik ga mee terwijl dezelfde voorstelling al gepland is: koppelen, niet verdubbelen', async () => {
  const docs = { ...BASIS, ...gebruiker('u2', { gepland: [{ ...item, status: 'kaarten' }] }) };
  const { ctx, page, fouten } = await openApp({ docs, hash: '#/berichten' });
  await page.click('.bericht >> text=Ik ga mee');
  await even(page, 500);
  const gepland = (await opslag(page, 'users/u2')).gepland;
  assert.equal(gepland.length, 1);
  assert.equal(gepland[0].planId, 'P1');
  assert.equal(gepland[0].status, 'kaarten');
  assert.deepEqual(fouten, []);
  await ctx.close();
});

test('Kan niet: status in het plan, bericht aan de organisator, niets in Gepland', async () => {
  const { ctx, page, fouten } = await openApp({ hash: '#/berichten' });
  await page.click('.bericht >> text=Kan niet');
  await even(page, 500);
  assert.equal((await opslag(page, 'plannen/P1/leden/u2')).status, 'kan-niet');
  assert.deepEqual(await inbox(page, 'u1'), ['u2:kan-niet']);
  assert.equal((await opslag(page, 'users/u2')).gepland.length, 0);
  assert.match(await tekst(page, '.bericht'), /Afgeslagen$/);
  assert.deepEqual(fouten, []);
  await ctx.close();
});

test('de titel opent het detailscherm; terug gaat naar Berichten', async () => {
  const { ctx, page, fouten } = await openApp({ hash: '#/profiel' });
  await page.click('#berichtenTegel');
  await even(page, 500);
  await page.click('.bericht-titel');
  await even(page);
  assert.match(hash(page), /^#\/show\//);
  await page.click('#detailBack');
  await even(page, 500);
  assert.equal(hash(page), '#/berichten');
  await page.click('#berichtenBack');
  await even(page);
  assert.equal(hash(page), '#/profiel');
  assert.deepEqual(fouten, []);
  await ctx.close();
});

test('de actuele stand: ingetrokken, opgeheven, verlopen', async () => {
  const gevallen = [
    [plan({ leden: [{ uid: 'u1', rol: 'organisator', status: 'gaat' }] }), /Ingetrokken$/],
    [plan({ opgeheven: true }), /Opgeheven$/],
    [plan({ datum: '2020-01-01' }), /Verlopen$/],
  ];
  for (const [planDocs, verwacht] of gevallen) {
    const docs = { ...BASIS };
    for (const k of Object.keys(docs)) if (k.startsWith('plannen/')) delete docs[k];
    const { ctx, page, fouten } = await openApp({ docs: { ...docs, ...planDocs }, hash: '#/berichten' });
    assert.match(await tekst(page, '.bericht'), verwacht);
    assert.equal(await page.locator('.bericht >> text=Ik ga mee').count(), 0);
    assert.deepEqual(fouten, []);
    await ctx.close();
  }
});

test('berichten aan de organisator: gaat mee, kan niet, gaat toch niet', async () => {
  const t = Date.now();
  const docs = {
    ...BASIS,
    ...plan({ leden: [{ uid: 'u1', rol: 'organisator', status: 'gaat' }, { uid: 'u2', rol: 'gast', status: 'weg' }] }),
    'inbox/u1/berichten/a': bericht('gaat-mee', 'u2', 'P1', { aangemaaktOp: t - 3000 }),
    'inbox/u1/berichten/b': bericht('kan-niet', 'u2', 'P1', { aangemaaktOp: t - 2000 }),
    'inbox/u1/berichten/c': bericht('weg', 'u2', 'P1', { aangemaaktOp: t - 1000 }),
  };
  const { ctx, page, fouten } = await openApp({ wie: ANNA, docs, hash: '#/berichten' });
  const teksten = await page.$$eval('.bericht-tekst', (els) => els.map((e) => e.textContent));
  assert.deepEqual(teksten, [`@bob gaat toch niet naar ${item.titel}`, `@bob kan niet naar ${item.titel}`, `@bob gaat mee naar ${item.titel}`]);
  assert.deepEqual(fouten, []);
  await ctx.close();
});

test('alles van anderen als gewone tekst (titel, theater en stad uit het plan)', async () => {
  const XSS = '<img src=x onerror="window.__xss=1">';
  const docs = {
    ...BASIS,
    ...plan({ voorstelling: { titel: `${XSS} Grip`, theaterId: 'nergens', theaterNaam: '<b>Theater</b>', stad: '<script>window.__xss=2</script>', datum: item.datum, tijd: item.tijd } }),
  };
  const { ctx, page, fouten } = await openApp({ docs, hash: '#/berichten' });
  assert.match(await tekst(page, '.bericht-tekst'), /<img src=x onerror="window.__xss=1"> Grip/);
  assert.match(await tekst(page, '.bericht-meta'), /<b>Theater<\/b>, <script>window.__xss=2<\/script>/);
  assert.equal(await page.locator('#berichtenInhoud img, #berichtenInhoud b, #berichtenInhoud script').count(), 0);
  await page.click('.bericht >> text=Ik ga mee');
  await even(page, 500);
  assert.equal(await page.evaluate(() => window.__xss ?? null), null);
  assert.deepEqual(fouten, []);
  await ctx.close();
});

test('rond middernacht: [Ik ga mee] tot 00:00 in Amsterdam, daarna "Verlopen" (zomer- en wintertijd)', async () => {
  for (const [datum, voor, na] of [
    ['2026-07-15', '2026-07-15T21:30:00Z', '2026-07-15T22:30:00Z'],
    ['2026-01-15', '2026-01-15T22:30:00Z', '2026-01-15T23:30:00Z'],
  ]) {
    const docs = { ...BASIS };
    for (const k of Object.keys(docs)) if (k.startsWith('plannen/')) delete docs[k];
    Object.assign(docs, plan({ datum }));
    for (const [tijd, verwacht] of [[voor, /Ik ga mee/], [na, /Verlopen$/]]) {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block', timezoneId: 'UTC' });
      await ctx.clock.setFixedTime(new Date(tijd));
      await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
      await ctx.route(`${base}js/firebase.js`, (r) => r.fulfill({ contentType: 'text/javascript', body: nepFirebase({ gebruiker: BOB, docs }) }));
      const page = await ctx.newPage();
      const fouten = [];
      page.on('pageerror', (e) => fouten.push(e.message));
      await page.goto(`${base}#/berichten`);
      await page.waitForSelector('.nav-item', { state: 'attached' });
      await page.waitForTimeout(600);
      assert.match(await tekst(page, '.bericht'), verwacht, `${datum} ${tijd}`);
      assert.deepEqual(fouten, []);
      await ctx.close();
    }
  }
});

test('offline: melding met Opnieuw; weer online laden', async () => {
  const { ctx, page, fouten } = await openApp({ hash: '#/profiel' });
  await page.evaluate(() => { window.__nepOffline = true; });
  await page.click('#berichtenTegel');
  await even(page, 500);
  assert.match(await tekst(page, '#berichtenInhoud'), /konden niet worden geladen/);
  await page.evaluate(() => { window.__nepOffline = false; });
  await page.click('#berichtenInhoud >> text=Opnieuw proberen');
  await even(page, 500);
  assert.equal(await page.locator('.bericht').count(), 1);
  assert.deepEqual(fouten, []);
  await ctx.close();
});

test('met wie bij het bezoek in Gezien (alleen voor jezelf)', async () => {
  const docs = {
    ...BASIS,
    ...gebruiker('u2', {
      gezien: [{
        sleutel: 'oud stuk', titel: 'Oud stuk', sleutelTitel: 'Oud stuk', theaterId: 'ita', bron: 'planning', toegevoegdOp: 1, gewijzigdOp: 1, v: 4,
        bezoeken: [{ datum: '2026-05-01', tijd: '20:00', theaterId: 'ita', metWie: ['@Anna_V'] }],
      }],
    }),
  };
  const { ctx, page, fouten } = await openApp({ docs });
  assert.match(await tekst(page, '#gezienList'), /met @Anna_V/);
  assert.deepEqual(fouten, []);
  await ctx.close();
});
