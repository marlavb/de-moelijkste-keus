// UI-test voor het detailscherm (Podiumpas-vinkjes, terugnavigatie) in de
// echte app (public/), uitgelogd, met nep-voorstellingen. Zelfde opzet als navigatie.test.js: een
// klein lokaal servertje, geen service worker, geen netwerk naar buiten.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

import { nepFirebase } from './nepFirebase.js';

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
      body: nepFirebase(),
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
      // Na het Gezien-moment (1) opnieuw op de watchlist: blijft staan (ruimWatchlistOp).
      'podiumagenda:watchlist': voegToe(legeWatchlist(), { titel: PROEF[4].titel, theaterId: PROEF[4].theaterId }, 2),
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

for (const viewport of [{ width: 390, height: 700 }, { width: 1280, height: 700 }]) {
  test(`andere datum (Andere data, Ook te zien bij) vervangt de plek: terug gaat meteen naar Profiel, zelfde scroll (${viewport.width}px)`, async () => {
    const { ctx, page } = await openApp({ viewport, extraShows: PROEF, opslag: { 'podiumagenda:gezien': veelGezien() } });
    await page.goto(`${base}#/profiel`);
    await page.waitForTimeout(300);
    for (const terug of [() => page.click('#detailBack'), () => page.goBack()]) {
      const doel = page.locator('#gezienList .gezien-titel', { hasText: 'Proefstuk' });
      await doel.scrollIntoViewIfNeeded();
      const y = await page.evaluate(() => window.scrollY);
      const lengte = await page.evaluate(() => history.length);
      const diepte = await page.evaluate(() => history.state?.diepte ?? 0);
      await doel.click();
      await page.waitForTimeout(300);
      assert.match(page.url(), /proef-maaspoort-3$/);
      const naDetail = await page.evaluate(() => history.length);
      assert.ok(naDetail <= lengte + 1);
      // Twee keer van datum wisselen: eerst Andere data, dan Ook te zien bij.
      await page.locator('#detailOtherDates .chip').nth(1).click();
      await page.waitForTimeout(300);
      assert.match(page.url(), /proef-maaspoort-4$/);
      assert.equal(await page.evaluate(() => window.scrollY), 0);
      await page.locator('.related-theater-group', { hasText: 'DeLaMar' }).locator('.chip').first().click();
      await page.waitForTimeout(300);
      assert.match(page.url(), /proef-delamar-5$/);
      assert.equal(await page.locator('#detailTitle').innerText(), 'Proefstuk Vinkje');
      // Eén stap in de geschiedenis (het detail), niet drie.
      assert.equal(await page.evaluate(() => history.length), naDetail);
      assert.equal(await page.evaluate(() => history.state.diepte), diepte + 1);
      await terug();
      await page.waitForTimeout(300);
      assert.match(page.url(), /#\/profiel$/);
      assert.equal(await page.locator('#screen-profiel').isVisible(), true);
      assert.ok(Math.abs((await page.evaluate(() => window.scrollY)) - y) <= 2, `scrollpositie ${y}`);
    }
    assert.equal(page.fouten.length, 0, page.fouten.join('\n'));
    await ctx.close();
  });
}

test('andere datum vanuit de Agenda en vanuit een directe link: terug naar de Agenda op dezelfde plek', async () => {
  const { ctx, page } = await openApp({ viewport: { width: 390, height: 700 }, extraShows: PROEF });
  const rij = page.locator('#agendaList .show-row', { hasText: 'Proefstuk Vinkje' }).nth(3);
  await rij.scrollIntoViewIfNeeded();
  const y = await page.evaluate(() => window.scrollY);
  assert.ok(y > 200, `agenda gescrold (${y})`);
  await rij.click();
  await page.waitForTimeout(300);
  await page.locator('#detailOtherDates .chip:not(.is-active)').first().click();
  await page.waitForTimeout(300);
  await page.click('#detailBack');
  await page.waitForTimeout(300);
  assert.equal(await page.locator('#screen-agenda').isVisible(), true);
  assert.ok(Math.abs((await page.evaluate(() => window.scrollY)) - y) <= 2, `scroll ${y}`);
  await ctx.close();

  // Directe link (geen voorgeschiedenis) → andere datum → terug: de Agenda.
  const tweede = await openApp({ extraShows: PROEF });
  await tweede.page.goto(`${base}#/show/proef-delamar-5`);
  await tweede.page.reload({ waitUntil: 'networkidle' });
  await tweede.page.waitForTimeout(300);
  await tweede.page.locator('#detailOtherDates .chip:not(.is-active)').first().click();
  await tweede.page.waitForTimeout(300);
  assert.match(tweede.page.url(), /proef-delamar-6$/);
  await tweede.page.click('#detailBack');
  await tweede.page.waitForTimeout(300);
  assert.equal(await tweede.page.locator('#screen-agenda').isVisible(), true);
  assert.match(tweede.page.url(), /#\/$/);
  await tweede.ctx.close();
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

// ---------- Uitverkochte en wachtlijst-data (okt 2026) ----------

const vol = (dag, beschikbaarheid, extra = {}) =>
  proef('delamar', 'DeLaMar', 'Amsterdam', dag, true, { id: `vol-${dag}`, titel: 'Proefstuk Volle Zaal', beschikbaarheid, ...extra });
const VOL = [
  vol(3, 'beschikbaar'),
  vol(4, 'uitverkocht'),
  vol(5, 'wachtlijst'),
  vol(6, 'afgelast'),
  vol(7, 'onbekend'),
  // Zelfde voorstelling bij een ander theater: alleen vol.
  proef('dok6', 'DOK6', 'Panningen', 4, true, { id: 'vol-dok6-4', titel: 'Proefstuk Volle Zaal', beschikbaarheid: 'wachtlijst' }),
  proef('dok6', 'DOK6', 'Panningen', 9, true, { id: 'vol-dok6-9', titel: 'Proefstuk Volle Zaal', beschikbaarheid: 'beschikbaar' }),
  // Een voorstelling waarvan álle data vol zijn.
  proef('carre', 'Koninklijk Theater Carré', 'Amsterdam', 4, false, { id: 'helemaal-4', titel: 'Proefstuk Helemaal Vol', beschikbaarheid: 'uitverkocht' }),
  proef('carre', 'Koninklijk Theater Carré', 'Amsterdam', 5, false, { id: 'helemaal-5', titel: 'Proefstuk Helemaal Vol', beschikbaarheid: 'wachtlijst' }),
];

async function zoek(page, tekst) {
  if ((page.viewportSize()?.width ?? 0) >= 900) await page.fill('#sidebarSearchInput', tekst);
  else {
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(200);
    if (!(await page.locator('#searchInput').isVisible())) await page.click('#searchToggle');
    await page.fill('#searchInput', tekst);
  }
  await page.waitForTimeout(400);
}

const ROW_LABEL = '#agendaList .status-badge--wachtlijst, #agendaList .status-badge--uitverkocht';

for (const viewport of [{ width: 390, height: 900 }, { width: 1280, height: 900 }]) {
  test(`agenda, schakelaar uit (standaard): volle data staan erin met "Uitverkocht" of "Wachtlijst" (${viewport.width}px)`, async () => {
    const { ctx, page } = await openApp({ viewport, extraShows: VOL });
    await zoek(page, 'Proefstuk Volle Zaal');
    const rijen = page.locator('#agendaList .show-row');
    // Alle zeven data, met hun labels.
    assert.equal(await rijen.count(), 7);
    assert.equal(await page.locator('#agendaList .status-badge--uitverkocht').innerText(), 'Uitverkocht');
    assert.deepEqual(await page.locator('#agendaList .status-badge--wachtlijst').allInnerTexts(), ['Wachtlijst', 'Wachtlijst']);
    assert.equal(await page.locator('#agendaList .status-badge--afgelast').count(), 1);
    await zoek(page, 'Proefstuk Helemaal Vol');
    assert.equal(await rijen.count(), 2);
    assert.equal(await page.locator(ROW_LABEL).count(), 2);
    assert.equal(page.fouten.length, 0, page.fouten.join('\n'));
    await ctx.close();
  });

  test(`agenda, schakelaar aan (opgeslagen keuze): geen uitverkochte, wachtlijst- of afgelaste data; helemaal volle voorstelling weg (${viewport.width}px)`, async () => {
    const { ctx, page } = await openApp({ viewport, extraShows: VOL, opslag: { 'podiumagenda:filters': { hideFullOnly: true } } });
    const id = viewport.width >= 900 ? '#sidebarHideFullToggle' : '#hideFullToggle';
    assert.equal(await page.locator(id).getAttribute('aria-checked'), 'true');
    if (await page.locator('.show-more-btn').count()) await page.locator('.show-more-btn').click();
    await page.waitForTimeout(300);
    assert.equal(await page.locator(ROW_LABEL).count(), 0); // ook niet uit de echte data
    await zoek(page, 'Proefstuk Volle Zaal');
    const rijen = page.locator('#agendaList .show-row');
    // beschikbaar, onbekend en DOK6 beschikbaar.
    assert.equal(await rijen.count(), 3);
    assert.equal(await page.locator('#agendaList .status-badge--afgelast').count(), 0);
    await zoek(page, 'Proefstuk Helemaal Vol');
    assert.equal(await rijen.count(), 0);
    assert.match(await page.locator('#emptyState').innerText(), /Geen voorstellingen gevonden voor "Proefstuk Helemaal Vol" met deze filters/);
    assert.equal(page.fouten.length, 0, page.fouten.join('\n'));
    await ctx.close();
  });
}

test('schakelaar "Verberg volle voorstellingen": zelfde naam, standaard uit, keuze onthouden; watchlist-filter en teller kloppen', async () => {
  const { ctx, page } = await openApp({ viewport: { width: 1280, height: 900 }, extraShows: VOL });
  for (const id of ['#sidebarHideFullToggle', '#hideFullToggle']) {
    assert.equal(await page.locator('.toggle-row', { has: page.locator(id) }).locator('.toggle-row-label').textContent(), 'Verberg volle voorstellingen');
  }
  assert.equal(await page.locator('#sidebarHideFullToggle').getAttribute('aria-checked'), 'false');
  // Volle voorstelling op de watchlist: zichtbaar met de schakelaar uit, weg met de schakelaar aan.
  await page.goto(`${base}#/show/helemaal-4`);
  await page.waitForTimeout(300);
  await page.click('#detailWatchBtn');
  await page.goto(`${base}#/`);
  await page.waitForTimeout(300);
  await page.click('#sidebarWatchlistOnlyToggle');
  await page.waitForTimeout(300);
  assert.equal(await page.locator('#agendaList .show-row', { hasText: 'Proefstuk Helemaal Vol' }).count(), 2);
  await page.click('#sidebarHideFullToggle');
  await page.waitForTimeout(300);
  assert.equal(await page.locator('#agendaList .show-row', { hasText: 'Proefstuk Helemaal Vol' }).count(), 0);
  await page.click('#sidebarWatchlistOnlyToggle');
  await page.waitForTimeout(300);
  // Teller "Toon … verder in de toekomst" telt alleen wat je dan ook ziet.
  const teller = (await page.locator('.show-more-btn').count()) ? await page.locator('.show-more-btn').innerText() : null;
  if (teller) {
    const n = Number(teller.match(/\d+/)[0]);
    const zichtbaar = await page.locator('#agendaList .show-row').count();
    await page.click('.show-more-btn');
    await page.waitForTimeout(400);
    assert.equal(await page.locator('#agendaList .show-row').count(), zichtbaar + n);
    assert.equal(await page.locator(ROW_LABEL).count(), 0);
  }
  // Onthouden na herladen.
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(300);
  assert.equal(await page.locator('#sidebarHideFullToggle').getAttribute('aria-checked'), 'true');
  assert.equal(page.fouten.length, 0, page.fouten.join('\n'));
  await ctx.close();
});

// Contrast (WCAG) tussen twee CSS-kleuren "rgb(r, g, b)".
function contrast(a, b) {
  const lum = (c) => {
    const [r, g, bl] = c.match(/\d+/g).map(Number).map((v) => v / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

for (const viewport of [{ width: 390, height: 900 }, { width: 1280, height: 900 }]) {
  test(`detail: volle data als grijze, doorgestreepte, niet-klikbare blokjes op hun plek (${viewport.width}px)`, async () => {
    const { ctx, page } = await openApp({ viewport, extraShows: VOL });
    await page.goto(`${base}#/show/vol-3`);
    await page.waitForTimeout(400);
    const chips = page.locator('#detailOtherDates .chip');
    assert.equal(await chips.count(), 5);
    const klassen = await chips.evaluateAll((els) => els.map((e) => e.classList.contains('chip--vol')));
    assert.deepEqual(klassen, [false, true, true, false, false]); // datumvolgorde blijft
    const uit = chips.nth(1);
    assert.equal(await uit.getAttribute('aria-disabled'), 'true');
    assert.equal(await uit.isDisabled(), true);
    const dag = (n) => ['zo', 'ma', 'di', 'woe', 'do', 'vr', 'za'][new Date(`${morgen(n)}T12:00:00`).getDay()];
    const datum = (n) => { const [, m, d] = morgen(n).split('-').map(Number); return `${d} ${['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'][m - 1]}`; };
    assert.equal(await uit.getAttribute('aria-label'), `${dag(4)} ${datum(4)} 20:15, uitverkocht`);
    assert.equal(await chips.nth(2).getAttribute('aria-label'), `${dag(5)} ${datum(5)} 20:15, wachtlijst`);
    assert.equal((await uit.locator('.chip-vol-reden').innerText()).trim(), 'uitverkocht');
    assert.equal((await chips.nth(2).locator('.chip-vol-reden').innerText()).trim(), 'wachtlijst');
    // Doorgestreept, grijs (--soldout-bg / --text-2), contrast ≥ 3:1.
    const stijl = await uit.evaluate((e) => {
      const cs = getComputedStyle(e);
      const root = getComputedStyle(document.documentElement);
      const kleur = (v) => { const t = document.createElement('i'); t.style.color = v; document.body.append(t); const c = getComputedStyle(t).color; t.remove(); return c; };
      return {
        streep: getComputedStyle(e.querySelector('.chip-vol-datum')).textDecorationLine,
        kleur: cs.color,
        achter: cs.backgroundColor,
        tokenAchter: kleur(root.getPropertyValue('--soldout-bg')),
        tokenTekst: kleur(root.getPropertyValue('--text-2')),
      };
    });
    assert.equal(stijl.streep, 'line-through');
    assert.equal(stijl.achter, stijl.tokenAchter);
    assert.equal(stijl.kleur, stijl.tokenTekst);
    assert.ok(contrast(stijl.kleur, stijl.achter) >= 3, `contrast ${contrast(stijl.kleur, stijl.achter)}`);
    // Niet klikbaar en niet focusbaar.
    await uit.click({ force: true });
    await page.waitForTimeout(200);
    assert.match(page.url(), /vol-3$/);
    const gefocust = [];
    for (let i = 0; i < 60; i++) {
      await page.keyboard.press('Tab');
      gefocust.push(await page.evaluate(() => document.activeElement?.classList.contains('chip--vol') ?? false));
    }
    assert.ok(!gefocust.includes(true), 'een vol blokje kreeg focus');
    // Afgelast werkt zoals voorheen: klikbaar, met "(afgelast)".
    assert.match(await chips.nth(3).innerText(), /\(afgelast\)/);
    // Ook te zien bij: DOK6 met één vol blokje en één gewone datum.
    const dok6 = page.locator('.related-theater-group', { hasText: 'DOK6' });
    assert.equal(await dok6.locator('.chip--vol').count(), 1);
    assert.equal(await dok6.locator('.chip--vol').getAttribute('aria-label'), `${dag(4)} ${datum(4)} 20:15, wachtlijst`);
    assert.equal(await dok6.locator('.chip:not(.chip--vol)').count(), 1);
    assert.equal(page.fouten.length, 0, page.fouten.join('\n'));
    await ctx.close();
  });
}

test('eigen plan op een uitverkochte datum: blijft in Gepland, opent het detail; de datum is daar gemarkeerd', async () => {
  const plan = zetStatus(planIn(legeGepland(), VOL[1], 1), planIn(legeGepland(), VOL[1], 1).gepland[0].sleutel, 'kaarten', 2);
  const { ctx, page } = await openApp({ extraShows: VOL, opslag: { 'podiumagenda:gepland': plan } });
  await page.goto(`${base}#/profiel`);
  await page.waitForTimeout(300);
  const rij = page.locator('#geplandList .plan-row', { hasText: 'Proefstuk Volle Zaal' });
  assert.equal(await rij.count(), 1);
  assert.equal(await rij.locator('.plan-flag').count(), 0); // geen "Niet meer in de agenda"
  await rij.locator('.plan-info').click();
  await page.waitForTimeout(300);
  assert.match(page.url(), /#\/show\/vol-4$/);
  const actief = page.locator('#detailOtherDates .chip.is-active');
  assert.equal(await actief.count(), 1);
  assert.equal(await actief.evaluate((e) => e.classList.contains('chip--vol')), true);
  assert.equal(await actief.getAttribute('aria-current'), 'true');
  // Herladen: het plan blijft staan.
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(300);
  assert.equal((await lees(page, 'podiumagenda:gepland')).gepland.length, 1);
  assert.equal(page.fouten.length, 0, page.fouten.join('\n'));
  await ctx.close();
});

test('watchlist met alleen volle data: de rij in Profiel opent nog steeds het detailscherm', async () => {
  const wl = voegToe(legeWatchlist(), { titel: 'Proefstuk Helemaal Vol', theaterId: 'carre' }, 1);
  const { ctx, page } = await openApp({ extraShows: VOL, opslag: { 'podiumagenda:watchlist': wl } });
  await page.goto(`${base}#/profiel`);
  await page.waitForTimeout(300);
  await page.locator('#favoritesList .show-row', { hasText: 'Proefstuk Helemaal Vol' }).click();
  await page.waitForTimeout(300);
  assert.match(page.url(), /#\/show\/helemaal-4$/);
  assert.equal(await page.locator('#detailOtherDates .chip--vol').count(), 2);
  assert.equal(page.fouten.length, 0, page.fouten.join('\n'));
  await ctx.close();
});
