// UI-test voor de kaart bij Mijn theaters (okt 2026), uitgelogd, met de vaste
// agenda en Leaflet uit node_modules (kaartNep.js); geen netwerk naar buiten.
// Kaart openen, een speldje uitzetten → lijst en filters volgen; en andersom.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

import { nepFirebase } from './nepFirebase.js';
import { TIJDZONE } from './datum.js';
import { serveerVasteAgenda } from './vasteAgenda.js';
import { routeKaart } from './kaartNep.js';

const ROOT = new URL('../public/', import.meta.url).pathname;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };
let server;
let base;
let browser;

before(async () => {
  server = createServer(async (req, res) => {
    const pad = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    // De vaste agenda, niet public/data/shows.json (vasteAgenda.js).
    if (await serveerVasteAgenda(pad, res)) return;
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

async function openApp({ viewport = { width: 390, height: 844 } } = {}) {
  const ctx = await browser.newContext({ viewport, serviceWorkers: 'block', timezoneId: TIJDZONE });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  const tegels = [];
  await routeKaart(ctx, { tegels });
  await ctx.route(`${base}js/firebase.js`, (r) => r.fulfill({ contentType: 'text/javascript', body: nepFirebase() }));
  const page = await ctx.newPage();
  page.setDefaultTimeout(15_000);
  page.fouten = [];
  page.on('pageerror', (e) => page.fouten.push(e.message));
  await page.goto(`${base}#/theaters`, { waitUntil: 'load' });
  await page.waitForSelector('.provincie-vak');
  return { ctx, page, tegels };
}

/**
 * Een los speldje (niet in een cluster) van een theater met voorstellingen
 * dat aan staat; zo nodig het kleinste cluster openklikken (inzoomen).
 */
/** De kaart staat stil: speldjes geplaatst, geen zoom- of clusteranimatie meer bezig. */
const rustigeKaart = (page) =>
  page.waitForFunction(() => document.querySelector('#theatersKaart')?.dataset.klaar === '1' && !document.querySelector('.leaflet-zoom-anim, .leaflet-cluster-anim'));

async function eenActiefSpeldje(page) {
  await rustigeKaart(page);
  for (let i = 0; i < 6; i++) {
    const label = await page.evaluate(() =>
      [...document.querySelectorAll('.kaart-pin:not(.kaart-pin--stil)')].map((el) => el.getAttribute('aria-label')).find((l) => /in Mijn theaters, \d+ komende/.test(l ?? ''))
    );
    if (label) return { label, naam: label.split(',')[0] };
    const clusters = page.locator('.kaart-cluster');
    const aantallen = await clusters.allInnerTexts();
    if (!aantallen.length) break;
    const kleinste = aantallen.map(Number).indexOf(Math.min(...aantallen.map(Number)));
    const zoom = await page.getAttribute('#theatersKaart', 'data-zoom');
    await clusters.nth(kleinste).click();
    await page.waitForFunction((z) => document.querySelector('#theatersKaart').dataset.zoom !== z, zoom);
    await rustigeKaart(page);
  }
  assert.fail('geen los, actief speldje gevonden');
}

const enabled = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('podiumagenda:enabledTheaters') ?? '{}'));

test('Kaart: lijst standaard; kaart pas geladen bij openen; speldje uitzetten (toetsenbord) → lijst en filters volgen', async () => {
  const { ctx, page, tegels } = await openApp();
  // Standaard de lijst; Leaflet nog niet geladen.
  assert.equal(await page.getAttribute('#theatersLijstKnop', 'aria-pressed'), 'true');
  assert.equal(await page.isHidden('#theatersKaartBlok'), true);
  assert.equal(await page.evaluate(() => typeof window.L), 'undefined');
  assert.equal(await page.locator('script[src*="leaflet"]').count(), 0);

  await page.click('#theatersKaartKnop');
  await rustigeKaart(page);
  assert.equal(await page.isHidden('#theatersList'), true);
  assert.match(await page.textContent('.leaflet-control-attribution'), /© OpenStreetMap/);
  assert.ok(tegels.length > 0, 'tegels van OpenStreetMap opgevraagd');
  // Alle theaters op de kaart: losse speldjes plus de aantallen in clusters.
  const opKaart = await page.evaluate(() => document.querySelectorAll('.kaart-pin').length + [...document.querySelectorAll('.kaart-cluster')].reduce((n, c) => n + Number(c.textContent), 0));
  assert.equal(opKaart, 80);
  // Knoppen ≥ 44 px.
  for (const sel of ['#theatersKaartKnop', '.leaflet-control-zoom-in', '.leaflet-control-zoom-out']) {
    const box = await page.locator(sel).boundingBox();
    assert.ok(box.height >= 44 && box.width >= 44, `${sel}: ${box.width}×${box.height}`);
  }

  // Toetsenbord: speldje focussen, Enter → popup, focus op de knop.
  const { label, naam } = await eenActiefSpeldje(page);
  // Op de naam (title), niet op het label: dat verandert bij aan/uit.
  const pin = page.locator(`.kaart-pin[title="${naam}"]`);
  assert.equal(await pin.getAttribute('aria-label'), label);
  await pin.focus();
  await page.keyboard.press('Enter');
  await page.waitForSelector('.kaart-popup');
  assert.equal(await page.textContent('.kaart-popup-naam'), naam);
  assert.match(await page.textContent('.kaart-popup-aantal'), /^\d+ komende voorstelling/);
  assert.equal(await page.evaluate(() => document.activeElement?.className), 'kaart-popup-knop is-aan');
  const knopBox = await page.locator('.kaart-popup-knop').boundingBox();
  assert.ok(knopBox.height >= 44);
  await page.keyboard.press('Enter');
  await page.waitForSelector('.kaart-popup-knop:not(.is-aan)');
  assert.equal(await page.textContent('.kaart-popup-knop'), 'Uit · zet aan in Mijn theaters');
  assert.match(await pin.getAttribute('class'), /kaart-pin--uit/);

  // Opgeslagen zoals de lijst; de lijst en de agenda volgen.
  const id = Object.entries(await enabled(page)).find(([, aan]) => aan === false)?.[0];
  assert.ok(id, 'uit in enabledTheaters');
  await page.click('#theatersLijstKnop');
  assert.equal(await page.getAttribute(`[aria-label="${naam} in agenda tonen"]`, 'aria-checked'), 'false');
  await page.click('.nav-item[data-tab="agenda"]');
  await page.click('#filterToggle');
  const chips = await page.locator('#sheetTheaterFilters .chip').allInnerTexts();
  assert.ok(!chips.some((c) => c.trim() === naam), `${naam} niet meer in het theaterfilter`);
  assert.equal(page.fouten.length, 0, page.fouten.join('\n'));
  await ctx.close();
});

test('Kaart: aanzetten in de lijst → het speldje volgt (desktop)', async () => {
  const { ctx, page } = await openApp({ viewport: { width: 1280, height: 900 } });
  await page.click('#theatersKaartKnop');
  const { label, naam } = await eenActiefSpeldje(page);
  // In de lijst uitzetten…
  await page.click('#theatersLijstKnop');
  const schakelaar = page.locator(`[aria-label="${naam} in agenda tonen"]`);
  await schakelaar.evaluate((el) => el.click());
  assert.equal(await schakelaar.getAttribute('aria-checked'), 'false');
  // …en op de kaart is het speldje "uit".
  await page.click('#theatersKaartKnop');
  await rustigeKaart(page);
  const pin = page.locator(`.kaart-pin[title="${naam}"]`);
  await pin.waitFor();
  assert.match(await pin.getAttribute('class'), /kaart-pin--uit/);
  assert.notEqual(await pin.getAttribute('aria-label'), label);
  // Muis: klik → popup → weer aan.
  await pin.click();
  await page.click('.kaart-popup-knop');
  await page.waitForSelector('.kaart-popup-knop.is-aan');
  assert.match(await pin.getAttribute('class'), /kaart-pin--aan/);
  assert.equal(page.fouten.length, 0, page.fouten.join('\n'));
  await ctx.close();
});
