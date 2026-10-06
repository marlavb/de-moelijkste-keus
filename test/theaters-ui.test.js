// UI-test voor het provincievinkje op het tabblad Theaters (okt 2026):
// aan/uit/deels, samen met de schakelaars per theater, uitgelogd
// (localStorage) en ingelogd (nep-Firestore, één schrijfactie per tik).
// Echte app en echte data uit public/; geen netwerk naar buiten.

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
const PROVINCIE = 'Zuid-Holland';
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

async function openApp({ gebruiker = null, docs = {}, viewport = { width: 390, height: 844 } } = {}) {
  const ctx = await browser.newContext({ viewport, serviceWorkers: 'block' });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  await ctx.route(`${base}js/firebase.js`, (r) => r.fulfill({ contentType: 'text/javascript', body: nepFirebase({ gebruiker, docs }) }));
  const page = await ctx.newPage();
  page.fouten = [];
  page.on('pageerror', (e) => page.fouten.push(e.message));
  await page.goto(`${base}#/theaters`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.provincie-vak');
  await page.waitForTimeout(300);
  return { ctx, page };
}

const vak = (page, provincie = PROVINCIE) => page.getByRole('checkbox', { name: `Alle theaters in ${provincie}` });
const stand = (page, provincie = PROVINCIE) => vak(page, provincie).evaluate((v) => (v.indeterminate ? 'deels' : v.checked ? 'aan' : 'uit'));

/** Schakelaars (aria-checked) per provincie, uit de opbouw van het scherm. */
const schakelaars = (page) =>
  page.evaluate(() => {
    const uit = {};
    let huidig = null;
    for (const el of document.querySelector('#theatersList').children) {
      if (el.classList.contains('theaters-province-head')) {
        huidig = el.querySelector('h2').textContent;
        uit[huidig] = [];
      } else if (huidig) {
        for (const s of el.querySelectorAll('.switch')) uit[huidig].push(s.getAttribute('aria-checked') === 'true');
      }
    }
    return uit;
  });

const enabled = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('podiumagenda:enabledTheaters') ?? '{}'));

test('uitgelogd: provincievinkje zet alles uit en aan; deels na één schakelaar; tik bij deels zet alles aan', async () => {
  const { ctx, page } = await openApp();
  const voor = await schakelaars(page);
  assert.ok(voor[PROVINCIE].length >= 2, 'genoeg theaters in de provincie');
  assert.equal(await stand(page), 'aan');
  // Echt selectievakje met een label; tikvlak minstens 44 × 44.
  assert.equal(await vak(page).getAttribute('type'), 'checkbox');
  const vlak = await page.locator('.provincie-vinkje', { has: vak(page) }).boundingBox();
  assert.ok(vlak.width >= 44 && vlak.height >= 44, JSON.stringify(vlak));

  // Namen van de theaters in de provincie (uit de schakelaars).
  const namen = await page.evaluate((prov) => {
    const uit = [];
    let binnen = false;
    for (const el of document.querySelector('#theatersList').children) {
      if (el.classList.contains('theaters-province-head')) binnen = el.querySelector('h2').textContent === prov;
      else if (binnen) for (const sw of el.querySelectorAll('.switch')) uit.push(sw.getAttribute('aria-label').replace(/ in agenda tonen$/, ''));
    }
    return uit;
  }, PROVINCIE);
  await vak(page).click();
  assert.equal(await stand(page), 'uit');
  let na = await schakelaars(page);
  assert.ok(na[PROVINCIE].every((x) => x === false));
  // Andere provincies blijven zoals ze waren.
  for (const p of Object.keys(voor)) if (p !== PROVINCIE) assert.deepEqual(na[p], voor[p], p);
  const e = await enabled(page);
  // Ook de gepauzeerde theaters van de provincie (Isala, Kruispunt) volgen de keuze.
  assert.equal(e.isala, false);
  assert.equal(e.kruispunt, false);
  assert.notEqual(e.delamar, false);

  // Agenda: geen voorstellingen meer uit deze provincie.
  await page.click('.bottom-nav [data-tab="agenda"]');
  await page.waitForTimeout(300);
  const metas = await page.locator('#agendaList .show-meta').allInnerTexts();
  assert.ok(metas.length > 0);
  assert.ok(!metas.some((t) => namen.some((n) => t.startsWith(`${n} ·`))), 'geen theaters uit de provincie in de agenda');
  await page.click('.bottom-nav [data-tab="theaters"]');
  await page.waitForTimeout(300);

  // Weer aan.
  await vak(page).click();
  assert.equal(await stand(page), 'aan');
  // Eén theater uit via zijn eigen schakelaar → deels (voorgelezen als gemengd).
  const eersteStad = page.locator('#theatersList .theaters-province-head', { hasText: PROVINCIE }).locator('xpath=following-sibling::div[contains(@class,"theaters-city-section")][.//button[contains(@class,"switch")]][1]');
  await eersteStad.locator('.theaters-city-header > span').last().click(); // niet op "Alles uit"
  await eersteStad.locator('.switch').first().click();
  assert.equal(await stand(page), 'deels');
  assert.match(await vak(page).ariaSnapshot(), /checkbox "Alle theaters in Zuid-Holland" \[checked=mixed\]/);
  // Tik bij deels: alles aan.
  await vak(page).click();
  assert.equal(await stand(page), 'aan');
  na = await schakelaars(page);
  assert.ok(na[PROVINCIE].every((x) => x === true));
  // Herladen: de keuze blijft (localStorage).
  await vak(page).click();
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('.provincie-vak');
  assert.equal(await stand(page), 'uit');
  assert.equal(page.fouten.length, 0, page.fouten.join('\n'));
  await ctx.close();
});

test('toetsenbord: spatie op het vinkje wisselt, de focus blijft op het vinkje', async () => {
  const { ctx, page } = await openApp({ viewport: { width: 1280, height: 900 } });
  await vak(page).focus();
  await page.keyboard.press('Space');
  assert.equal(await stand(page), 'uit');
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), `Alle theaters in ${PROVINCIE}`);
  await page.keyboard.press('Space');
  assert.equal(await stand(page), 'aan');
  await ctx.close();
});

test('ingelogd: één schrijfactie per tik naar users/{uid}, met de hele theaterkeuze', async () => {
  const docs = { 'users/u1': { profielGevraagd: true, enabledTheaters: {}, watchlist: [], watchlistVerwijderd: [], gepland: [], geplandVerwijderd: [], gezien: [], gezienVerwijderd: [] }, 'gedeeld/u1': { gezien: false, watchlist: false, gewijzigdOp: 1 } };
  const { ctx, page } = await openApp({ gebruiker: ANNA, docs });
  await page.waitForTimeout(500);
  const voor = await page.evaluate(() => window.__nepSchrijf.length);
  await vak(page).click();
  await page.waitForTimeout(300);
  const nieuw = await page.evaluate((n) => window.__nepSchrijf.slice(n), voor);
  assert.deepEqual(nieuw, [['set', 'users/u1']]);
  const opgeslagen = await page.evaluate(() => window.__nepFirestore.get('users/u1').enabledTheaters);
  assert.equal(opgeslagen.isala, false);
  assert.notEqual(opgeslagen.delamar, false);
  assert.equal(await stand(page), 'uit');
  // Niet in localStorage (ingelogd is Firestore de bron).
  assert.equal((await enabled(page)).isala, undefined);
  assert.equal(page.fouten.length, 0, page.fouten.join('\n'));
  await ctx.close();
});

test('provincievinkje: kleuren uit de tokens', async () => {
  const css = await readFile(path.join(ROOT, 'css/styles.css'), 'utf-8');
  const regel = (sel) => css.match(new RegExp(`${sel.replace(/[.]/g, '\\.')}\\s*\\{([^}]*)\\}`))?.[1] ?? '';
  assert.match(regel('.provincie-vak'), /accent-color:\s*var\(--primary\)/);
  assert.match(regel('.provincie-vinkje'), /color:\s*var\(--text-2\)/);
  assert.match(regel('.provincie-vinkje'), /min-height:\s*var\(--touch\)/);
});
