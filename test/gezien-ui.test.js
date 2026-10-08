// UI-test voor Gezien in de echte app (public/), uitgelogd, met nep-plannen
// in het verleden in localStorage. Zelfde opzet als navigatie.test.js: een
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
  // Een voorstelling met een gewone sleutel (niet theatergebonden, zoals
  // "Cabaret" op de uitsluitlijst) en een titel die geen genrenaam is: de
  // agendarijen worden op titeltekst gefilterd, en "Cabaret" trof ook de rij
  // van een andere voorstelling met het genre Cabaret (data van 2 okt 2026).
  const genres = new Set(shows.map((x) => String(x.genre ?? '').toLowerCase()));
  eenShow = shows.find(
    (s) =>
      s.datum > vandaag &&
      s.beschikbaarheid === 'beschikbaar' &&
      !s.titel.includes('::') &&
      watchlistSleutel(s.titel, s.theaterId) === watchlistSleutel(s.titel) &&
      !genres.has(s.titel.toLowerCase()) &&
      // Zoeken op de titel mag geen andere productie vinden (bv. "Sven Ratzke"
      // naast "KOPFKINO – Sven Ratzke" sinds de data van 7 okt 2026).
      !shows.some(
        (o) =>
          watchlistSleutel(o.titel, o.theaterId) !== watchlistSleutel(s.titel, s.theaterId) &&
          `${o.titel} ${o.titelBron ?? ''} ${o.theaterNaam}`.toLowerCase().includes(s.titel.toLowerCase())
      )
  );
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

test('voorbij plan met kaarten → Gezien, uit de planning en van de watchlist', async () => {
  let g = planIn(legeGepland(), nep('Prikkelarme kermis – Sara Kroos', '2026-09-26', 'delamar', '20:30'), 1);
  g = zetStatus(g, g.gepland[0].sleutel, 'kaarten', 2);
  const wl = voegToe(legeWatchlist(), { titel: 'Prikkelarme kermis – Sara Kroos', theaterId: 'delamar' }, 1);
  const { ctx, page } = await openApp({ opslag: { 'podiumagenda:gepland': g, 'podiumagenda:watchlist': wl } });
  await page.goto(`${base}#/profiel`);
  await page.waitForTimeout(300);
  const gezien = await lees(page, 'podiumagenda:gezien');
  assert.equal(gezien.gezien.length, 1);
  const b = gezien.gezien[0].bezoeken;
  assert.equal(b.length, 1);
  assert.deepEqual([b[0].datum, b[0].tijd, b[0].theaterId, b[0].status], ['2026-09-26', '20:30', 'delamar', 'kaarten']);
  assert.equal((await lees(page, 'podiumagenda:gepland')).gepland.length, 0);
  assert.equal((await lees(page, 'podiumagenda:watchlist')).watchlist.length, 0);
  const rij = await page.locator('#gezienList .gezien-row').first().innerText();
  // Weergavenaam van het theater, nooit het id.
  assert.match(rij, /zaterdag 26 september 2026 · 20:30 · DeLaMar, Amsterdam/);
  assert.equal(page.fouten.length, 0, page.fouten.join('\n'));
  await ctx.close();
});

test('voorbij plan zonder kaarten → vanzelf naar Gezien (bovenaan); geen "Ben je geweest?"; weghalen blijft weg', async () => {
  let g = planIn(legeGepland(), nep('Lemming – reprise – Merijn Scholten', '2026-09-27', 'kleinekomedie'), 1);
  g = planIn(g, nep('Wacht even', '2026-09-28', 'kleinekomedie'), 2);
  // Al op Gezien: een ouder bezoek aan iets anders (moet onder de nieuwe komen).
  const oud = { gezien: [{ sleutel: 'oud stuk', titel: 'Oud stuk', bron: 'handmatig', toegevoegdOp: 5, bezoeken: [{ datum: '2026-08-01', tijd: '20:00', theaterId: 'kleinekomedie' }] }], gezienVerwijderd: [] };
  const { ctx, page } = await openApp({ opslag: { 'podiumagenda:gepland': g, 'podiumagenda:gezien': oud } });
  await page.goto(`${base}#/profiel`);
  await page.waitForTimeout(300);
  assert.equal(await page.getByText('Ben je geweest?').count(), 0);
  assert.equal(await page.getByText('Zonder kaarten vragen we eerst').count(), 0);
  assert.equal(await page.locator('#vraagSection').count(), 0);
  assert.equal(await page.locator('#geplandList .plan-row').count(), 0);
  assert.equal((await lees(page, 'podiumagenda:gepland')).gepland.length, 0);
  // Nieuwste eerst: Wacht even (28 sep), Lemming (27 sep), Oud stuk (1 aug).
  const titels = await page.locator('#gezienList .gezien-row .gezien-titel').allInnerTexts();
  // (Lemming staat ook in de agenda: dan de live weergavetitel.)
  assert.equal(titels.length, 3);
  assert.equal(titels[0].trim(), 'Wacht even');
  assert.match(titels[1], /lemming/i);
  assert.equal(titels[2].trim(), 'Oud stuk');
  // Sterren bij het nieuwe item.
  const rij = page.locator('#gezienList .gezien-row', { hasText: 'Wacht even' });
  assert.equal(await rij.locator('[role="slider"]').count(), 1);
  assert.match(await rij.innerText(), /28 september 2026/);
  // Ten onrechte: weghalen; ook na herladen niet terug.
  await rij.getByRole('button', { name: 'Wacht even van Gezien halen' }).click();
  assert.equal(await page.locator('#gezienList .gezien-row', { hasText: 'Wacht even' }).count(), 0);
  await page.reload({ waitUntil: 'networkidle' });
  await page.goto(`${base}#/profiel`);
  await page.waitForTimeout(300);
  assert.equal(await page.locator('#gezienList .gezien-row', { hasText: 'Wacht even' }).count(), 0);
  const gezien = await lees(page, 'podiumagenda:gezien');
  assert.deepEqual(gezien.gezien.map((i) => i.titel).sort(), ['Lemming – reprise – Merijn Scholten', 'Oud stuk']);
  assert.equal(gezien.gezien.find((i) => /lemming/.test(i.sleutel)).bezoeken.length, 1);
  assert.equal(page.fouten.length, 0, page.fouten.join('\n'));
  await ctx.close();
});

test('oudere index.html met nog het blok "Ben je geweest?": blijft verborgen, plan gaat toch naar Gezien', async () => {
  const blok = `<section class="profile-section profile-section--vraag" id="vraagSection" aria-labelledby="vraagHeading" hidden>
    <div class="section-head"><h2 id="vraagHeading">Ben je geweest?</h2><span id="vraagCount"></span></div>
    <div id="vraagList" aria-live="polite"></div></section>`;
  const oud = (html) => html.replace('<div class="profile-kolom">', `<div class="profile-kolom">${blok}`);
  const g = planIn(legeGepland(), nep('Wacht even', '2026-09-28', 'kleinekomedie'), 1);
  const { ctx, page } = await openApp({ html: oud, opslag: { 'podiumagenda:gepland': g } });
  await page.goto(`${base}#/profiel`);
  await page.waitForTimeout(300);
  assert.equal(await page.locator('#vraagSection').count(), 1);
  assert.equal(await page.locator('#vraagSection').isVisible(), false);
  assert.equal((await lees(page, 'podiumagenda:gezien')).gezien.length, 1);
  assert.equal(page.fouten.length, 0, page.fouten.join('\n'));
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
  assert.match(await page.locator('#melding').innerText(), /Ook van je watchlist gehaald/);
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

test('Profiel: volgorde Gepland → Gezien → Watchlist; lege tekst Gezien', async () => {
  for (const viewport of [{ width: 390, height: 900 }, { width: 1280, height: 900 }]) {
    const desktop = viewport.width >= 900;
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

  }
});

// ---------- Volledige bezoekgegevens en detailschermen (1 okt 2026) ----------

const gisteren = (() => { const d = new Date(); d.setDate(d.getDate() - 1); return d.toISOString().slice(0, 10); })();

function gezienProfiel() {
  // Twee bezoeken aan een voorstelling die niet meer in de agenda staat, met
  // externe locatie; plus een oud bezoek zonder extra velden.
  return {
    gezien: [
      {
        sleutel: 'enfin barbin | marleen hendrickx', titel: 'Enfin, Barbin – Marleen Hendrickx', sleutelTitel: 'Enfin, Barbin – Marleen Hendrickx', theaterId: 'maaspoort', bron: 'planning', toegevoegdOp: 1, gewijzigdOp: 2, v: 4,
        bezoeken: [
          { datum: '2026-09-05', tijd: '20:15', theaterId: 'maaspoort', theaterNaam: 'De Maaspoort Theater & Events', stad: 'Venlo', locatie: 'Theater De Garage | Venlo', titel: 'Enfin, Barbin – Marleen Hendrickx', maker: 'Marleen Hendrickx', genre: 'Toneel', status: 'kaarten', url: 'https://www.maaspoort.nl/programma/enfin-barbin/' },
          { datum: '2026-09-26', tijd: '20:30', theaterId: 'weggehaald-theater', theaterNaam: 'Oud Theater', stad: 'Ergens', titel: 'Enfin, Barbin – Marleen Hendrickx', genre: 'Toneel', status: 'gepland' },
        ],
      },
      { sleutel: 'oud stuk', titel: 'Oud stuk', theaterId: 'delamar', bron: 'planning', toegevoegdOp: 1, bezoeken: [{ datum: '2026-09-12', tijd: null, theaterId: 'delamar' }] },
    ],
    gezienVerwijderd: [],
  };
}

for (const viewport of [{ width: 390, height: 900 }, { width: 1280, height: 900 }]) {
  test(`Profiel Gezien: alle bezoeken met datum, tijd, theater en locatie; nieuwste eerst (${viewport.width}px)`, async () => {
    const { ctx, page } = await openApp({ viewport, opslag: { 'podiumagenda:gezien': gezienProfiel() } });
    await page.goto(`${base}#/profiel`);
    await page.waitForTimeout(300);
    const regels = await page.locator('#gezienList .gezien-row').first().locator('.bezoek').allInnerTexts();
    assert.deepEqual(regels, [
      // Theater niet meer in de config: de bewaarde naam.
      'zaterdag 26 september 2026 · 20:30 · Oud Theater, Ergens',
      'zaterdag 5 september 2026 · 20:15 · De Maaspoort Theater & Events, Venlo · Theater De Garage',
    ]);
    assert.equal(await page.locator('#gezienList .gezien-row').first().locator('.show-genre-tag').textContent(), 'Toneel');
    // Oud bezoek zonder extra velden: theater live via theaterId.
    assert.match(await page.locator('#gezienList .gezien-row', { hasText: 'Oud stuk' }).innerText(), /zaterdag 12 september 2026 · DeLaMar, Amsterdam/);
    assert.equal(page.fouten.length, 0, page.fouten.join('\n'));
    await ctx.close();
  });

  test(`Gezien-item niet meer in de agenda → eenvoudig detail zonder reserveren of plannen (${viewport.width}px)`, async () => {
    const { ctx, page } = await openApp({ viewport, opslag: { 'podiumagenda:gezien': gezienProfiel() } });
    await page.goto(`${base}#/profiel`);
    await page.waitForTimeout(300);
    await page.locator('#gezienList .gezien-titel').first().click();
    await page.waitForTimeout(300);
    assert.match(page.url(), /#\/gezien\//);
    assert.equal(await page.locator('#screen-gezien').isVisible(), true);
    assert.equal(await page.locator('#gezienTitel').innerText(), 'Enfin, Barbin – Marleen Hendrickx');
    assert.equal(await page.locator('#gezienGenre').textContent(), 'Toneel');
    assert.equal(await page.locator('#gezienBezoeken .bezoek').count(), 2);
    assert.equal(await page.locator('#gezienLink').getAttribute('href'), 'https://www.maaspoort.nl/programma/enfin-barbin/');
    assert.equal(await page.locator('#screen-gezien #detailReserveBtn, #screen-gezien #detailPlanBtn').count(), 0);
    await page.click('#gezienBack');
    await page.waitForTimeout(200);
    assert.match(page.url(), /#\/profiel/);
    await ctx.close();
  });
}

test('Gezien-item dat nog in de agenda staat → gewoon detailscherm met blok Gezien', async () => {
  const s = eenShow;
  const profiel = { gezien: [{ sleutel: watchlistSleutel(s.titel, s.theaterId), titel: s.titel, theaterId: s.theaterId, bron: 'handmatig', toegevoegdOp: new Date(2026, 9, 1).getTime(), bezoeken: [] }], gezienVerwijderd: [] };
  const { ctx, page } = await openApp({ opslag: { 'podiumagenda:gezien': profiel } });
  await page.goto(`${base}#/profiel`);
  await page.waitForTimeout(300);
  await page.locator('#gezienList .gezien-titel').first().click();
  await page.waitForTimeout(400);
  assert.match(page.url(), /#\/show\//);
  assert.equal(await page.locator('#detailGezienBlok').isVisible(), true);
  assert.equal(await page.locator('#detailGezienBezoeken .bezoek').innerText(), 'Zelf als gezien aangevinkt op 1 oktober 2026');
  assert.equal(await page.locator('#detailReserveBtn').isVisible(), true);
  await ctx.close();
});

test('Handmatig aanvinken op een voorbije speeldatum bewaart meteen het bezoek', async () => {
  const voorbij = { ...eenShow, id: 'test-gisteren', datum: gisteren, tijd: '20:15', titel: 'Voorbije proefvoorstelling', maker: 'Proefmaker', locatie: 'Theater De Garage | Venlo' };
  const { ctx, page } = await openApp({ extraShows: [voorbij] });
  await page.goto(`${base}#/show/test-gisteren`);
  await page.waitForTimeout(400);
  await page.click('#detailGezienBtn');
  const g = await lees(page, 'podiumagenda:gezien');
  const b = g.gezien[0].bezoeken;
  assert.equal(b.length, 1);
  assert.deepEqual([b[0].datum, b[0].tijd, b[0].theaterId, b[0].locatie, b[0].maker], [gisteren, '20:15', voorbij.theaterId, 'Theater De Garage | Venlo', 'Proefmaker']);
  assert.equal(await page.locator('#detailGezienBlok').isVisible(), true);
  // Toekomstige speeldatum: zelf aangevinkt, zonder bezoek.
  await page.goto(`${base}#/show/${encodeURIComponent(eenShow.id)}`);
  await page.waitForTimeout(300);
  await page.click('#detailGezienBtn');
  const g2 = await lees(page, 'podiumagenda:gezien');
  assert.deepEqual(g2.gezien.find((i) => i.sleutel === watchlistSleutel(eenShow.titel, eenShow.theaterId)).bezoeken, []);
  await ctx.close();
});

// ---------- Sterrencomponent (1 okt 2026) ----------

test('sterren: aria-waarden, toetsenbord, halve/hele ster met tikken, wissen', async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 300 }, serviceWorkers: 'block' });
  await ctx.route(`${base}sterren-proef.html`, (r) =>
    r.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><link rel="stylesheet" href="css/styles.css"><div id="plek"></div><script type="module">
        import { maakSterren } from './js/sterren.js';
        window.wijzigingen = [];
        const el = maakSterren({ waarde: null, label: 'Beoordeling proef', onWijzig: (w) => window.wijzigingen.push(w) });
        document.getElementById('plek').appendChild(el);
      </script>`,
    })
  );
  const page = await ctx.newPage();
  await page.goto(`${base}sterren-proef.html`);
  const s = page.locator('[role="slider"]');
  await s.waitFor();
  assert.equal(await s.getAttribute('aria-valuemin'), '1');
  assert.equal(await s.getAttribute('aria-valuemax'), '5');
  assert.equal(await s.getAttribute('aria-valuenow'), null);
  assert.equal(await s.getAttribute('aria-valuetext'), 'Nog niet beoordeeld');
  // Tikvlak minstens 44 px hoog.
  assert.ok((await page.locator('.ster').first().boundingBox()).height >= 44);
  // Toetsenbord.
  await s.focus();
  await page.keyboard.press('ArrowRight');
  assert.equal(await s.getAttribute('aria-valuenow'), '1');
  await page.keyboard.press('ArrowRight');
  assert.equal(await s.getAttribute('aria-valuetext'), '1,5 van 5 sterren');
  await page.keyboard.press('End');
  assert.equal(await s.getAttribute('aria-valuenow'), '5');
  await page.keyboard.press('ArrowRight');
  assert.equal(await s.getAttribute('aria-valuenow'), '5');
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowLeft');
  assert.equal(await s.getAttribute('aria-valuenow'), '1');
  await page.keyboard.press('Delete');
  assert.equal(await s.getAttribute('aria-valuetext'), 'Nog niet beoordeeld');
  // Tikken: linkerhelft van ster 4 = 3,5; rechterhelft = 4; dezelfde waarde nog eens = wissen.
  const ster4 = await page.locator('.ster').nth(3).boundingBox();
  await page.mouse.click(ster4.x + ster4.width * 0.25, ster4.y + ster4.height / 2);
  assert.equal(await s.getAttribute('aria-valuenow'), '3.5');
  await page.mouse.click(ster4.x + ster4.width * 0.75, ster4.y + ster4.height / 2);
  assert.equal(await s.getAttribute('aria-valuenow'), '4');
  await page.mouse.click(ster4.x + ster4.width * 0.75, ster4.y + ster4.height / 2);
  assert.equal(await s.getAttribute('aria-valuenow'), null);
  // Linkerhelft van de eerste ster geeft 1 (minimum).
  const ster1 = await page.locator('.ster').first().boundingBox();
  await page.mouse.click(ster1.x + 2, ster1.y + ster1.height / 2);
  assert.equal(await s.getAttribute('aria-valuenow'), '1');
  // Halve ster is een echte halve vulling (clipPath van 12 van 24).
  await s.focus();
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.locator('.ster').nth(1).locator('clipPath rect').getAttribute('width'), '12');
  assert.deepEqual(await page.evaluate(() => window.wijzigingen), [1, 1.5, 5, 1, null, 3.5, 4, null, 1, 1.5]);
  await ctx.close();
});

test('beoordeling in de app: sterren bij het automatisch gezien plan; Profiel, detail en agendalabel "Gezien · ★ 4,5"', async () => {
  for (const viewport of [{ width: 390, height: 900 }, { width: 1280, height: 900 }]) {
    const s = eenShow;
    const g = planIn(legeGepland(), nep('Lemming – reprise – Merijn Scholten', '2026-09-27', 'kleinekomedie'), 1);
    const gezienLive = { gezien: [{ sleutel: watchlistSleutel(s.titel, s.theaterId), titel: s.titel, theaterId: s.theaterId, bron: 'handmatig', toegevoegdOp: 5, bezoeken: [] }], gezienVerwijderd: [] };
    const { ctx, page } = await openApp({ viewport, opslag: { 'podiumagenda:gepland': g, 'podiumagenda:gezien': gezienLive } });
    await page.goto(`${base}#/profiel`);
    await page.waitForTimeout(300);
    // 4,5 via het toetsenbord bij het item in Gezien.
    const slider = page.locator('#gezienList .gezien-row', { hasText: 'Lemming' }).locator('[role="slider"]');
    await slider.focus();
    await page.keyboard.press('End');
    await page.keyboard.press('ArrowLeft');
    assert.equal(await slider.getAttribute('aria-valuetext'), '4,5 van 5 sterren');
    assert.match(await page.locator('#melding').innerText(), /Opgeslagen/);
    let opgeslagen = await lees(page, 'podiumagenda:gezien');
    assert.equal(opgeslagen.gezien.find((i) => /lemming/.test(i.sleutel)).beoordeling, 4.5);
    // Profiel → Gezien: cijfer erbij; sorteerknop verschijnt.
    const rij = page.locator('#gezienList .gezien-row', { hasText: 'Lemming' });
    assert.equal(await rij.locator('.beoordeling-cijfer').innerText(), '★ 4,5');
    assert.equal(await page.locator('.gezien-sorteer').isVisible(), true);
    // Detailscherm van de voorstelling die in de agenda staat: sterren in het blok.
    await page.goto(`${base}#/show/${encodeURIComponent(s.id)}`);
    await page.waitForTimeout(300);
    const detailSter = page.locator('#detailGezienBlok [role="slider"]');
    await detailSter.focus();
    await page.keyboard.press('End');
    await page.keyboard.press('ArrowLeft');
    opgeslagen = await lees(page, 'podiumagenda:gezien');
    assert.equal(opgeslagen.gezien.find((i) => i.sleutel === watchlistSleutel(s.titel, s.theaterId)).beoordeling, 4.5);
    // Agenda: label met beoordeling.
    await page.goto(`${base}#/`);
    await page.waitForTimeout(300);
    if (viewport.width >= 900) await page.fill('#sidebarSearchInput', s.titel);
    else { await page.click('#searchToggle'); await page.fill('#searchInput', s.titel); }
    await page.waitForTimeout(500);
    assert.equal(await page.locator('#agendaList .show-row').first().locator('.status-badge--gezien').innerText(), 'Gezien · ★ 4,5');
    assert.equal(page.fouten.length, 0, page.fouten.join('\n'));
    await ctx.close();
  }
});

test('sterren-kleuren: lege rand --nav-inactive, gevulde ster --accent met rand --accent-text', async () => {
  const css = await readFile(path.join(ROOT, 'css/styles.css'), 'utf-8');
  const regel = (sel) => css.match(new RegExp(`${sel.replace(/[.]/g, '\\.')}\\s*\\{([^}]*)\\}`))?.[1] ?? '';
  assert.match(regel('.ster-rand'), /stroke:\s*var\(--nav-inactive\)/);
  assert.match(regel('.ster.is-vol .ster-rand'), /stroke:\s*var\(--accent-text\)/);
  assert.match(regel('.ster-vol'), /fill:\s*var\(--accent\)/);
});
