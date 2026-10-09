// Schouwburg Hengelo: de echte scraper op ingekorte lijstpagina's en een
// detailpagina met een periode (test/fixtures/hengelo-*.html, uit de cache
// van 9 okt 2026), in Chromium, zonder netwerk.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';

const dir = await mkdtemp(path.join(os.tmpdir(), 'hengelo-'));
process.env.DETAIL_CACHE_DIR = dir;
const { scrapeHengelo, hengeloVolgorde, leesHengeloRegel } = await import('../src/sites/hengelo.js');
const { THEATERS } = await import('../src/lib/config.js');
const theater = THEATERS.find((t) => t.id === 'hengelo');
const lees = (naam) => readFileSync(new URL(`./fixtures/${naam}`, import.meta.url), 'utf-8');

test('Schouwburg Hengelo: twee lijstpagina’s + periode via detailpagina; Podiumpas per zaal; titel/maker uit de URL', async () => {
  const browser = await chromium.launch();
  const urls = [];
  const logs = [];
  let shows;
  try {
    const page = await browser.newPage();
    await page.route('**/*', (r) => {
      const url = new URL(r.request().url());
      urls.push(url.pathname + url.search);
      if (url.pathname === '/theaterprogramma') {
        return r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: lees(url.searchParams.get('page') === '2' ? 'hengelo-programma-2.html' : 'hengelo-programma-1.html') });
      }
      if (url.pathname.startsWith('/wat-n-spul')) return r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: lees('hengelo-detail-periode.html') });
      return r.fulfill({ status: 404, body: '' });
    });
    shows = await scrapeHengelo({ page, theater, robots: { isAllowed: () => true }, waitForTurn: async () => {}, log: (m) => logs.push(m), warn: (m) => logs.push(`WARN ${m}`) });
  } finally {
    await browser.close();
    await rm(dir, { recursive: true, force: true });
  }
  assert.deepEqual(urls, ['/theaterprogramma', '/theaterprogramma?page=2', '/wat-n-spul-hengelose-revue/29-01-2027-20-00']);
  const kort = (s) => `${s.titel} | ${s.maker ?? '-'} | ${s.datum} ${s.tijd} | ${s.beschikbaarheid} | pas ${s.podiumpas} | ${s.zaal ?? s.locatie ?? '?'}`;
  assert.deepEqual(shows.map(kort), [
    'Queen Must Go On | All About The Hits | 2026-10-10 20:00 | beschikbaar | pas true | Rabozaal',
    'Bigi Yari: Welkom thuis, waar niemand op je zit te wachten – Jörgen Raymann | - | 2026-10-10 20:30 | beschikbaar | pas false | Kulturhus Borne | Borne',
    'Afslag Gewist | Debby Petter & Emma Finkers | 2026-10-17 20:30 | beschikbaar | pas false | Kulturhus Borne | Borne',
    'Tot het uiterste gedreven – Thijs Kemperink | - | 2026-10-22 20:00 | uitverkocht | pas true | Rabozaal',
    'Ode aan Rob de Nijs | Puur de Nijs | 2026-10-15 20:30 | beschikbaar | pas true | Middenzaal',
    'Cinekid Festival | - | 2026-10-15 11:00 | onbekend | pas false | Wolvecampfoyer',
    'An evening with Dominic Seldis | Dominic Seldis & Jan-Willem Rozenboom | 2026-10-16 20:30 | uitverkocht | pas false | Kulturhus Borne | Borne',
    "Wat 'n Spul | Hengelose Revue | 2027-01-29 20:00 | beschikbaar | pas null | Rabozaal",
    "Wat 'n Spul | Hengelose Revue | 2027-01-30 20:00 | beschikbaar | pas null | Rabozaal",
    "Wat 'n Spul | Hengelose Revue | 2027-01-31 14:00 | beschikbaar | pas null | Rabozaal",
    "Wat 'n Spul | Hengelose Revue | 2027-02-03 20:00 | beschikbaar | pas null | Rabozaal",
    "Wat 'n Spul | Hengelose Revue | 2027-02-04 20:00 | beschikbaar | pas null | Rabozaal",
    "Wat 'n Spul | Hengelose Revue | 2027-02-05 20:00 | beschikbaar | pas null | Rabozaal",
    'Alle kinderen stinken (6+) | Patrick Duijtshoff en Judith van den Berg | 2026-10-10 15:00 | beschikbaar | pas true | Middenzaal',
    'Demonen – Peter Pannekoek | - | 2027-09-09 20:00 | beschikbaar | pas false | ?',
  ]);
  const thijs = shows.find((s) => s.titel.startsWith('Tot het uiterste'));
  assert.equal(thijs.beschrijving, 'voorpremière');
  assert.equal(shows.find((s) => s.titel === 'Cinekid Festival').beschrijving, 'i.s.m. Tetem');
  assert.equal(shows.find((s) => s.titel === "Wat 'n Spul").prijs, 21.5);
  assert.match(shows.find((s) => s.titel === "Wat 'n Spul").podiumpasNoot, /regionale voorstellingen\? Nog niet bekend/);
  assert.equal(shows.filter((s) => 'podiumpasNoot' in s).length, 6, 'alleen bij Regionaal');
  assert.match(shows[0].reserverenUrl, /^https:\/\/bestellen\.schouwburghengelo\.nl\/bestel\/\d+$/);
  assert.ok(logs.some((l) => /weggelaten: De kunst van leven tot het laatst \(1\)/.test(l)), logs.join('\n'));
  assert.equal(logs.some((l) => /WARN/.test(l)), false, logs.join('\n'));
});

test('Hengelo: datumregel en volgorde titel/maker uit de slug', () => {
  assert.deepEqual(leesHengeloRegel('Za 17 okt. 2026 - 20:30 uur - Kulturhus Borne'), { datum: '2026-10-17', tijd: '20:30', plek: 'Kulturhus Borne' });
  assert.equal(leesHengeloRegel('Do 12 nov. t/m Za 14 nov. 2026 - Middenzaal'), null);
  const B = 'https://www.schouwburghengelo.nl/';
  assert.deepEqual(hengeloVolgorde(`${B}bruto-boban-braspenning/17-10-2026-20-00`, 'Boban Braspenning', 'BRUTO'), { voorstelling: 'BRUTO', artiest: 'Boban Braspenning' });
  assert.deepEqual(hengeloVolgorde(`${B}winged-kalpanarts/09-10-2026-20-30`, 'Kalpanarts', 'Winged'), { voorstelling: 'Winged', artiest: 'Kalpanarts' });
  assert.equal(hengeloVolgorde(`${B}schulhoff-trio/11-10-2026-15-00`, 'Schulhoff Trio', 'Stichting Kamermuziek Hengelo'), null, 'twijfel: geen beslissing');
});
