// De Muze: de echte scraper op ingekorte lijstpagina's uit de cache van
// 8 okt 2026 (test/fixtures/demuze-*), in Chromium, zonder netwerk.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

import { scrapeDeMuze } from '../src/sites/demuze.js';
import { THEATERS } from '../src/lib/config.js';

const lees = (naam) => readFileSync(new URL(`./fixtures/${naam}`, import.meta.url), 'utf-8');
const html = (body, status = 200) => ({ status, contentType: 'text/html; charset=utf-8', body });

async function draai(scraper, id, route) {
  const browser = await chromium.launch();
  const urls = [];
  const logs = [];
  try {
    const page = await browser.newPage();
    await page.route('**/*', (r) => {
      const url = new URL(r.request().url());
      urls.push(url.pathname + url.search);
      return r.fulfill(route(url));
    });
    const theater = THEATERS.find((t) => t.id === id);
    const shows = await scraper({ page, theater, robots: { isAllowed: () => true }, waitForTurn: async () => {}, log: (m) => logs.push(m), warn: (m) => logs.push(`WARN ${m}`) });
    return { shows, urls, logs };
  } finally {
    await browser.close();
  }
}

const kort = (s) => `${s.titel} | ${s.datum} ${s.tijd ?? '-'} | ${s.beschikbaarheid} | pas ${s.podiumpas} | ${s.prijs ?? '-'}${s.zaal ? ` | ${s.zaal}` : ''}`;

test('De Muze: twee pagina’s, carrousel overgeslagen, films en besloten voorstellingen weg, prijs', async () => {
  const { shows, urls, logs } = await draai(scrapeDeMuze, 'demuze', (url) => html(lees(url.pathname.includes('/page/2/') ? 'demuze-programma-2.html' : 'demuze-programma-1.html')));
  assert.deepEqual(urls, ['/programma/', '/programma/page/2/']);
  assert.deepEqual(shows.map(kort), [
    'Stef Bos – Bloemlezing 2026 | 2026-10-09 20:15 | beschikbaar | pas true | 35',
    'De Règâhs – Groeten uit Den Haag | 2026-10-10 20:15 | uitverkocht | pas true | 24.5',
    'Nijntje op de fiets – Klein Amsterdam Producties (2+) | 2026-10-20 10:30 | uitverkocht | pas true | 12.5',
    'Fieke Opdam – Non-Actief | 2026-10-29 20:15 | beschikbaar | pas true | 23.5',
  ]);
  assert.match(shows[2].beschrijving, /^MINI MUZE · /);
  assert.match(shows[0].reserverenUrl, /^https:\/\/tickets\.demuze\.nl\/mtTicket\/performance\/\d+$/);
  assert.ok(logs.includes('weggelaten: film (1), besloten (1)'), logs.join('\n'));
});

