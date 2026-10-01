// UI-test voor het detailscherm (Podiumpas-vinkjes, terugnavigatie) in de
// echte app (public/), uitgelogd, met nep-voorstellingen. Zelfde opzet als navigatie.test.js: een
// klein lokaal servertje, geen service worker, geen netwerk naar buiten.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

import { planIn, zetStatus, legeGepland } from '../public/js/gepland.js';
import { voegToe, legeWatchlist, watchlistSleutel } from '../public/js/watchlist.js';

const ROOT = new URL('../public/', import.meta.url).pathname;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };
let server;
let base;
let browser;
let eenShow; // een toekomstige voorstelling uit de echte data

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
  const shows = JSON.parse(await readFile(path.join(ROOT, 'data/shows.json'), 'utf-8'));
  const vandaag = new Date().toISOString().slice(0, 10);
  eenShow = shows.find((s) => s.datum > vandaag && s.beschikbaarheid === 'beschikbaar' && !s.titel.includes('::'));
});

after(async () => {
  await browser?.close();
  await new Promise((r) => server.close(r));
});

async function openApp({ opslag = {}, html, viewport = { width: 390, height: 900 }, extraShows = [] } = {}) {
  const ctx = await browser.newContext({ viewport, serviceWorkers: 'block' });
  if (extraShows.length) {
    const echt = JSON.parse(await readFile(path.join(ROOT, 'data/shows.json'), 'utf-8'));
    await ctx.route(/data\/shows\.json/, (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify([...extraShows, ...echt]) }));
  }
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  await ctx.route(`${base}js/firebase.js`, (r) =>
    r.fulfill({
      contentType: 'text/javascript',
      body: `export const auth = {}, db = {}, googleProvider = {};
        export const onAuthStateChanged = (_a, cb) => setTimeout(() => cb(null), 0);
        export const signInWithPopup = async () => {}, signOut = async () => {};
        export const doc = () => null, getDoc = async () => ({ exists: () => false }), setDoc = async () => {};
        export const serverTimestamp = () => null;`,
    })
  );
  if (html) await ctx.route(`${base}`, async (r) => r.fulfill({ status: 200, contentType: 'text/html', body: html(await readFile(path.join(ROOT, 'index.html'), 'utf-8')) }));
  await ctx.addInitScript((opslag) => {
    if (sessionStorage.getItem('gevuld')) return;
    sessionStorage.setItem('gevuld', '1');
    for (const [k, v] of Object.entries(opslag)) localStorage.setItem(k, JSON.stringify(v));
  }, opslag);
  const page = await ctx.newPage();
  page.fouten = [];
  page.on('pageerror', (e) => page.fouten.push(e.message));
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.waitForTimeout(300);
  return { ctx, page };
}

const lees = (page, key) => page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? 'null'), key);
const nep = (titel, datum, theaterId, tijd = '20:15') => ({ titel, datum, theaterId, theaterNaam: 'Oude naam', stad: 'Amsterdam', tijd, reserverenUrl: '' });


const morgen = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const proef = (theaterId, theaterNaam, stad, dag, podiumpas, extra = {}) => ({
  id: `proef-${theaterId}-${dag}`, titel: 'Proefstuk Vinkje', theaterId, theaterNaam, stad, podiumpas, datum: morgen(dag), tijd: '20:15',
  genre: 'Toneel', genreRuw: 'Toneel', beschikbaarheid: 'beschikbaar', beschrijving: null, maker: null, reserverenUrl: 'https://example.invalid/', bron: '', opgehaaldOp: new Date().toISOString(), ...extra,
});
const PROEF = [
  proef('maaspoort', 'De Maaspoort Theater & Events', 'Venlo', 3, true),
  proef('maaspoort', 'De Maaspoort Theater & Events', 'Venlo', 4, false, { locatie: 'Theater De Garage | Venlo' }),
  proef('delamar', 'DeLaMar', 'Amsterdam', 5, true),
  proef('delamar', 'DeLaMar', 'Amsterdam', 6, true),
  proef('dok6', 'DOK6', 'Panningen', 7, true),
  proef('dok6', 'DOK6', 'Panningen', 8, false),
];

for (const viewport of [{ width: 390, height: 900 }, { width: 1280, height: 900 }]) {
  test(`Podiumpas-vinkje per speeldatum: hoofdregel, Andere data, Ook te zien bij (${viewport.width}px)`, async () => {
    const { ctx, page } = await openApp({ viewport, extraShows: PROEF });
    await page.goto(`${base}#/show/proef-maaspoort-3`);
    await page.waitForTimeout(400);
    // Hoofdregel: deze speeldatum heeft Podiumpas.
    assert.equal(await page.locator('#detailPodiumpasBadge').isVisible(), true);
    // Andere data (zelfde theater, gemengd): alleen de datum met Podiumpas.
    const chips = page.locator('#detailOtherDates .chip');
    assert.equal(await chips.count(), 2);
    assert.equal(await chips.nth(0).locator('.podiumpas-icon').count(), 1);
    assert.equal(await chips.nth(1).locator('.podiumpas-icon').count(), 0);
    // Ook te zien bij: DeLaMar overal Podiumpas → achter de naam; DOK6 gemengd → per datum.
    const delamar = page.locator('.related-theater-group', { hasText: 'DeLaMar' });
    assert.equal(await delamar.locator('.related-theater-name .podiumpas-icon').count(), 1);
    assert.equal(await delamar.locator('.chip .podiumpas-icon').count(), 0);
    const dok6 = page.locator('.related-theater-group', { hasText: 'DOK6' });
    assert.equal(await dok6.locator('.related-theater-name .podiumpas-icon').count(), 0);
    assert.equal(await dok6.locator('.chip .podiumpas-icon').count(), 1);
    // Zelfde component en label als in de agendaregels.
    assert.equal(await delamar.locator('.podiumpas-icon').getAttribute('aria-label'), 'Podiumpas geaccepteerd');
    // Speeldatum zonder Podiumpas: geen vinkje in de hoofdregel.
    await page.goto(`${base}#/show/proef-maaspoort-4`);
    await page.waitForTimeout(300);
    assert.equal(await page.locator('#detailPodiumpasBadge').isVisible(), false);
    assert.equal(page.fouten.length, 0, page.fouten.join('\n'));
    await ctx.close();
  });
}

test('eenvoudig Gezien-scherm: vinkje achter de theaternaam als het bewaarde bezoek Podiumpas had', async () => {
  const gezien = { gezien: [{ sleutel: 'oud proefstuk', titel: 'Oud proefstuk', theaterId: 'delamar', bron: 'planning', toegevoegdOp: 1, bezoeken: [
    { datum: '2026-09-05', tijd: '20:15', theaterId: 'delamar', podiumpas: true, locatie: 'Elders | Amsterdam' },
    { datum: '2026-08-01', tijd: '20:00', theaterId: 'carre', podiumpas: false },
  ] }], gezienVerwijderd: [] };
  const { ctx, page } = await openApp({ opslag: { 'podiumagenda:gezien': gezien } });
  await page.goto(`${base}#/gezien/${encodeURIComponent('oud proefstuk')}`);
  await page.waitForTimeout(400);
  const regels = page.locator('#gezienBezoeken .bezoek');
  assert.equal(await regels.nth(0).locator('.podiumpas-icon').count(), 1);
  assert.equal(await regels.nth(0).textContent(), 'zaterdag 5 september 2026 · 20:15 · DeLaMar, Amsterdam · Elders');
  // Het vinkje staat direct na de theaternaam (vóór de plek).
  assert.equal(await regels.nth(0).evaluate((li) => li.childNodes[0].textContent.endsWith('DeLaMar, Amsterdam') && li.childNodes[1].classList.contains('podiumpas-icon')), true);
  assert.equal(await regels.nth(1).locator('.podiumpas-icon').count(), 0);
  await ctx.close();
});

// ---------- Terug naar waar je vandaan kwam (1 okt 2026) ----------

import { zetGezien, legeGezien } from '../public/js/gezien.js';

// Veel Gezien-items, zodat Profiel kan scrollen; de laatste staat nog in de agenda.
function veelGezien() {
  let g = legeGezien();
  for (let i = 0; i < 25; i++) g = zetGezien(g, { show: { titel: `Oud stuk ${String(i).padStart(2, '0')}`, theaterId: 'delamar' }, bron: 'planning', bezoek: { datum: '2026-09-01', tijd: '20:00', theaterId: 'delamar' } }, 100 + i);
  return zetGezien(g, { show: PROEF[0], bron: 'handmatig' }, 1);
}

for (const viewport of [{ width: 390, height: 700 }, { width: 1280, height: 700 }]) {
  test(`terug vanuit Gezien, Gepland en Watchlist naar Profiel op dezelfde scrollpositie (${viewport.width}px)`, async () => {
    const opslag = {
      'podiumagenda:gezien': veelGezien(),
      'podiumagenda:gepland': planIn(legeGepland(), PROEF[2], 1),
      'podiumagenda:watchlist': voegToe(legeWatchlist(), { titel: PROEF[4].titel, theaterId: PROEF[4].theaterId }, 1),
    };
    const { ctx, page } = await openApp({ viewport, extraShows: PROEF, opslag });
    await page.goto(`${base}#/profiel`);
    await page.waitForTimeout(300);
    for (const [naam, klik] of [
      ['Gezien', () => page.locator('#gezienList .gezien-titel', { hasText: 'Proefstuk' }).click()],
      ['Gepland', () => page.locator('#geplandList .plan-info').first().click()],
      ['Watchlist', () => page.locator('#favoritesList .show-row').first().click()],
    ]) {
      // Naar het element scrollen en de positie onthouden.
      const doel = naam === 'Gezien' ? page.locator('#gezienList .gezien-titel', { hasText: 'Proefstuk' }) : naam === 'Gepland' ? page.locator('#geplandList .plan-info').first() : page.locator('#favoritesList .show-row').first();
      await doel.scrollIntoViewIfNeeded();
      const y = await page.evaluate(() => window.scrollY);
      await klik();
      await page.waitForTimeout(300);
      assert.match(page.url(), /#\/show\//, naam);
      await page.click('#detailBack');
      await page.waitForTimeout(300);
      assert.match(page.url(), /#\/profiel$/, `${naam}: terug naar Profiel`);
      assert.equal(await page.locator('#screen-profiel').isVisible(), true);
      assert.ok(Math.abs((await page.evaluate(() => window.scrollY)) - y) <= 2, `${naam}: scrollpositie ${y}`);
    }
    // Ook via de browser (en dus vegen op een telefoon).
    await page.locator('#watchlistHeading').scrollIntoViewIfNeeded();
    const y = await page.evaluate(() => window.scrollY);
    await page.locator('#favoritesList .show-row').first().click();
    await page.waitForTimeout(300);
    await page.goBack();
    await page.waitForTimeout(300);
    assert.match(page.url(), /#\/profiel$/);
    assert.ok(Math.abs((await page.evaluate(() => window.scrollY)) - y) <= 2);
    assert.equal(page.fouten.length, 0, page.fouten.join('\n'));
    await ctx.close();
  });
}

test('detail → detail (Andere data) → terug → terug: eerst het vorige detail, dan het tabblad', async () => {
  const { ctx, page } = await openApp({ extraShows: PROEF, opslag: { 'podiumagenda:gezien': zetGezien(legeGezien(), { show: PROEF[0], bron: 'handmatig' }, 1) } });
  await page.goto(`${base}#/profiel`);
  await page.waitForTimeout(300);
  await page.locator('#gezienList .gezien-titel').first().click();
  await page.waitForTimeout(300);
  assert.match(page.url(), /proef-maaspoort-3/);
  await page.locator('#detailOtherDates .chip').nth(1).click();
  await page.waitForTimeout(300);
  assert.match(page.url(), /proef-maaspoort-4/);
  await page.click('#detailBack');
  await page.waitForTimeout(300);
  assert.match(page.url(), /proef-maaspoort-3/);
  await page.goBack(); // browser-terug doet hetzelfde
  await page.waitForTimeout(300);
  assert.match(page.url(), /#\/profiel$/);
  await ctx.close();
});

test('terug vanuit de Agenda: filters en scrollpositie blijven; directe link gaat naar de Agenda', async () => {
  const { ctx, page } = await openApp({ viewport: { width: 390, height: 700 } });
  await page.evaluate(() => window.scrollTo(0, 900));
  await page.waitForTimeout(100);
  const y = await page.evaluate(() => window.scrollY);
  const rij = page.locator('#agendaList .show-row').nth(12);
  await rij.scrollIntoViewIfNeeded();
  const y2 = await page.evaluate(() => window.scrollY);
  await rij.click();
  await page.waitForTimeout(300);
  await page.click('#detailBack');
  await page.waitForTimeout(300);
  assert.equal(await page.locator('#screen-agenda').isVisible(), true);
  assert.ok(Math.abs((await page.evaluate(() => window.scrollY)) - y2) <= 2, `scroll ${y} / ${y2}`);
  await ctx.close();

  // Directe link naar een voorstelling (geen voorgeschiedenis): terug → Agenda.
  const tweede = await openApp({});
  await tweede.page.goto(`${base}#/show/${encodeURIComponent(eenShow.id)}`);
  await tweede.page.reload({ waitUntil: 'networkidle' });
  await tweede.page.waitForTimeout(300);
  await tweede.page.click('#detailBack');
  await tweede.page.waitForTimeout(300);
  assert.equal(await tweede.page.locator('#screen-agenda').isVisible(), true);
  assert.match(tweede.page.url(), /#\/$/);
  await tweede.ctx.close();
});
