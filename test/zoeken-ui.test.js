// UI-test zoeken en teller (15 okt 2026): zoeken in alles wat je ziet (ook de
// maker), een afkorting in de maker vanaf het woordbegin, en de teller in de
// kop staat vast bij zoeken, filteren en een eigen keuze in Mijn theaters.
// Echte app, vaste agenda; geen netwerk naar buiten.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

import { nepFirebase } from './nepFirebase.js';
import { TIJDZONE } from './datum.js';
import { serveerVasteAgenda, vasteShows } from './vasteAgenda.js';

const ROOT = new URL('../public/', import.meta.url).pathname;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };
const ANNA = { uid: 'u1', displayName: 'Anna de Vries', email: 'anna@example.com', photoURL: null };
let server;
let base;
let browser;

before(async () => {
  server = createServer(async (req, res) => {
    const pad = decodeURIComponent(new URL(req.url, 'http://x').pathname);
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

async function openApp({ gebruiker = null, docs = {}, opslag = {}, viewport = { width: 1280, height: 900 } } = {}) {
  const ctx = await browser.newContext({ viewport, serviceWorkers: 'block', timezoneId: TIJDZONE });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  await ctx.route(`${base}js/firebase.js`, (r) => r.fulfill({ contentType: 'text/javascript', body: nepFirebase({ gebruiker, docs }) }));
  await ctx.addInitScript((opslag) => {
    for (const [k, v] of Object.entries(opslag)) localStorage.setItem(k, JSON.stringify(v));
  }, opslag);
  const page = await ctx.newPage();
  page.fouten = [];
  page.on('pageerror', (e) => page.fouten.push(e.message));
  await page.goto(base, { waitUntil: 'networkidle' });
  // Niet op .show-row wachten: met filters kan de agenda leeg zijn.
  await page.waitForFunction(() => /actieve theaters?/.test(document.getElementById('subtitle')?.textContent ?? ''));
  await page.waitForTimeout(300);
  return { ctx, page };
}

async function zoek(page, tekst) {
  await page.fill('#sidebarSearchInput', tekst);
  await page.waitForTimeout(500);
  return page.locator('#agendaList .show-row .show-title-text').allInnerTexts();
}

async function verwacht() {
  const shows = await vasteShows();
  return `${new Set(shows.map((s) => s.theaterId)).size} actieve theaters in ${new Set(shows.map((s) => s.stad)).size} steden`;
}

test('zoeken op de maker: "Nina van Tongeren" vindt Teckel, "NDT" vindt "Blast a universe – NDT 2"', async () => {
  const { ctx, page } = await openApp();
  const teckel = await zoek(page, 'Nina van Tongeren');
  assert.ok(teckel.length > 0 && teckel.every((t) => t.startsWith('Teckel')), teckel.join(' | '));
  // Afkorting in de maker (titel "Blast a universe", maker "NDT 2").
  const ndt = await zoek(page, 'NDT');
  assert.ok(ndt.includes('Blast a universe – NDT 2'), ndt.join(' | '));
  // Alleen treffers met "NDT" aan het begin van een woord (niet "Brandt", "Grondtonen").
  assert.ok(ndt.every((t) => /(^|[^\p{L}\p{N}])ndt/iu.test(t)), ndt.join(' | '));
  // "blast" werkt nog steeds.
  assert.ok((await zoek(page, 'blast')).includes('Blast a universe – NDT 2'));
  assert.equal(page.fouten.length, 0, page.fouten.join('\n'));
  await ctx.close();
});

test('teller in de kop blijft gelijk bij zoeken, filteren en ingelogd met theaters uit in Mijn theaters', async () => {
  const kop = await verwacht();
  const { ctx, page } = await openApp();
  assert.equal(await page.textContent('#subtitle'), kop);
  for (const q of ['NDT', 'blast', 'poem', 'brandt', 'zzzz-niets']) {
    await zoek(page, q);
    assert.equal(await page.textContent('#subtitle'), kop, q);
  }
  await ctx.close();

  // Met een filter (alleen Podiumpas, alleen watchlist) uit de opgeslagen filters.
  const f = await openApp({ opslag: { 'podiumagenda:filters': { podiumpasOnly: true, watchlistOnly: true } } });
  assert.equal(await f.page.textContent('#subtitle'), kop);
  await f.ctx.close();

  // Ingelogd met een profiel waarin de meeste theaters uit staan.
  const shows = await vasteShows();
  const ids = [...new Set(shows.map((s) => s.theaterId))];
  const enabledTheaters = Object.fromEntries(ids.slice(2).map((id) => [id, false]));
  const docs = { 'users/u1': { profielGevraagd: true, enabledTheaters, watchlist: [], watchlistVerwijderd: [], gepland: [], geplandVerwijderd: [], gezien: [], gezienVerwijderd: [] }, 'gedeeld/u1': { gezien: false, watchlist: false, gewijzigdOp: 1 } };
  const i = await openApp({ gebruiker: ANNA, docs });
  await i.page.waitForTimeout(500);
  assert.equal(await i.page.textContent('#subtitle'), kop);
  assert.equal(i.page.fouten.length, 0, i.page.fouten.join('\n'));
  await i.ctx.close();
});
