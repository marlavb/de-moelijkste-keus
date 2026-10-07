// Schaffelaartheater: de echte scraper op een nagebouwde sitemap, een
// ingekorte productiepagina (test/fixtures/schaffelaar-productie.html, 7 okt
// 2026) en twee nagebouwde pagina's, in Chromium, zonder netwerk; met de
// detailcache in een tijdelijke map.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';

const dir = await mkdtemp(path.join(os.tmpdir(), 'schaffelaar-'));
process.env.DETAIL_CACHE_DIR = dir;
const { scrapeSchaffelaar, schaffelaarDatum, schaffelaarStatus, agendaUitSitemap } = await import('../src/sites/schaffelaar.js');
const { THEATERS } = await import('../src/lib/config.js');
const theater = THEATERS.find((t) => t.id === 'schaffelaar');

const BASIS = 'https://schaffelaartheater.nl';
const sitemap = `<?xml version="1.0" encoding="utf-8"?><urlset>
  <url><loc>${BASIS}/agenda/</loc><lastmod>2026-09-07T10:57:51+00:00</lastmod></url>
  <url><loc>${BASIS}/agenda/klaas-van-der-eerden/</loc><lastmod>2026-09-30T12:10:24+00:00</lastmod></url>
  <url><loc>${BASIS}/agenda/de-notenkraker/</loc><lastmod>2026-09-01T12:00:00+00:00</lastmod></url>
  <url><loc>${BASIS}/agenda/oud-concert/</loc><lastmod>2025-01-01T12:00:00+00:00</lastmod></url>
  <url><loc>${BASIS}/agenda/archief/</loc><lastmod>2024-01-01T12:00:00+00:00</lastmod></url>
  <url><loc>${BASIS}/agenda/bouke-rocks-elvis/</loc><lastmod>2026-08-01T12:00:00+00:00</lastmod></url>
  <url><loc>${BASIS}/je-bezoek/podiumpas/</loc></url>
</urlset>`;
const pagina = (titel, onder, genre, rijen) => `<!doctype html><article id="production-page">
  <h1 class="production-content-title"><span>${titel[0]}</span>${titel.slice(1)}</h1>
  <p class="production-content-subtitle"><i>${onder}</i></p>
  <div class="production-content-genres"><a class="genre">${genre}</a></div>
  <div class="production-event-orders">${rijen.map(([d, knop, href]) => `<div class="button-group"><div class="event-cta-date">${d}</div><a href="${href}" class="event-cta">${knop}</a></div>`).join('')}</div>
  <div class="production-info-side"><h5>Locatie</h5><p>BDUmedia Grote Zaal</p><table class="pricetable"><td class="price">€ 32,50</td></table></div></article>`;
const PAGINAS = {
  '/agenda/klaas-van-der-eerden/': readFileSync(new URL('./fixtures/schaffelaar-productie.html', import.meta.url), 'utf-8'),
  '/agenda/de-notenkraker/': pagina('De Notenkraker', 'Charkiv City Ballet', 'dans', [
    ['zo. 13-12-2026 | 14:00', 'Laatste kaarten', 'https://www.ticketmaster.nl/event/123'],
    ['zo. 13-12-2026 | 19:30', 'Uitverkocht', ''],
  ]),
  '/agenda/oud-concert/': pagina('Oud concert', 'Iemand', 'muziek', [['za. 11-01-2025 | 20:00', 'Kaarten', '']]),
  // Voorbije productie: alleen het kale sjabloon, zonder #production-page.
  '/agenda/archief/': '<!doctype html><div id="header">Agenda</div><p>Terug naar de agenda</p>',
  '/agenda/bouke-rocks-elvis/': pagina('Bouke Rocks Elvis', 'Een avond vol Elvis-magie', 'show', [['za. 06-02-2027 | 20:00', 'Kaarten', '']]),
};

async function draai() {
  const browser = await chromium.launch();
  const urls = [];
  const logs = [];
  try {
    const page = await browser.newPage();
    await page.route('**/*', (r) => {
      const pad = new URL(r.request().url()).pathname;
      urls.push(pad);
      if (pad === '/sitemap.xml') return r.fulfill({ status: 200, contentType: 'application/xml', body: sitemap });
      return r.fulfill({ status: PAGINAS[pad] ? 200 : 404, contentType: 'text/html', body: PAGINAS[pad] ?? 'weg' });
    });
    const shows = await scrapeSchaffelaar({ page, theater, robots: { isAllowed: () => true }, waitForTurn: async () => {}, log: (m) => logs.push(m), warn: (m) => logs.push(`WARN ${m}`) });
    return { shows, urls, logs };
  } finally {
    await browser.close();
  }
}

test('Schaffelaar: sitemap + productiepagina\'s, cabaretconventie, extern zonder Podiumpas, voorbij weg, detailcache', async (t) => {
  t.after(() => rm(dir, { recursive: true, force: true }));
  const { shows, urls, logs } = await draai();
  const kort = (s) => `${s.titel} | ${s.datum} ${s.tijd} | ${s.beschikbaarheid} | pas ${s.podiumpas} | ${s.zaal} | ${s.maker ?? '-'} | ${s.beschrijving ?? '-'}`;
  assert.deepEqual(shows.map(kort), [
    'Imperfect – Klaas van der Eerden | 2027-03-25 20:00 | beschikbaar | pas true | BDUmedia Grote Zaal | - | Try-out',
    'De Notenkraker | 2026-12-13 14:00 | beschikbaar | pas false | BDUmedia Grote Zaal | Charkiv City Ballet | -',
    'De Notenkraker | 2026-12-13 19:30 | uitverkocht | pas true | BDUmedia Grote Zaal | Charkiv City Ballet | -',
    'Bouke Rocks Elvis | 2027-02-06 20:00 | beschikbaar | pas true | BDUmedia Grote Zaal | - | Een avond vol Elvis-magie',
  ]);
  assert.equal(shows[0].genre, 'Cabaret');
  assert.equal(shows[0].prijs, 28.5);
  assert.match(shows[0].reserverenUrl, /^https:\/\/apps\.ticketmatic\.com\/widgets\/schaffelaartheater\//);
  // Nieuwste lastmod eerst; /agenda/ zelf en andere pagina's niet.
  assert.deepEqual(urls, ['/sitemap.xml', '/agenda/klaas-van-der-eerden/', '/agenda/de-notenkraker/', '/agenda/bouke-rocks-elvis/', '/agenda/oud-concert/', '/agenda/archief/']);
  assert.ok(logs.some((l) => /podiumpas: false bij extern verkocht \(1\)/.test(l)), logs.join('\n'));
  assert.equal(logs.some((l) => /WARN/.test(l)), false, logs.join('\n'));

  // Tweede run: alleen de sitemap; voorbije producties (ook het archief) worden niet meer opgehaald.
  const tweede = await draai();
  assert.deepEqual(tweede.urls, ['/sitemap.xml']);
  assert.deepEqual(tweede.shows.map(kort), shows.map(kort));
  assert.ok(tweede.logs.some((l) => /3 uit de cache, 2 voorbij/.test(l)), tweede.logs.join('\n'));
});

test('Schaffelaar: datum, status en sitemap', () => {
  assert.deepEqual(schaffelaarDatum('do. 25-03-2027 | 20:00'), { datum: '2027-03-25', tijd: '20:00' });
  assert.equal(schaffelaarDatum('binnenkort'), null);
  assert.equal(schaffelaarStatus('Laatste kaarten'), 'beschikbaar');
  assert.equal(schaffelaarStatus('Uitverkocht'), 'uitverkocht');
  assert.equal(schaffelaarStatus('Geannuleerd'), 'afgelast');
  assert.equal(agendaUitSitemap(sitemap, BASIS).length, 5);
});
