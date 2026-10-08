// Regressietest voor de onderste navigatie: op telefoon- en desktopbreedte
// op alle drie de tabs klikken en controleren dat de juiste route en het
// juiste scherm actief worden. Op 30 sep 2026 werkten Theaters en Profiel
// live niet (nieuwe index.html met een oude app.js); dat mag niet nog eens
// ongemerkt gebeuren. Draait de echte app uit public/ via een klein
// lokaal servertje, zonder service worker en zonder netwerk naar buiten.

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

async function openApp(viewport, { html } = {}) {
  const ctx = await browser.newContext({ viewport, serviceWorkers: 'block', timezoneId: TIJDZONE });
  // Alles buiten het servertje (Google Fonts, Firebase) blokkeren: de test
  // mag niet van het netwerk afhangen.
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  // Firebase komt van gstatic; vervangen door een nep-module (uitgelogd).
  await ctx.route(`${base}js/firebase.js`, (r) =>
    r.fulfill({
      contentType: 'text/javascript',
      body: nepFirebase(),
    })
  );
  if (html) await ctx.route(`${base}`, async (r) => r.fulfill({ status: 200, contentType: 'text/html', body: html(await readFile(path.join(ROOT, 'index.html'), 'utf-8')) }));
  const page = await ctx.newPage();
  const fouten = [];
  page.on('pageerror', (e) => fouten.push(e.message));
  await page.goto(base);
  await page.waitForSelector('.nav-item');
  await page.waitForTimeout(300);
  return { ctx, page, fouten };
}

async function klikTabs(page) {
  const uit = [];
  for (const [tab, hash, scherm] of [
    ['theaters', '#/theaters', 'screen-theaters'],
    ['profiel', '#/profiel', 'screen-profiel'],
    ['agenda', '#/', 'screen-agenda'],
    ['theaters', '#/theaters', 'screen-theaters'],
  ]) {
    await page.click(`.nav-item[data-tab="${tab}"]`, { timeout: 3000 });
    await page.waitForTimeout(150);
    const st = await page.evaluate(() => ({
      hash: location.hash,
      zichtbaar: [...document.querySelectorAll('.screen')].filter((s) => !s.hidden).map((s) => s.id),
      actief: document.querySelector('.nav-item.is-active')?.dataset.tab,
    }));
    uit.push([tab, st]);
    assert.equal(st.hash, hash, `tab ${tab}: route`);
    assert.deepEqual(st.zichtbaar, [scherm], `tab ${tab}: zichtbaar scherm`);
    assert.equal(st.actief, tab, `tab ${tab}: actieve tab`);
  }
  return uit;
}

for (const [naam, viewport] of [
  ['telefoon', { width: 390, height: 844 }],
  ['desktop 900', { width: 900, height: 800 }],
  ['desktop 1280', { width: 1280, height: 800 }],
]) {
  test(`navigatie: alle tabs werken (${naam})`, async () => {
    const { ctx, page, fouten } = await openApp(viewport);
    try {
      // Wie de klik op elke tab opvangt: de tab zelf, geen overlay of sidebar.
      const raak = await page.evaluate(() =>
        [...document.querySelectorAll('.nav-item')].map((b) => {
          const r = b.getBoundingClientRect();
          return b.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2));
        })
      );
      assert.deepEqual(raak, [true, true, true]);
      await klikTabs(page);
      assert.deepEqual(fouten, []);
    } finally {
      await ctx.close();
    }
  });
}

test('navigatie blijft werken als een later gekoppeld element ontbreekt', async () => {
  // Zoals op 30 sep 2026: een element dat app.js verwacht, bestaat niet in
  // de index.html. De tabs worden als eerste gekoppeld en moeten het doen.
  const { ctx, page } = await openApp({ width: 1280, height: 800 }, { html: (h) => h.replace('id="detailBack"', 'id="detailBack-weg"') });
  try {
    await klikTabs(page);
  } finally {
    await ctx.close();
  }
});
