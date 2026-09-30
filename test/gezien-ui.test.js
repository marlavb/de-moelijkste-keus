// UI-test voor Gezien in de echte app (public/), uitgelogd, met nep-plannen
// in het verleden in localStorage. Zelfde opzet als navigatie.test.js: een
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

async function openApp({ opslag = {}, html, viewport = { width: 390, height: 900 } } = {}) {
  const ctx = await browser.newContext({ viewport, serviceWorkers: 'block' });
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

test('voorbij plan met kaarten → Gezien, uit de planning en van de watchlist', async () => {
  let g = planIn(legeGepland(), nep('Prikkelarme kermis – Sara Kroos', '2026-09-26', 'delamar', '20:30'), 1);
  g = zetStatus(g, g.gepland[0].sleutel, 'kaarten', 2);
  const wl = voegToe(legeWatchlist(), { titel: 'Prikkelarme kermis – Sara Kroos', theaterId: 'delamar' }, 1);
  const { ctx, page } = await openApp({ opslag: { 'podiumagenda:gepland': g, 'podiumagenda:watchlist': wl } });
  await page.goto(`${base}#/profiel`);
  await page.waitForTimeout(300);
  const gezien = await lees(page, 'podiumagenda:gezien');
  assert.equal(gezien.gezien.length, 1);
  assert.deepEqual(gezien.gezien[0].bezoeken, [{ datum: '2026-09-26', tijd: '20:30', theaterId: 'delamar' }]);
  assert.equal((await lees(page, 'podiumagenda:gepland')).gepland.length, 0);
  assert.equal((await lees(page, 'podiumagenda:watchlist')).watchlist.length, 0);
  const rij = await page.locator('#gezienList .gezien-row').first().innerText();
  // Weergavenaam van het theater, nooit het id.
  assert.match(rij, /za 26 sep · DeLaMar/);
  assert.equal(page.fouten.length, 0, page.fouten.join('\n'));
  await ctx.close();
});

test('voorbij plan zonder kaarten → "Ben je geweest?"; Ja → Gezien; Nee → alleen weg', async () => {
  let g = planIn(legeGepland(), nep('Lemming – reprise – Merijn Scholten', '2026-09-27', 'kleinekomedie'), 1);
  g = planIn(g, nep('Wacht even', '2026-09-28', 'kleinekomedie'), 2);
  const { ctx, page } = await openApp({ opslag: { 'podiumagenda:gepland': g } });
  await page.goto(`${base}#/profiel`);
  await page.waitForTimeout(300);
  assert.equal(await page.locator('#vraagSection').isVisible(), true);
  assert.equal(await page.locator('#vraagList .vraag-row').count(), 2);
  // Nog niet beantwoord: niet bij de gewone planning.
  assert.equal(await page.locator('#geplandList .plan-row').count(), 0);
  await page.locator('#vraagList .vraag-row', { hasText: 'Lemming' }).locator('.vraag-btn--ja').click();
  await page.locator('#vraagList .vraag-row', { hasText: 'Wacht even' }).locator('.vraag-btn:not(.vraag-btn--ja)').click();
  assert.equal(await page.locator('#vraagSection').isVisible(), false);
  const gezien = await lees(page, 'podiumagenda:gezien');
  assert.deepEqual(gezien.gezien.map((i) => i.titel), ['Lemming – reprise – Merijn Scholten']);
  assert.equal((await lees(page, 'podiumagenda:gepland')).gepland.length, 0);
  // Herladen: niets dubbel, geen vraag meer.
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(300);
  assert.equal((await lees(page, 'podiumagenda:gezien')).gezien[0].bezoeken.length, 1);
  assert.equal(await page.locator('#vraagSection').isVisible(), false);
  await ctx.close();
});

test('handmatig op het detailscherm: van de watchlist, melding, ongedaan maken', async () => {
  const s = eenShow;
  const wl = voegToe(legeWatchlist(), { titel: s.titel, theaterId: s.theaterId }, 1);
  const { ctx, page } = await openApp({ opslag: { 'podiumagenda:watchlist': wl } });
  await page.goto(`${base}#/show/${encodeURIComponent(s.id)}`);
  await page.waitForTimeout(300);
  assert.equal(await page.locator('#detailGezienLabel').innerText(), 'Gezien');
  await page.click('#detailGezienBtn');
  assert.equal(await page.locator('#detailGezienLabel').innerText(), '✓ Gezien');
  assert.equal(await page.locator('#detailGezienBtn').getAttribute('aria-pressed'), 'true');
  assert.match(await page.locator('#melding').innerText(), /Gezien · van je watchlist gehaald/);
  assert.equal((await lees(page, 'podiumagenda:watchlist')).watchlist.length, 0);
  assert.equal((await lees(page, 'podiumagenda:gezien')).gezien[0].bron, 'handmatig');
  await page.click('#melding .melding-actie');
  assert.equal(await page.locator('#detailGezienLabel').innerText(), 'Gezien');
  assert.equal((await lees(page, 'podiumagenda:gezien')).gezien.length, 0);
  assert.equal((await lees(page, 'podiumagenda:watchlist')).watchlist[0].sleutel, watchlistSleutel(s.titel, s.theaterId));
  assert.equal(page.fouten.length, 0, page.fouten.join('\n'));
  await ctx.close();
});

test('label "Gezien" in de agenda en filter "Verberg gezien"', async () => {
  const s = eenShow;
  const { ctx, page } = await openApp({ viewport: { width: 1280, height: 900 } });
  await page.fill('#sidebarSearchInput', s.titel);
  await page.waitForTimeout(500);
  const rijen = () => page.locator('#agendaList .show-row', { hasText: s.titel });
  assert.ok((await rijen().count()) > 0);
  assert.equal(await rijen().first().locator('.status-badge--gezien').count(), 0);
  await page.goto(`${base}#/show/${encodeURIComponent(s.id)}`);
  await page.click('#detailGezienBtn');
  await page.goto(`${base}#/`);
  await page.waitForTimeout(300);
  assert.equal(await rijen().first().locator('.status-badge--gezien').innerText(), 'Gezien');
  await page.click('#sidebarHideGezienToggle');
  await page.waitForTimeout(200);
  assert.equal(await rijen().count(), 0);
  assert.equal(await page.locator('#sidebarHideGezienToggle').getAttribute('aria-checked'), 'true');
  // Filters wissen zet hem weer uit.
  await page.click('#sidebarClearFilters');
  await page.waitForTimeout(200);
  assert.ok((await rijen().count()) > 0);
  await ctx.close();
});

test('oudere index.html zonder de nieuwe elementen: geen fouten, tabs werken', async () => {
  const zonder = (html) =>
    html
      .replace(/<section class="profile-section profile-section--vraag"[\s\S]*?<\/section>/, '')
      .replace(/<section class="profile-section" aria-labelledby="gezienHeading">[\s\S]*?<\/section>/, '')
      .replace(/<button class="watch-btn" type="button" id="detailGezienBtn"[\s\S]*?<\/button>/, '')
      .replace(/<section class="sheet-section">\s*<div class="toggle-row">\s*<span class="toggle-row-label">Verberg gezien<\/span>[\s\S]*?<\/section>/g, '');
  let g = planIn(legeGepland(), nep('Wacht even', '2026-09-28', 'kleinekomedie'), 1);
  const { ctx, page } = await openApp({ html: zonder, opslag: { 'podiumagenda:gepland': g } });
  assert.equal(await page.locator('#detailGezienBtn').count(), 0);
  for (const tab of ['theaters', 'profiel', 'agenda']) {
    await page.click(`.bottom-nav [data-tab="${tab}"]`);
    await page.waitForTimeout(150);
  }
  await page.goto(`${base}#/show/${encodeURIComponent(eenShow.id)}`);
  await page.waitForTimeout(200);
  assert.equal(page.fouten.length, 0, page.fouten.join('\n'));
  await ctx.close();
});

// Zichtbare kopjes in Profiel, van boven naar beneden (op desktop: eerst de
// linkerkolom, want die staat links; de watchlist ernaast).
const kopjes = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('#screen-profiel .profile-section')]
      .filter((s) => !s.hidden && s.offsetParent !== null)
      .map((s) => ({ kop: s.querySelector('h2').textContent, x: Math.round(s.getBoundingClientRect().left), y: Math.round(s.getBoundingClientRect().top) }))
  );

test('Profiel: volgorde Ben je geweest? → Gepland → Gezien → Watchlist; lege tekst Gezien', async () => {
  for (const viewport of [{ width: 390, height: 900 }, { width: 1280, height: 900 }]) {
    const desktop = viewport.width >= 900;
    // Zonder vragen: blok "Ben je geweest?" niet zichtbaar.
    let { ctx, page } = await openApp({ viewport });
    await page.goto(`${base}#/profiel`);
    await page.waitForTimeout(300);
    let k = await kopjes(page);
    assert.deepEqual(k.map((x) => x.kop), ['Gepland', 'Gezien', 'Watchlist'], `${viewport.width}px`);
    assert.equal(
      (await page.locator('#gezienEmpty').innerText()).trim(),
      'Nog niets gezien. Een geplande voorstelling komt hier na de voorstelling vanzelf te staan.'
    );
    const [gepland, gezien, watchlist] = k;
    // Gezien direct onder Gepland, in dezelfde kolom.
    assert.equal(gezien.x, gepland.x);
    assert.ok(gezien.y > gepland.y);
    if (desktop) {
      assert.ok(watchlist.x > gepland.x, 'watchlist in de rechterkolom');
      assert.equal(watchlist.y, gepland.y, 'watchlist bovenaan naast de planning');
    } else {
      assert.ok(watchlist.y > gezien.y);
    }
    await ctx.close();

    // Met een vraag: die staat bovenaan.
    const g = planIn(legeGepland(), nep('Wacht even', '2026-09-28', 'kleinekomedie'), 1);
    ({ ctx, page } = await openApp({ viewport, opslag: { 'podiumagenda:gepland': g } }));
    await page.goto(`${base}#/profiel`);
    await page.waitForTimeout(300);
    k = await kopjes(page);
    assert.deepEqual(k.map((x) => x.kop), ['Ben je geweest?', 'Gepland', 'Gezien', 'Watchlist'], `${viewport.width}px`);
    assert.equal(page.fouten.length, 0, page.fouten.join('\n'));
    await ctx.close();
  }
});
