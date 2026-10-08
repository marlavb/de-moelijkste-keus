// UI-test voor Mail in Profiel (stap 5): tegel, schakelaar (standaard aan),
// uitzetten en aanzetten (mailvoorkeur), uitgelogd eerst inloggen (de link in
// de mail), en offline. Echte app uit public/; Firebase is nepFirebase.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

import { nepFirebase } from './nepFirebase.js';
import { TIJDZONE } from './datum.js';

const ROOT = new URL('../public/', import.meta.url).pathname;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };
const BOB = { uid: 'u2', displayName: 'Bob Jansen', email: 'bob@example.com', photoURL: null };
const DOCS = {
  'users/u2': { profielGevraagd: true },
  'profielen/u2': { gebruikersnaam: 'bob', gebruikersnaamLaag: 'bob', naam: 'Bob Jansen', aangemaaktOp: 1, gewijzigdOp: 1, v: 1 },
  'gedeeld/u2': { gezien: true, watchlist: true, gewijzigdOp: 1 },
};
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

async function openApp({ gebruiker = BOB, docs = DOCS, hash = '#/profiel' } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block', timezoneId: TIJDZONE });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  await ctx.route(`${base}js/firebase.js`, (r) => r.fulfill({ contentType: 'text/javascript', body: nepFirebase({ gebruiker, docs }) }));
  const page = await ctx.newPage();
  const fouten = [];
  page.on('pageerror', (e) => fouten.push(e.message));
  await page.goto(`${base}${hash}`);
  await page.waitForSelector('.nav-item', { state: 'attached' });
  await page.waitForTimeout(500);
  return { ctx, page, fouten };
}
const opslag = (page, pad) => page.evaluate((p) => window.__nepFirestore.get(p) ?? null, pad);

test('tegel → Mail: standaard aan; uitzetten en weer aanzetten schrijft mailvoorkeur; terug naar Profiel', async () => {
  const { ctx, page, fouten } = await openApp();
  await page.click('#mailTegel');
  await page.waitForSelector('#mailSchakelaar');
  assert.equal(new URL(page.url()).hash, '#/profiel/mail');
  assert.equal(await page.isVisible('#bottomNav'), false);
  assert.equal(await page.getAttribute('#mailSchakelaar', 'aria-checked'), 'true');
  await page.click('#mailSchakelaar');
  await page.waitForTimeout(200);
  assert.equal(await page.getAttribute('#mailSchakelaar', 'aria-checked'), 'false');
  assert.equal((await opslag(page, 'mailvoorkeur/u2')).uitnodigingen, false);
  assert.match(await page.textContent('#mailInhoud'), /geen mail meer bij uitnodigingen/);
  await page.click('#mailSchakelaar');
  await page.waitForTimeout(200);
  assert.equal((await opslag(page, 'mailvoorkeur/u2')).uitnodigingen, true);
  await page.click('#mailBack');
  await page.waitForTimeout(200);
  assert.equal(new URL(page.url()).hash, '#/profiel');
  assert.deepEqual(fouten, []);
  await ctx.close();
});

test('opgeslagen "uit" wordt bij openen getoond', async () => {
  const { ctx, page, fouten } = await openApp({ docs: { ...DOCS, 'mailvoorkeur/u2': { uitnodigingen: false, gewijzigdOp: 1 } }, hash: '#/profiel/mail' });
  assert.equal(await page.getAttribute('#mailSchakelaar', 'aria-checked'), 'false');
  assert.deepEqual(fouten, []);
  await ctx.close();
});

test('uitgelogd (de link in de mail): eerst inloggen', async () => {
  const { ctx, page, fouten } = await openApp({ gebruiker: null, docs: {}, hash: '#/profiel/mail' });
  assert.match(await page.textContent('#mailInhoud'), /Log in om je mailinstelling/);
  assert.equal(await page.isVisible('#mailInhoud .google-btn'), true);
  assert.deepEqual(fouten, []);
  await ctx.close();
});

test('offline: laden en opslaan geven een nette melding', async () => {
  const { ctx, page, fouten } = await openApp();
  await page.evaluate(() => { window.__nepOffline = true; });
  await page.click('#mailTegel');
  await page.waitForTimeout(300);
  assert.match(await page.textContent('#mailInhoud'), /kon niet worden geladen/);
  await page.evaluate(() => { window.__nepOffline = false; });
  await page.click('#mailInhoud >> text="Opnieuw proberen"');
  await page.waitForSelector('#mailSchakelaar');
  await page.evaluate(() => { window.__nepOffline = true; });
  await page.click('#mailSchakelaar');
  await page.waitForTimeout(300);
  assert.match(await page.textContent('#mailInhoud'), /Controleer je verbinding/);
  assert.equal(await page.getAttribute('#mailSchakelaar', 'aria-checked'), 'true');
  assert.equal(await opslag(page, 'mailvoorkeur/u2'), null);
  assert.deepEqual(fouten, []);
  await ctx.close();
});
