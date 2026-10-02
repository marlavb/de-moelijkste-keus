// UI-test voor vrienden (stap 2): de tegel in Profiel, zoeken op exacte
// gebruikersnaam, verzoeken, accepteren, verbreken, blokkeren en
// deblokkeren, de neutrale melding bij een blokkade, offline, en terug.
// Echte app uit public/; Firebase vervangen door nepFirebase (Firestore in
// het geheugen, zonder rules: die staan in firebase/tests/vrienden.test.js).

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

const profiel = (gebruikersnaam, naam) => ({ gebruikersnaam, gebruikersnaamLaag: gebruikersnaam.toLowerCase(), naam, aangemaaktOp: 1, gewijzigdOp: 1, v: 1 });
const BASIS = {
  'users/u1': { profielGevraagd: true },
  'profielen/u1': profiel('Anna_V', 'Anna de Vries'),
  'usernames/anna_v': { uid: 'u1', gebruikersnaam: 'Anna_V', naam: 'Anna de Vries' },
  'profielen/u2': profiel('bob', 'Bob Jansen'),
  'usernames/bob': { uid: 'u2', gebruikersnaam: 'bob', naam: 'Bob Jansen' },
  'profielen/u3': profiel('carol', 'Carol Smit'),
  'usernames/carol': { uid: 'u3', gebruikersnaam: 'carol', naam: 'Carol Smit' },
};
const VERZOEK_BOB = {
  'vriendverzoeken/u2_u1': { van: 'u2', naar: 'u1', vanGebruikersnaam: 'bob', vanNaam: 'Bob Jansen', naarGebruikersnaam: 'Anna_V', naarNaam: 'Anna de Vries', aangemaaktOp: 1 },
};
const VRIENDEN_BOB = {
  'vrienden/u1/lijst/u2': { uid: 'u2', sinds: 1, via: 'verzoek' },
  'vrienden/u2/lijst/u1': { uid: 'u1', sinds: 1, via: 'verzoek' },
};

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

async function openApp({ gebruiker = ANNA, docs = BASIS, hash = '#/profiel', offline = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  await ctx.route(`${base}js/firebase.js`, (r) => r.fulfill({ contentType: 'text/javascript', body: nepFirebase({ gebruiker, docs }) }));
  if (offline) await ctx.addInitScript(() => { window.__nepOffline = true; });
  const page = await ctx.newPage();
  const fouten = [];
  page.on('pageerror', (e) => fouten.push(e.message));
  await page.goto(`${base}${hash}`);
  // 'attached': op sommige schermen (Vrienden, profiel instellen) is de onderbalk verborgen.
  await page.waitForSelector('.nav-item', { state: 'attached' });
  await page.waitForTimeout(400);
  return { ctx, page, fouten };
}

const opslag = (page, pad) => page.evaluate((p) => window.__nepFirestore.get(p) ?? null, pad);
const hash = (page) => new URL(page.url()).hash;
const tekst = (page, sel) => page.textContent(sel);
const even = (page) => page.waitForTimeout(250);

async function zoek(page, naam) {
  await page.fill('#vriendZoekInput', naam);
  await page.click('#vriendZoekForm button[type="submit"]');
  await even(page);
}

test('uitgelogd: geen tegel; #/vrienden stuurt terug naar Profiel', async () => {
  const { ctx, page, fouten } = await openApp({ gebruiker: null, docs: {} });
  assert.equal(await page.isVisible('#profielTegels'), false);
  await page.goto(`${base}#/vrienden`);
  await page.waitForTimeout(400);
  assert.equal(hash(page), '#/profiel');
  assert.deepEqual(fouten, []);
  await ctx.close();
});

test('ingelogd zonder profiel: geen tegel; het scherm vraagt eerst een gebruikersnaam', async () => {
  const { ctx, page, fouten } = await openApp({ docs: { 'users/u1': { profielGevraagd: true } } });
  assert.equal(await page.isVisible('#profielTegels'), false);
  await page.goto(`${base}#/vrienden`);
  await page.waitForTimeout(400);
  assert.match(await tekst(page, '#vriendenInhoud'), /Kies eerst een gebruikersnaam/);
  assert.equal(await page.isVisible('#vriendToevoegen'), false);
  await page.click('#vriendenInhoud .btn-secondary');
  await even(page);
  assert.equal(hash(page), '#/profiel/instellen');
  assert.deepEqual(fouten, []);
  await ctx.close();
});

test('tegel met teller; accepteren maakt vrienden (beide kanten, verzoek weg); terug naar Profiel', async () => {
  const { ctx, page, fouten } = await openApp({ docs: { ...BASIS, ...VERZOEK_BOB } });
  assert.match(await tekst(page, '#vriendenTegel'), /Vrienden.*1 nieuw verzoek/);
  assert.equal(await tekst(page, '#vriendenTegel .badge'), '1');
  await page.click('#vriendenTegel');
  await even(page);
  assert.equal(hash(page), '#/vrienden');
  assert.equal(await page.isVisible('#bottomNav'), false);
  assert.match(await tekst(page, '#vriendenInhoud'), /Verzoeken voor jou.*@bob · Bob Jansen/s);

  await page.click('button[aria-label="Verzoek van @bob accepteren"]');
  await even(page);
  assert.ok(await opslag(page, 'vrienden/u1/lijst/u2'));
  assert.ok(await opslag(page, 'vrienden/u2/lijst/u1'));
  assert.equal(await opslag(page, 'vriendverzoeken/u2_u1'), null);
  assert.match(await tekst(page, '.vrienden-melding'), /Je bent nu vrienden met @bob/);
  assert.match(await tekst(page, '#vriendenInhoud'), /Vrienden@bob · Bob Jansen/);

  await page.click('#vriendenBack');
  await even(page);
  assert.equal(hash(page), '#/profiel');
  assert.equal(await page.locator('#vriendenTegel .badge').count(), 0);
  assert.deepEqual(fouten, []);
  await ctx.close();
});

test('weigeren en intrekken', async () => {
  const docs = {
    ...BASIS,
    ...VERZOEK_BOB,
    'vriendverzoeken/u1_u3': { van: 'u1', naar: 'u3', vanGebruikersnaam: 'Anna_V', vanNaam: 'Anna de Vries', naarGebruikersnaam: 'carol', naarNaam: 'Carol Smit', aangemaaktOp: 1 },
  };
  const { ctx, page, fouten } = await openApp({ docs, hash: '#/vrienden' });
  assert.match(await tekst(page, '#vriendenInhoud'), /Verstuurd@carol · Carol Smit/);
  await page.click('button[aria-label="Verzoek van @bob weigeren"]');
  await even(page);
  assert.equal(await opslag(page, 'vriendverzoeken/u2_u1'), null);
  assert.equal(await opslag(page, 'vrienden/u1/lijst/u2'), null);
  await page.click('button[aria-label="Verzoek aan @carol intrekken"]');
  await even(page);
  assert.equal(await opslag(page, 'vriendverzoeken/u1_u3'), null);
  assert.doesNotMatch(await tekst(page, '#vriendenInhoud'), /Verstuurd|Verzoeken voor jou/);
  assert.deepEqual(fouten, []);
  await ctx.close();
});

test('zoeken op exacte gebruikersnaam en een verzoek sturen; nette meldingen', async () => {
  const { ctx, page, fouten } = await openApp({ hash: '#/vrienden' });
  await zoek(page, 'bo');
  assert.match(await tekst(page, '#vriendZoekResultaat'), /Vul een volledige gebruikersnaam in/);
  await zoek(page, 'bobb');
  assert.match(await tekst(page, '#vriendZoekResultaat'), /Niemand gevonden met deze gebruikersnaam/);
  await zoek(page, 'anna_v');
  assert.match(await tekst(page, '#vriendZoekResultaat'), /Dat ben je zelf/);

  await zoek(page, '@BOB');
  assert.match(await tekst(page, '#vriendZoekResultaat'), /@bob · Bob Jansen/);
  await page.click('button[aria-label="Vriendschapsverzoek sturen aan @bob"]');
  await even(page);
  assert.match(await tekst(page, '#vriendZoekResultaat'), /Verzoek verstuurd aan @bob/);
  assert.deepEqual(await opslag(page, 'vriendverzoeken/u1_u2'), {
    van: 'u1', naar: 'u2', vanGebruikersnaam: 'Anna_V', vanNaam: 'Anna de Vries',
    naarGebruikersnaam: 'bob', naarNaam: 'Bob Jansen', aangemaaktOp: (await opslag(page, 'vriendverzoeken/u1_u2')).aangemaaktOp,
  });
  assert.match(await tekst(page, '#vriendenInhoud'), /Verstuurd@bob/);
  // Nog eens zoeken: "Verzoek verstuurd" in plaats van een knop.
  await zoek(page, 'bob');
  assert.match(await tekst(page, '#vriendZoekResultaat'), /Verzoek verstuurd/);
  assert.equal(await page.locator('#vriendZoekResultaat button').count(), 0);
  assert.deepEqual(fouten, []);
  await ctx.close();
});

test('verzoek aan iemand die jou al een verzoek stuurde: meteen vrienden', async () => {
  const { ctx, page, fouten } = await openApp({ docs: { ...BASIS, ...VERZOEK_BOB }, hash: '#/vrienden' });
  await zoek(page, 'bob');
  assert.match(await tekst(page, '#vriendZoekResultaat'), /Heeft jou een verzoek gestuurd/);
  await page.click('#vriendZoekResultaat button[aria-label="Verzoek van @bob accepteren"]');
  await even(page);
  assert.match(await tekst(page, '#vriendZoekResultaat'), /Jullie zijn nu vrienden/);
  assert.ok(await opslag(page, 'vrienden/u1/lijst/u2'));
  assert.equal(await opslag(page, 'vriendverzoeken/u2_u1'), null);
  assert.equal(await opslag(page, 'vriendverzoeken/u1_u2'), null);
  assert.deepEqual(fouten, []);
  await ctx.close();
});

test('geweigerd door de rules (bv. geblokkeerd door de ander): neutrale melding', async () => {
  const { ctx, page, fouten } = await openApp({ hash: '#/vrienden' });
  await page.evaluate(() => { window.__nepWeiger = (pad) => pad.startsWith('vriendverzoeken/'); });
  await zoek(page, 'carol');
  await page.click('button[aria-label="Vriendschapsverzoek sturen aan @carol"]');
  await even(page);
  assert.equal((await tekst(page, '#vriendZoekResultaat')).trim(), 'Verzoek kan niet worden verstuurd.');
  assert.equal(await opslag(page, 'vriendverzoeken/u1_u3'), null);
  assert.deepEqual(fouten, []);
  await ctx.close();
});

test('vriendenmenu: verbreken met bevestiging; blokkeren en deblokkeren', async () => {
  const docs = { ...BASIS, ...VRIENDEN_BOB, 'vrienden/u1/lijst/u3': { uid: 'u3', sinds: 1, via: 'verzoek' }, 'vrienden/u3/lijst/u1': { uid: 'u1', sinds: 1, via: 'verzoek' } };
  const { ctx, page, fouten } = await openApp({ docs, hash: '#/vrienden' });
  assert.match(await tekst(page, '#vriendenInhoud'), /@bob · Bob Jansen.*@carol · Carol Smit/s);

  // Verbreken, eerst annuleren.
  await page.click('button[aria-label="Opties voor @bob"]');
  assert.equal(await page.getAttribute('button[aria-label="Opties voor @bob"]', 'aria-expanded'), 'true');
  await page.click('.vriend-menu >> text=Vriendschap verbreken');
  assert.match(await tekst(page, '.vriend-menu'), /Vriendschap met @bob verbreken\?/);
  await page.click('.vriend-menu >> text=Annuleren');
  assert.equal(await page.locator('.vriend-menu').count(), 0);
  assert.ok(await opslag(page, 'vrienden/u1/lijst/u2'));
  await page.click('button[aria-label="Opties voor @bob"]');
  await page.click('.vriend-menu >> text=Vriendschap verbreken');
  await page.click('.vriend-menu >> text=Ja, verbreken');
  await even(page);
  assert.equal(await opslag(page, 'vrienden/u1/lijst/u2'), null);
  assert.equal(await opslag(page, 'vrienden/u2/lijst/u1'), null);
  assert.match(await tekst(page, '.vrienden-melding'), /geen vrienden meer met @bob/);

  // Blokkeren.
  await page.click('button[aria-label="Opties voor @carol"]');
  await page.click('.vriend-menu >> text=Blokkeren');
  assert.match(await tekst(page, '.vriend-menu'), /@carol blokkeren\?.*geen melding/);
  await page.click('.vriend-menu >> text=Ja, blokkeren');
  await even(page);
  assert.equal(await opslag(page, 'vrienden/u1/lijst/u3'), null);
  assert.equal(await opslag(page, 'vrienden/u3/lijst/u1'), null);
  assert.equal((await opslag(page, 'blokkades/u1/lijst/u3')).gebruikersnaam, 'carol');
  assert.match(await tekst(page, '#vriendenInhoud'), /Geblokkeerd@carol · Carol Smit/);
  assert.match(await tekst(page, '#vriendenInhoud'), /Nog geen vrienden/);

  // Zelf een verzoek sturen aan wie je blokkeert: duidelijke melding.
  await zoek(page, 'carol');
  await page.click('button[aria-label="Vriendschapsverzoek sturen aan @carol"]');
  await even(page);
  assert.match(await tekst(page, '#vriendZoekResultaat'), /Je hebt @carol geblokkeerd/);

  // Deblokkeren.
  await page.click('button[aria-label="@carol deblokkeren"]');
  await even(page);
  assert.equal(await opslag(page, 'blokkades/u1/lijst/u3'), null);
  assert.doesNotMatch(await tekst(page, '#vriendenInhoud'), /Geblokkeerd/);
  assert.deepEqual(fouten, []);
  await ctx.close();
});

test('een inkomend verzoek blokkeren haalt het verzoek weg', async () => {
  const { ctx, page, fouten } = await openApp({ docs: { ...BASIS, ...VERZOEK_BOB }, hash: '#/vrienden' });
  await page.click('button[aria-label="Opties voor @bob"]');
  await page.click('.vriend-menu >> text=Blokkeren');
  await page.click('.vriend-menu >> text=Ja, blokkeren');
  await even(page);
  assert.equal(await opslag(page, 'vriendverzoeken/u2_u1'), null);
  assert.ok(await opslag(page, 'blokkades/u1/lijst/u2'));
  assert.deepEqual(fouten, []);
  await ctx.close();
});

test('vrienden tonen de actuele naam uit het profiel', async () => {
  const docs = { ...BASIS, ...VRIENDEN_BOB, 'profielen/u2': profiel('Bobbie', 'Bob J.') };
  const { ctx, page, fouten } = await openApp({ docs, hash: '#/vrienden' });
  assert.match(await tekst(page, '#vriendenInhoud'), /@Bobbie · Bob J\./);
  assert.deepEqual(fouten, []);
  await ctx.close();
});

test('Firestore onbereikbaar: melding met Opnieuw; daarna laden; de app blijft werken', async () => {
  const { ctx, page, fouten } = await openApp({ docs: { ...BASIS, ...VERZOEK_BOB }, offline: true });
  assert.equal(await page.isVisible('#screen-profiel'), true);
  await page.evaluate(() => { window.__nepOffline = false; });
  await page.click('.profiel-regel .text-btn-small'); // profiel opnieuw laden
  await even(page);
  await page.evaluate(() => { window.__nepOffline = true; });
  await page.click('#vriendenTegel');
  await even(page);
  assert.match(await tekst(page, '#vriendenInhoud'), /konden niet worden geladen/);
  await page.evaluate(() => { window.__nepOffline = false; });
  await page.click('#vriendenInhoud >> text=Opnieuw proberen');
  await even(page);
  assert.match(await tekst(page, '#vriendenInhoud'), /Verzoeken voor jou/);
  // Actie terwijl offline: melding, lijst blijft staan.
  await page.evaluate(() => { window.__nepOffline = true; });
  await page.click('button[aria-label="Verzoek van @bob accepteren"]');
  await even(page);
  assert.match(await tekst(page, '#vriendenInhoud'), /Controleer je verbinding/);
  assert.match(await tekst(page, '#vriendenInhoud'), /@bob · Bob Jansen/);
  await page.click('#vriendenBack');
  await even(page);
  await page.click('.nav-item[data-tab="agenda"]');
  assert.equal(await page.isVisible('#screen-agenda'), true);
  assert.deepEqual(fouten, []);
  await ctx.close();
});

test('direct geopend (#/vrienden zonder geschiedenis): terug gaat naar Profiel', async () => {
  const { ctx, page, fouten } = await openApp({ hash: '#/vrienden' });
  assert.equal(await page.isVisible('#screen-vrienden'), true);
  await page.click('#vriendenBack');
  await even(page);
  assert.equal(hash(page), '#/profiel');
  assert.deepEqual(fouten, []);
  await ctx.close();
});
