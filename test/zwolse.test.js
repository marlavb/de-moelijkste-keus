// Zwolse Theaters (Schouwburg Odeon en Theater de Spiegel): de echte
// scraper op de programmapagina, de API en twee detailpagina's (uit de cache
// van 8 en 9 okt 2026, ingekort: test/fixtures/zwolse-*), in Chromium,
// zonder netwerk. De lijst is opgeknipt in twee API-pagina's van 5.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';

const dir = await mkdtemp(path.join(os.tmpdir(), 'zwolse-'));
process.env.DETAIL_CACHE_DIR = dir;
const { scrapeZwolseGroep, zwolsePlek, zwolseDatum, zwolseTijd, zwolseBeschikbaarheid } = await import('../src/sites/zwolse.js');
const { THEATERS } = await import('../src/lib/config.js');
const lees = (naam) => readFileSync(new URL(`./fixtures/${naam}`, import.meta.url), 'utf-8');
const html = (body) => ({ status: 200, contentType: 'text/html; charset=utf-8', body });

test('Zwolse Theaters: lijst via de API, meer speeldata via de detailpagina, verdeeld over Odeon en De Spiegel', async () => {
  const browser = await chromium.launch();
  const urls = [];
  const posts = [];
  const logs = [];
  const resultaat = {};
  try {
    const page = await browser.newPage();
    await page.route('**/*', (r) => {
      const req = r.request();
      const url = new URL(req.url());
      urls.push(url.pathname);
      if (url.pathname === '/programma') return r.fulfill(html(lees('zwolse-programma.html')));
      if (url.pathname === '/api/events/getresults') {
        const q = JSON.parse(req.postData());
        posts.push(`page ${q.page} limit ${q.limit}`);
        // De server negeert een grotere limit (zoals op 9 okt 2026).
        // Pagina 1 met een grotere limit: de server geeft niet alles terug.
        return r.fulfill({ status: 200, contentType: 'application/json', body: q.page === 2 ? lees('zwolse-api-2.json') : JSON.stringify({ data: [] }) });
      }
      if (url.pathname === '/programma/2026-2027/laqua') return r.fulfill(html(lees('zwolse-laqua.html')));
      if (url.pathname === '/programma/2026-2027/claudia-de-breij') return r.fulfill(html(lees('zwolse-claudia.html')));
      return r.fulfill({ status: 404, body: '' });
    });
    const ctx = (id) => ({ page, theater: THEATERS.find((t) => t.id === id), robots: { isAllowed: () => true }, waitForTurn: async () => {}, log: (m) => logs.push(m), warn: (m) => logs.push(`WARN ${m}`) });
    resultaat.odeon = await scrapeZwolseGroep(ctx('odeon'));
    resultaat.despiegel = await scrapeZwolseGroep(ctx('despiegel'));
  } finally {
    await browser.close();
    await rm(dir, { recursive: true, force: true });
  }
  assert.deepEqual(posts, ['page 1 limit 10', 'page 2 limit 5']);
  assert.equal(urls.filter((u) => u === '/programma').length, 1, 'één scrape voor de groep');
  const kort = (s) => `${s.titel} | ${s.maker ?? '-'} | ${s.datum} ${s.tijd} | ${s.beschikbaarheid} | pas ${s.podiumpas} | ${s.prijs ?? '-'} | ${s.zaal ?? s.locatie ?? '-'}`;
  assert.deepEqual(resultaat.odeon.map(kort), [
    'Oudejaarsconference 2026 – Claudia de Breij | - | 2026-10-09 20:00 | uitverkocht | pas true | 13 | Hanzestrohmzaal',
    'BENR | Tussen 2 maten | 2026-10-09 20:30 | beschikbaar | pas true | - | -',
    'Max en de Minipiano 8+ | Het Trojaanse Kalf | 2026-10-10 15:30 | beschikbaar | pas true | - | -',
    'LàQua 0,5 – 3 jaar | Theatro Koreja & Vanaf2 Producties | 2026-10-11 10:30 | beschikbaar | pas true | 14.5 | Dommerholtzaal',
    'LàQua 0,5 – 3 jaar | Theatro Koreja & Vanaf2 Producties | 2026-10-11 12:00 | beschikbaar | pas true | 14.5 | Dommerholtzaal',
    'LàQua 0,5 – 3 jaar | Theatro Koreja & Vanaf2 Producties | 2026-10-11 15:00 | beschikbaar | pas true | 14.5 | Dommerholtzaal',
    'LàQua 0,5 – 3 jaar | Theatro Koreja & Vanaf2 Producties | 2026-10-12 10:30 | beschikbaar | pas true | 14.5 | Dommerholtzaal',
    'LàQua 0,5 – 3 jaar | Theatro Koreja & Vanaf2 Producties | 2026-10-12 12:00 | beschikbaar | pas true | 14.5 | Dommerholtzaal',
    'Groot Zwols Kinderboekenfeest | Berend Boekenvreter 4+ | 2026-10-11 11:00 | beschikbaar | pas true | - | -',
    'Djumbala 2+ | - | 2026-10-13 11:00 | beschikbaar | pas true | - | -',
  ]);
  assert.deepEqual(resultaat.despiegel.map(kort), [
    'Keanu – Henry van Loon | - | 2026-10-09 20:00 | uitverkocht | pas true | - | -',
    'LEMMING – Merijn Scholten | - | 2026-10-10 20:00 | wachtlijst | pas true | - | -',
  ]);
  const claudia = resultaat.odeon[0];
  assert.equal(claudia.beschrijving, 'try-out');
  assert.equal(claudia.reserverenUrl, 'https://www.zwolsetheaters.nl/programma/2026-2027/claudia-de-breij', 'uitverkocht: geen ticketlink');
  assert.match(resultaat.odeon.find((s) => s.titel.startsWith('LàQua')).reserverenUrl, /^https:\/\/apps\.ticketmatic\.com\/widgets\/zwolsetheaters\/addtickets\?.*event=72384/);
  assert.equal(resultaat.odeon.find((s) => s.titel === 'Djumbala 2+').beschrijving, 'Met Vernon Chatlein & Friends · Common Ground for Kids Festival');
  assert.ok(logs.some((l) => /weggelaten: .*meer speeldata, nog geen detailpagina \(2\)/.test(l)), logs.join('\n'));
  // De fixture heeft maar twee detailpagina's; de andere acht geven 404.
  assert.deepEqual(logs.filter((l) => /WARN/.test(l)), ["WARN 8 van 10 detailpagina's mislukt."]);
});

test('Zwolse: plek → theater, datum, tijd en status', () => {
  assert.deepEqual(zwolsePlek('Schouwburg Odeon - Dommerholtzaal'), { theaterId: 'odeon', zaal: 'Dommerholtzaal', locatie: null });
  assert.deepEqual(zwolsePlek('Theater de Spiegel'), { theaterId: 'despiegel', zaal: null, locatie: null });
  assert.deepEqual(zwolsePlek('Academiehuis Grote Kerk'), { theaterId: 'odeon', zaal: null, locatie: 'Academiehuis Grote Kerk | Zwolle' });
  assert.equal(zwolseDatum("zo 11 okt '26"), '2026-10-11');
  assert.equal(zwolseDatum("di 05 jan '27"), '2027-01-05');
  assert.equal(zwolseTijd('10.30 uur'), '10:30');
  assert.equal(zwolseTijd('20:00 uur'), '20:00');
  assert.equal(zwolseBeschikbaarheid('Laatste kaarten'), 'beschikbaar');
  assert.equal(zwolseBeschikbaarheid('Wachtlijst'), 'wachtlijst');
  assert.equal(zwolseBeschikbaarheid('Uitverkocht'), 'uitverkocht');
  assert.equal(zwolseBeschikbaarheid('Onbekend'), 'onbekend');
});
