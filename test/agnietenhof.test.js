// Schouwburg Agnietenhof: de echte scraper op een ingekorte agendapagina
// (test/fixtures/agnietenhof-agenda.html, 7 okt 2026) en een nagebouwde
// detailpagina voor kaarten met meer speeldata, in Chromium, zonder netwerk.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

import { scrapeAgnietenhof, agnietenhofStatus } from '../src/sites/agnietenhof.js';
import { THEATERS } from '../src/lib/config.js';

const agenda = readFileSync(new URL('./fixtures/agnietenhof-agenda.html', import.meta.url), 'utf-8');
const theater = THEATERS.find((t) => t.id === 'agnietenhof');

// Detailpagina zoals op het Peppered-platform: li.subshow met data-event-start.
const rij = (start, knop) => `<li class="subshow"><span data-event-start="${start}"></span><div class="buttonBox"><a class="btn" href="/tickets/1">${knop}</a></div></li>`;
const DETAILS = {
  '/agenda/we-will-rock-you-lv4g': [rij('2026-10-07 20:00:00', 'Uitverkocht'), rij('2026-10-11 14:30:00', 'Tickets')],
  '/agenda/rene-van-meurs': [rij('2026-10-14 20:15:00', 'Tickets'), rij('2026-10-15 20:15:00', 'Zet mij op wachtlijst')],
};

test('Agnietenhof: kaarten en detailpagina (Speeldata), films weg, STIP en > €50 zonder Podiumpas', async () => {
  const browser = await chromium.launch();
  const urls = [];
  const logs = [];
  let shows;
  try {
    const page = await browser.newPage();
    await page.route('**/*', (r) => {
      const pad = new URL(r.request().url()).pathname;
      urls.push(pad);
      const detail = Object.entries(DETAILS).find(([p]) => pad.startsWith(p.replace(/-[a-z0-9]{4}$/, '')));
      const body = pad === '/agenda' ? agenda : `<!doctype html><ul>${(detail?.[1] ?? []).join('')}</ul>`;
      return r.fulfill({ status: 200, contentType: 'text/html', body });
    });
    shows = await scrapeAgnietenhof({ page, theater, robots: { isAllowed: () => true }, waitForTurn: async () => {}, log: (m) => logs.push(m), warn: (m) => logs.push(`WARN ${m}`) });
  } finally {
    await browser.close();
  }
  const kort = (s) => `${s.titel} | ${s.datum} ${s.tijd} | ${s.beschikbaarheid} | pas ${s.podiumpas} | ${s.zaal ?? '-'}`;
  assert.deepEqual(shows.map(kort), [
    'We Will Rock You | 2026-10-07 20:00 | uitverkocht | pas false | Kontakt Mediapartners Zaal',
    'We Will Rock You | 2026-10-11 14:30 | beschikbaar | pas false | Kontakt Mediapartners Zaal',
    'Coming Out Day: Christian van Eijkelenburg | 2026-10-10 19:30 | beschikbaar | pas true | ZINDER Zaal',
    'Ridder Ridder (4+) | 2026-10-11 10:30 | wachtlijst | pas false | ZINDER Zaal',
    'Noodzakelijk Kwaad – René van Meurs | 2026-10-14 20:15 | beschikbaar | pas true | Kontakt Mediapartners Zaal',
    'Noodzakelijk Kwaad – René van Meurs | 2026-10-15 20:15 | wachtlijst | pas true | Kontakt Mediapartners Zaal',
    'Bécaud – Frank Cools & Florian de Schepper | 2026-10-15 20:00 | beschikbaar | pas true | Agnietenhof Kleine Zaal',
    'ICE presenteert Khalid Alterch (reprise) | 2026-10-16 20:00 | beschikbaar | pas true | Kontakt Mediapartners Zaal',
  ]);
  // Alleen de twee kaarten met "Speeldata" vragen een detailpagina; films niet.
  assert.deepEqual(urls.filter((u) => u !== '/agenda'), ['/agenda/we-will-rock-you-lv4g', '/agenda/rene-van-meurs-1g2r']);
  assert.equal(shows[2].maker, null);
  assert.equal(shows[2].beschrijving, 'met een nagesprek met Milou Zoer');
  assert.equal(shows[3].maker, 'Vreeken en Van der Pijl');
  assert.equal(shows[3].genre, 'Familie & Jeugd');
  assert.ok(logs.some((l) => /weggelaten: film \(3\)/.test(l)), logs.join('\n'));
  assert.ok(logs.some((l) => /podiumpas: false bij prijs vanaf €64 \(2\), STIP \(1\)/.test(l)), logs.join('\n'));
  assert.equal(logs.some((l) => /WARN/.test(l)), false, logs.join('\n'));
});

test('Agnietenhof: status', () => {
  assert.equal(agnietenhofStatus('Tickets'), 'beschikbaar');
  assert.equal(agnietenhofStatus('Zet mij op wachtlijst'), 'wachtlijst');
  assert.equal(agnietenhofStatus('Uitverkocht'), 'uitverkocht');
  assert.equal(agnietenhofStatus('Geannuleerd'), 'afgelast');
  assert.equal(agnietenhofStatus('Speeldata'), 'onbekend');
});
