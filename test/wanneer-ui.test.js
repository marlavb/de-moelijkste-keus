// UI-test voor het datumfilter "Wanneer" (okt 2026) in de echte app
// (public/), uitgelogd, met vaste testdata en een vaste klok (wo 14 okt
// 2026, 12:00 Amsterdam). Zelfde opzet als gezien-ui.test.js: een klein
// lokaal servertje, geen service worker, geen netwerk naar buiten.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

import { nepFirebase } from './nepFirebase.js';
import { TIJDZONE, amsterdamTijdstip } from './datum.js';

const ROOT = new URL('../public/', import.meta.url).pathname;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };
const NU = amsterdamTijdstip('2026-10-14', '12:00'); // woensdag
let server;
let base;
let browser;

const show = (titel, datum, theaterId, theaterNaam, stad) => ({
  id: `${theaterId}-${titel.toLowerCase().replace(/\W+/g, '-')}-${datum}`,
  titel,
  theaterId,
  theaterNaam,
  stad,
  podiumpas: true,
  datum,
  tijd: '20:15',
  genre: 'Cabaret',
  genreRuw: 'Cabaret',
  beschikbaarheid: 'beschikbaar',
  beschrijving: null,
  maker: null,
  prijs: null,
  reserverenUrl: 'https://example.invalid/',
  bron: 'https://example.invalid/',
  opgehaaldOp: '2026-10-14T03:00:00Z',
});
const UTRECHT = ['stadsschouwburgutrecht', 'Stadsschouwburg Utrecht', 'Utrecht'];
const AMSTERDAM = ['delamar', 'DeLaMar', 'Amsterdam'];
const SHOWS = [
  show('Woensdag Utrecht', '2026-10-14', ...UTRECHT),
  show('Donderdag Utrecht', '2026-10-15', ...UTRECHT),
  show('Vrijdag Amsterdam', '2026-10-16', ...AMSTERDAM),
  show('Zaterdag Utrecht', '2026-10-17', ...UTRECHT),
  show('Maandag Utrecht', '2026-10-19', ...UTRECHT),
  show('Maandag Amsterdam', '2026-10-19', ...AMSTERDAM),
  show('Donderdag Amsterdam', '2026-10-22', ...AMSTERDAM),
  show('Ver weg Utrecht', '2027-01-07', ...UTRECHT), // do, buiten het 30-dagenvenster
];

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

async function openApp({ viewport = { width: 1280, height: 900 }, opslag = {} } = {}) {
  const ctx = await browser.newContext({ viewport, serviceWorkers: 'block', timezoneId: TIJDZONE });
  await ctx.clock.setFixedTime(new Date(NU));
  await ctx.route(/data\/shows\.json/, (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify(SHOWS) }));
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  await ctx.route(`${base}js/firebase.js`, (r) => r.fulfill({ contentType: 'text/javascript', body: nepFirebase() }));
  await ctx.addInitScript((opslag) => {
    if (sessionStorage.getItem('gevuld')) return;
    sessionStorage.setItem('gevuld', '1');
    for (const [k, v] of Object.entries(opslag)) localStorage.setItem(k, JSON.stringify(v));
  }, opslag);
  const page = await ctx.newPage();
  page.fouten = [];
  page.on('pageerror', (e) => page.fouten.push(e.message));
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.waitForSelector('#agendaList .show-row');
  return { ctx, page };
}

const titels = async (page) => (await page.locator('#agendaList .show-title-text').allInnerTexts()).map((t) => t.trim());
// De teller staat op de filterknop (alleen mobiel zichtbaar): lees het hidden-attribuut.
const badge = (page) => page.evaluate(() => { const b = document.getElementById('filterBadge'); return b.hidden ? 0 : Number(b.textContent); });
const filters = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('podiumagenda:filters') ?? 'null'));

test('Wanneer: weekdagen ma + do samen met stad Utrecht (desktop-sidebar), bewaard en te wissen', async () => {
  const { ctx, page } = await openApp();
  const sidebar = page.locator('#filterSidebar');
  // Dicht bij de start, zoals de andere groepen.
  assert.equal(await sidebar.locator('#sidebarWanneerFilters').isHidden(), true);
  await page.click('#sidebarWanneerHeader');
  assert.equal(await page.getAttribute('#sidebarWanneerHeader', 'aria-expanded'), 'true');
  await sidebar.getByRole('button', { name: 'maandag' }).click();
  await sidebar.getByRole('button', { name: 'donderdag' }).click();
  assert.equal(await sidebar.getByRole('button', { name: 'maandag' }).getAttribute('aria-pressed'), 'true');
  await page.click('#sidebarStadHeader');
  await sidebar.locator('#sidebarCityFilters').getByRole('button', { name: 'Utrecht' }).click();
  // Binnen het 30-dagenvenster; "Ver weg" (7 jan) via "toon meer".
  assert.deepEqual(await titels(page), ['Donderdag Utrecht', 'Maandag Utrecht']);
  assert.equal(await badge(page), 2);
  await page.getByRole('button', { name: /Toon 1 voorstelling verder/ }).click();
  assert.deepEqual(await titels(page), ['Donderdag Utrecht', 'Maandag Utrecht', 'Ver weg Utrecht']);
  assert.deepEqual((await filters(page)).wanneer, { snel: null, van: '', tot: '', dagen: [1, 4] });

  // Bewaard: na herladen dezelfde keuze.
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('#agendaList .show-row');
  assert.deepEqual(await titels(page), ['Donderdag Utrecht', 'Maandag Utrecht']);
  assert.equal(await badge(page), 2);

  // "Filters wissen" wist ook Wanneer.
  await page.click('#sidebarClearFilters');
  assert.equal((await titels(page)).length, 7);
  assert.equal(await badge(page), 0);
  assert.deepEqual((await filters(page)).wanneer, { snel: null, van: '', tot: '', dagen: [] });
  assert.equal(await sidebar.getByRole('button', { name: 'maandag' }).getAttribute('aria-pressed'), 'false');
  assert.equal(page.fouten.length, 0, page.fouten.join('\n'));
  await ctx.close();
});

test('Wanneer: snelkeuzes en eigen datums sluiten elkaar uit; leeg → bestaande melding (mobiel filterpaneel)', async () => {
  const { ctx, page } = await openApp({ viewport: { width: 390, height: 844 } });
  await page.click('#filterToggle');
  const sheet = page.locator('#filterSheet');
  await sheet.getByRole('button', { name: 'Dit weekend' }).click();
  assert.deepEqual(await titels(page), ['Vrijdag Amsterdam', 'Zaterdag Utrecht']);
  await sheet.getByRole('button', { name: 'Volgende week' }).click();
  assert.equal(await sheet.getByRole('button', { name: 'Dit weekend' }).getAttribute('aria-pressed'), 'false');
  assert.deepEqual(await titels(page), ['Maandag Utrecht', 'Maandag Amsterdam', 'Donderdag Amsterdam']);
  // Eigen datum zet de snelkeuze uit; alleen "van" = vanaf (ook voorbij 30 dagen).
  await sheet.getByLabel('Van').fill('2026-10-22');
  assert.equal(await sheet.getByRole('button', { name: 'Volgende week' }).getAttribute('aria-pressed'), 'false');
  assert.deepEqual(await titels(page), ['Donderdag Amsterdam', 'Ver weg Utrecht']);
  // Van = tot: één dag.
  await sheet.getByLabel('Tot en met').fill('2026-10-22');
  assert.deepEqual(await titels(page), ['Donderdag Amsterdam']);
  // Snelkeuze zet de datums weer uit.
  await sheet.getByRole('button', { name: 'Vandaag' }).click();
  assert.equal(await sheet.getByLabel('Van').inputValue(), '');
  assert.deepEqual(await titels(page), ['Woensdag Utrecht']);
  // Met een weekdag die vandaag niet is: leeg, de gewone melding.
  await sheet.getByRole('button', { name: 'zondag' }).click();
  assert.equal(await page.locator('#emptyState').innerText(), 'Geen voorstellingen gevonden voor deze filters.');
  assert.equal(await badge(page), 1);
  // Tikvlakken ≥ 44 px.
  for (const el of [sheet.getByRole('button', { name: 'zondag' }), sheet.getByLabel('Van')]) {
    const box = await el.boundingBox();
    assert.ok(box.height >= 44, `tikvlak ${box.height}`);
  }
  assert.equal(page.fouten.length, 0, page.fouten.join('\n'));
  await ctx.close();
});
