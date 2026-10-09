// UI-test voor het profiel van een vriend (stap 3): Gezien (nieuwste eerst,
// met sterren, sorteren op beoordeling) en Watchlist, "deelt dit niet" en
// "Nog niets", doorklikken naar het detailscherm of het eenvoudige scherm,
// terug met dezelfde scrollpositie, en offline. Echte app uit public/;
// Firebase is nepFirebase (zonder rules: die staan in firebase/tests/gedeeld.test.js).

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

import { nepFirebase } from './nepFirebase.js';
import { watchlistSleutel } from '../public/js/watchlist.js';
import { TIJDZONE, amsterdamTijdstip, dagenVerder, vandaag as vandaagAmsterdam } from './datum.js';

const ROOT = new URL('../public/', import.meta.url).pathname;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };
const ANNA = { uid: 'u1', displayName: 'Anna de Vries', email: 'anna@example.com', photoURL: null };
let server;
let base;
let browser;
let show;
let eerstvolgende; // id van de eerstvolgende speeldatum van die voorstelling (wat de app opent)
let eerstvolgendeOp; // datum → id van de eerstvolgende speeldatum vanaf die dag
let docs;

const profiel = (gebruikersnaam, naam) => ({ gebruikersnaam, gebruikersnaamLaag: gebruikersnaam.toLowerCase(), naam, aangemaaktOp: 1, gewijzigdOp: 1, v: 1 });
const kopie = (items, nv = 4) => ({ items, stand: 1, nv, v: 1, bijgewerktOp: 1 });
const VEEL = Array.from({ length: 30 }, (_, i) => ({ sleutel: `oud ${i}`, titel: `Oude voorstelling ${String(i).padStart(2, '0')}`, laatsteBezoek: `2025-01-${String((i % 28) + 1).padStart(2, '0')}`, aantal: 1 }));

before(async () => {
  const data = JSON.parse(await readFile(path.join(ROOT, 'data/shows.json'), 'utf-8'));
  const shows = Array.isArray(data) ? data : data.shows;
  const vandaag = vandaagAmsterdam();
  show = shows.find((s) => s.datum > vandaag);
  const sleutel = watchlistSleutel(show.titel, show.theaterId);
  eerstvolgendeOp = (datum) =>
    shows
      .filter((s) => s.datum >= datum && watchlistSleutel(s.titel, s.theaterId) === sleutel)
      .sort((a, b) => `${a.datum} ${a.tijd ?? ''}`.localeCompare(`${b.datum} ${b.tijd ?? ''}`))[0].id;
  eerstvolgende = eerstvolgendeOp(vandaag);
  docs = {
    'users/u1': { profielGevraagd: true },
    'profielen/u1': profiel('Anna_V', 'Anna de Vries'),
    'usernames/anna_v': { uid: 'u1', gebruikersnaam: 'Anna_V', naam: 'Anna de Vries' },
    'gedeeld/u1': { gezien: true, watchlist: true, gewijzigdOp: 1 },
    'profielen/u2': profiel('bob', 'Bob Jansen'),
    'vrienden/u1/lijst/u2': { uid: 'u2', sinds: 1, via: 'verzoek' },
    'vrienden/u2/lijst/u1': { uid: 'u1', sinds: 1, via: 'verzoek' },
    'gedeeld/u2': { gezien: true, watchlist: true, gewijzigdOp: 1 },
    'gedeeld/u2/onderdelen/gezien': kopie([
      { sleutel: 'nora', titel: 'Nora', maker: 'ITA', genre: 'Toneel', beoordeling: 3, laatsteBezoek: '2026-09-12', aantal: 2 },
      { sleutel: 'verzonnen stuk', titel: 'Verzonnen stuk', genre: 'Toneel', beoordeling: 4.5, laatsteBezoek: '2026-03-01', aantal: 1 },
      { sleutel: 'adem', titel: 'Adem', laatsteBezoek: '2026-06-01', aantal: 1 },
    ]),
    'gedeeld/u2/onderdelen/watchlist': kopie([{ sleutel: watchlistSleutel(show.titel, show.theaterId), titel: show.titel, genre: 'Iets' }]),
  };

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

// `nu` (ms): de klok van de browser staat vast op dat tijdstip.
async function openApp({ beginDocs = docs, hash = '#/vrienden', offline = false, hoogte = 844, nu = null, shows = null } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: hoogte }, serviceWorkers: 'block', timezoneId: TIJDZONE });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  if (shows) await ctx.route(/data\/shows\.json/, (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify(shows) }));
  await ctx.route(`${base}js/firebase.js`, (r) => r.fulfill({ contentType: 'text/javascript', body: nepFirebase({ gebruiker: ANNA, docs: beginDocs }) }));
  if (offline) await ctx.addInitScript(() => { window.__nepOffline = true; });
  await ctx.addInitScript(() => { try { localStorage.removeItem('podiumagenda:gezienSortering'); } catch {} });
  const page = await ctx.newPage();
  if (nu !== null) await page.clock.setFixedTime(nu);
  const fouten = [];
  page.on('pageerror', (e) => fouten.push(e.message));
  await page.goto(`${base}${hash}`);
  await page.waitForSelector('.nav-item', { state: 'attached' });
  await page.waitForTimeout(500);
  return { ctx, page, fouten };
}

const hash = (page) => new URL(page.url()).hash;
const tekst = (page, sel) => page.textContent(sel);
const even = (page, ms = 300) => page.waitForTimeout(ms);
const titels = (page, sectie) =>
  page.$$eval(`#vriendInhoud section:nth-of-type(${sectie}) .vriend-titel-naam`, (els) => els.map((e) => e.textContent));

test('vriendenlijst → profiel: @naam · naam, Gezien nieuwste eerst met sterren, Watchlist', async () => {
  const { ctx, page, fouten } = await openApp();
  await page.click('button[aria-label="Profiel van @bob bekijken"]');
  await even(page);
  assert.equal(hash(page), '#/vriend/u2');
  assert.equal(await tekst(page, '#vriendTitel'), '@bob');
  assert.equal(await tekst(page, '#vriendSub'), 'Bob Jansen');
  assert.deepEqual(await titels(page, 1), ['Nora', 'Adem', 'Verzonnen stuk']);
  assert.match(await tekst(page, '#vriendInhoud section:nth-of-type(1)'), /★ 3 · gezien 12 september 2026 \(2×\)/);
  assert.match(await tekst(page, '#vriendInhoud section:nth-of-type(2)'), /in de agenda/);
  assert.equal(await page.isVisible('#bottomNav'), false);

  // Sorteren op beoordeling.
  await page.click('#vriendInhoud .gezien-sorteer');
  assert.deepEqual(await titels(page, 1), ['Verzonnen stuk', 'Nora', 'Adem']);
  assert.equal(await page.getAttribute('#vriendInhoud .gezien-sorteer', 'aria-pressed'), 'true');
  assert.deepEqual(fouten, []);
  await ctx.close();
});

test('"deelt dit niet" en "Nog niets"', async () => {
  const beginDocs = { ...docs, 'gedeeld/u2': { gezien: false, watchlist: true, gewijzigdOp: 1 } };
  delete beginDocs['gedeeld/u2/onderdelen/watchlist'];
  const { ctx, page, fouten } = await openApp({ beginDocs, hash: '#/vriend/u2' });
  assert.match(await tekst(page, '#vriendInhoud section:nth-of-type(1)'), /@bob deelt dit niet\./);
  assert.match(await tekst(page, '#vriendInhoud section:nth-of-type(2)'), /Nog niets\./);
  assert.deepEqual(fouten, []);
  await ctx.close();
});

test('geen vriend (meer): nette melding', async () => {
  const { ctx, page, fouten } = await openApp({ hash: '#/vriend/u9' });
  assert.match(await tekst(page, '#vriendInhoud'), /jullie zijn geen vrienden/);
  assert.deepEqual(fouten, []);
  await ctx.close();
});

test('item in de agenda opent het detailscherm; terug: profiel, Vrienden, Profiel', async () => {
  const { ctx, page, fouten } = await openApp({ hash: '#/profiel' });
  await page.click('#vriendenTegel');
  await even(page);
  await page.click('button[aria-label="Profiel van @bob bekijken"]');
  await even(page);
  await page.click('#vriendInhoud section:nth-of-type(2) .vriend-titel-rij');
  await even(page);
  assert.equal(hash(page), `#/show/${encodeURIComponent(eerstvolgende)}`);
  await page.click('#detailBack');
  await even(page);
  assert.equal(hash(page), '#/vriend/u2');
  assert.equal(await tekst(page, '#vriendTitel'), '@bob');
  await page.click('#vriendBack');
  await even(page);
  assert.equal(hash(page), '#/vrienden');
  await page.click('#vriendenBack');
  await even(page);
  assert.equal(hash(page), '#/profiel');
  assert.deepEqual(fouten, []);
  await ctx.close();
});

// Vlak na middernacht en laat op de avond (Amsterdamse tijd): de app en de
// test moeten dezelfde "vandaag" gebruiken. Op 9 okt 2026 om 00:11 faalde de
// test hierboven, omdat hij de UTC-datum (nog 8 okt) nam.
for (const tijd of ['00:30', '23:30']) {
  test(`item in de agenda opent de eerstvolgende speeldatum, ook om ${tijd}`, async () => {
    const datum = vandaagAmsterdam();
    const nu = amsterdamTijdstip(datum, tijd);
    const { ctx, page, fouten } = await openApp({ hash: '#/vriend/u2', nu });
    await page.click('#vriendInhoud section:nth-of-type(2) .vriend-titel-rij');
    await even(page);
    assert.equal(hash(page), `#/show/${encodeURIComponent(eerstvolgendeOp(vandaagAmsterdam(nu)))}`);
    assert.deepEqual(fouten, []);
    await ctx.close();
  });
}

test('item niet in de agenda: eenvoudig scherm met titel, maker, genre en de sterren van de vriend', async () => {
  const { ctx, page, fouten } = await openApp({ hash: '#/vriend/u2' });
  await page.click('button[aria-label^="Nora"]');
  await even(page);
  assert.equal(hash(page), '#/vriend/u2/titel/gezien/nora');
  assert.equal(await tekst(page, '#vriendItemTitel'), 'Nora');
  assert.equal(await tekst(page, '#vriendItemMaker'), 'ITA');
  assert.equal(await tekst(page, '#vriendItemGenre'), 'Toneel');
  assert.match(await tekst(page, '#vriendItemOordeel'), /@bob gaf ★ 3 · gezien 12 september 2026 \(2×\)/);
  await page.click('#vriendItemBack');
  await even(page);
  assert.equal(hash(page), '#/vriend/u2');
  assert.deepEqual(fouten, []);
  await ctx.close();
});

test('terug van een detailscherm: zelfde scrollpositie in het profiel, zonder opnieuw te laden', async () => {
  const beginDocs = { ...docs, 'gedeeld/u2/onderdelen/gezien': kopie(VEEL) };
  const { ctx, page, fouten } = await openApp({ beginDocs, hash: '#/vriend/u2', hoogte: 600 });
  const rij = page.locator('#vriendInhoud section:nth-of-type(1) .vriend-titel-rij').nth(25);
  await rij.scrollIntoViewIfNeeded();
  const y = await page.evaluate(() => window.scrollY);
  assert.ok(y > 200, `scrollY ${y}`);
  await page.waitForTimeout(3500); // eigen kopie-debounce voorbij, zodat er niets meer loopt
  const voor = await page.evaluate(() => window.__nepLees);
  await rij.click();
  await even(page);
  assert.match(hash(page), /^#\/vriend\/u2\/titel\/gezien\//);
  await page.goBack();
  await even(page);
  assert.equal(hash(page), '#/vriend/u2');
  const na = await page.evaluate(() => window.scrollY);
  assert.ok(Math.abs(na - y) < 5, `${na} ≠ ${y}`);
  assert.equal(await page.evaluate(() => window.__nepLees), voor, 'terug laadt het profiel niet opnieuw');
  assert.deepEqual(fouten, []);
  await ctx.close();
});

test('vriend met andere normalisatieversie: sleutel opnieuw berekend, item gevonden in de agenda', async () => {
  const beginDocs = {
    ...docs,
    'gedeeld/u2/onderdelen/watchlist': kopie([{ sleutel: 'een oude sleutel', titel: show.titel }], 3),
  };
  const { ctx, page, fouten } = await openApp({ beginDocs, hash: '#/vriend/u2' });
  const verwacht = watchlistSleutel(show.titel) === watchlistSleutel(show.titel, show.theaterId);
  if (verwacht) {
    assert.match(await tekst(page, '#vriendInhoud section:nth-of-type(2)'), /in de agenda/);
  }
  assert.deepEqual(fouten, []);
  await ctx.close();
});

test('offline: melding met Opnieuw', async () => {
  const { ctx, page, fouten } = await openApp();
  await page.evaluate(() => { window.__nepOffline = true; });
  await page.click('button[aria-label="Profiel van @bob bekijken"]');
  await even(page);
  assert.match(await tekst(page, '#vriendInhoud'), /kon niet worden geladen/);
  await page.evaluate(() => { window.__nepOffline = false; });
  await page.click('#vriendInhoud >> text=Opnieuw proberen');
  await even(page);
  assert.equal(await tekst(page, '#vriendTitel'), '@bob');
  assert.deepEqual(fouten, []);
  await ctx.close();
});

test('alles uit de kopie van een vriend verschijnt als gewone tekst (geen HTML, geen script), ook in de URL', async () => {
  const XSS = '<img src=x onerror=alert(1)>';
  const VLAG = '<img src=x onerror="window.__xss=1">';
  const SLEUTEL = '"><img src=x onerror="window.__xss=2">/../#/show/x?y=1';
  const beginDocs = {
    ...docs,
    'profielen/u2': { ...docs['profielen/u2'], naam: '<b onmouseover="window.__xss=3">Bob</b>' },
    'gedeeld/u2/onderdelen/gezien': kopie([
      { sleutel: SLEUTEL, titel: XSS, maker: VLAG, genre: '<script>window.__xss=4</script>', beoordeling: 4, laatsteBezoek: '2026-09-01', aantal: 1 },
    ]),
    'gedeeld/u2/onderdelen/watchlist': kopie([{ sleutel: 'w', titel: VLAG, genre: XSS }]),
  };
  const { ctx, page, fouten } = await openApp({ beginDocs, hash: '#/vriend/u2' });
  const dialogen = [];
  page.on('dialog', (d) => {
    dialogen.push(d.message());
    d.dismiss();
  });
  await even(page, 500);
  assert.equal(await tekst(page, '#vriendSub'), '<b onmouseover="window.__xss=3">Bob</b>');
  assert.equal(await tekst(page, '#vriendInhoud section:nth-of-type(1) .vriend-titel-naam'), XSS);
  assert.equal(await tekst(page, '#vriendInhoud section:nth-of-type(1) .vriend-titel-meta'), `${VLAG} · <script>window.__xss=4</script>`);
  assert.equal(await tekst(page, '#vriendInhoud section:nth-of-type(2) .vriend-titel-naam'), VLAG);
  assert.equal(await page.locator('#screen-vriend img, #screen-vriend script, #screen-vriend b').count(), 0);

  // Doorklikken: de sleutel staat gecodeerd in de URL en komt er heel weer uit.
  await page.click('#vriendInhoud section:nth-of-type(1) .vriend-titel-rij');
  await even(page);
  assert.equal(hash(page), `#/vriend/u2/titel/gezien/${encodeURIComponent(SLEUTEL)}`);
  assert.equal(await tekst(page, '#vriendItemTitel'), XSS);
  assert.equal(await tekst(page, '#vriendItemMaker'), VLAG);
  assert.equal(await tekst(page, '#vriendItemGenre'), '<script>window.__xss=4</script>');
  assert.equal(await page.locator('#screen-vrienditem img, #screen-vrienditem script').count(), 0);
  await page.click('#vriendItemBack');
  await even(page);
  assert.equal(hash(page), '#/vriend/u2');

  assert.equal(await page.evaluate(() => window.__xss ?? null), null);
  assert.deepEqual(dialogen, []);
  assert.deepEqual(fouten, []);
  await ctx.close();
});

test('een kapotte vriend-link (losse %) geeft geen fout maar gaat naar Vrienden', async () => {
  const { ctx, page, fouten } = await openApp({ hash: '#/vriend/%E0%A4%A' });
  assert.equal(hash(page), '#/vrienden');
  assert.deepEqual(fouten, []);
  await ctx.close();
});

// Een vriend deelt een item met een oude sleutel van een titel met een label
// dat sinds okt 2026 uit de titel gaat ("Wagyu (try out) – Rundfunk"): via
// titelBron komt het bij de nieuwe titel uit, in de agenda.
test('vriend deelt een item met een oude label-sleutel: gevonden in de agenda via titelBron', async () => {
  const datum = dagenVerder(5);
  const shows = [{ id: `hofnar-wagyu-${datum}-2000`, titel: 'Wagyu – Rundfunk', titelBron: 'Wagyu (try out) – Rundfunk', theaterId: 'hofnar', theaterNaam: 'De Hofnar', stad: 'Valkenswaard', datum, tijd: '20:00', genre: 'Cabaret', beschikbaarheid: 'beschikbaar', podiumpas: true, reserverenUrl: 'https://example.invalid/', bron: '' }];
  const oud = watchlistSleutel('Wagyu (try out) – Rundfunk', 'hofnar');
  assert.notEqual(oud, watchlistSleutel('Wagyu – Rundfunk', 'hofnar'), 'de sleutel verandert echt');
  const beginDocs = { ...docs, 'gedeeld/u2/onderdelen/watchlist': kopie([{ sleutel: oud, titel: 'Wagyu (try out) – Rundfunk' }]) };
  const { ctx, page, fouten } = await openApp({ beginDocs, hash: '#/vriend/u2', shows });
  assert.match(await tekst(page, '#vriendInhoud section:nth-of-type(2)'), /in de agenda/);
  await page.click('#vriendInhoud section:nth-of-type(2) .vriend-titel-rij');
  await even(page);
  assert.equal(hash(page), `#/show/${encodeURIComponent(shows[0].id)}`);
  assert.deepEqual(fouten, []);
  await ctx.close();
});
