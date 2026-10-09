// Carré: de echte scraper op een ingekorte agenda en drie antwoorden van
// /api/render/voorstelling/<slug> uit de cache van 9 okt 2026
// (test/fixtures/carre-*), in Chromium, zonder netwerk; met een tijdelijke
// detailcache.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';

const dir = await mkdtemp(path.join(os.tmpdir(), 'carre-'));
process.env.DETAIL_CACHE_DIR = dir;
const { scrapeCarre, carreStatus, carreTijdstip } = await import('../src/sites/carre.js');
const { THEATERS } = await import('../src/lib/config.js');
const theater = THEATERS.find((t) => t.id === 'carre');
const lees = (naam) => readFileSync(new URL(`./fixtures/${naam}`, import.meta.url), 'utf-8');
const API = { cats: 'carre-api-cats.json', 'jochem-myjer-net-alsof': 'carre-api-jochem.json', 'joe-jackson-2026': 'carre-api-joe.json' };
const START = Date.parse('2026-10-09T15:00:00Z');

async function draai(nu) {
  const browser = await chromium.launch();
  const api = [];
  const logs = [];
  try {
    const page = await browser.newPage();
    await page.route('**/*', (r) => {
      const url = new URL(r.request().url());
      if (url.pathname === '/agenda') return r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: lees('carre-agenda.html') });
      const slug = url.pathname.match(/^\/api\/render\/voorstelling\/(.+)$/)?.[1];
      if (slug) {
        api.push(slug);
        if (API[slug]) return r.fulfill({ status: 200, contentType: 'application/json', body: lees(API[slug]) });
        return r.fulfill({ status: 500, body: '' });
      }
      return r.fulfill({ status: 404, body: '' });
    });
    const shows = await scrapeCarre({ page, theater, robots: { isAllowed: () => true }, waitForTurn: async () => {}, log: (m) => logs.push(m), warn: (m) => logs.push(`WARN ${m}`), vandaag: '2026-10-09', nu: () => nu });
    return { shows, api, logs };
  } finally {
    await browser.close();
  }
}

test('Carré: speeldata met tijd en status uit de API, Ticketmatic-link, titels van de agenda; zonder API het datumbereik', async (t) => {
  t.after(() => rm(dir, { recursive: true, force: true }));
  const eerste = await draai(START);
  assert.deepEqual(eerste.api.sort(), ['cats', 'jochem-myjer-net-alsof', 'joe-jackson-2026', 'zonder-api']);
  const cats = eerste.shows.filter((s) => s.titel === 'Cats – Het Meesterwerk');
  assert.equal(cats.length, 12);
  assert.deepEqual(cats.slice(0, 4).map((s) => `${s.datum} ${s.tijd} ${s.beschikbaarheid}`), ['2026-10-15 20:00 beschikbaar', '2026-10-16 20:00 beschikbaar', '2026-10-17 20:00 beschikbaar', '2026-10-18 14:00 wachtlijst']);
  assert.match(cats[0].reserverenUrl, /^https:\/\/apps\.ticketmatic\.com\/widgets\/carre\/addtickets\?.*event=36573/);
  assert.equal(cats[0].podiumpas, false);
  assert.equal(cats[0].beschrijving, 'Vernieuwde versie in het Rijksmuseum');
  const jochem = eerste.shows.filter((s) => s.titel === 'JOCHEM MYJER – NET ALSOF');
  assert.ok(jochem.length > 0 && jochem.every((s) => s.beschikbaarheid === 'wachtlijst' && s.tijd), jochem.map((s) => s.datum).join());
  // Joe Jackson: de verkooplink van de API (Ticketmaster).
  const joe = eerste.shows.filter((s) => s.titel.startsWith('Joe Jackson'));
  assert.deepEqual(joe.map((s) => `${s.datum} ${s.tijd}`), ['2026-12-01 20:00', '2026-12-02 20:00']);
  // Zonder API (500): het datumbereik van de agenda, zonder tijd, met een waarschuwing.
  const zonder = eerste.shows.filter((s) => s.titel === 'Zonder API');
  assert.deepEqual(zonder.map((s) => `${s.datum} ${s.tijd} ${s.reserverenUrl}`), ['2026-12-04 null https://carre.nl/voorstelling/zonder-api']);
  assert.ok(eerste.logs.some((l) => /^WARN 1 productie\(s\) zonder API-gegevens/.test(l)), eerste.logs.join('\n'));

  // Een dag later: alleen wat binnen 7 dagen speelt (Cats, Jochem Myjer) en wat ontbrak opnieuw.
  const tweede = await draai(START + 21 * 3_600_000);
  assert.deepEqual(tweede.api.sort(), ['cats', 'jochem-myjer-net-alsof', 'zonder-api']);
  assert.equal(tweede.shows.length, eerste.shows.length);
});

test('Carré: status zoals de site hem bepaalt; tijdstip in Amsterdamse tijd', () => {
  assert.deepEqual(carreStatus('on_sale', null), { beschikbaarheid: 'beschikbaar', belOns: false });
  assert.deepEqual(carreStatus('on_sale', 'last_chance'), { beschikbaarheid: 'beschikbaar', belOns: false });
  assert.deepEqual(carreStatus('on_sale', 'waiting_list'), { beschikbaarheid: 'wachtlijst', belOns: false });
  assert.deepEqual(carreStatus('on_sale', '15685'), { beschikbaarheid: 'uitverkocht', belOns: false });
  assert.deepEqual(carreStatus('on_sale', '15680'), { beschikbaarheid: 'afgelast', belOns: false });
  assert.deepEqual(carreStatus('on_sale', '15681'), { beschikbaarheid: 'beschikbaar', belOns: true });
  assert.deepEqual(carreStatus('sales_not_started', null), { beschikbaarheid: 'onbekend', belOns: false });
  assert.deepEqual(carreTijdstip('2026-10-25T14:00:00+01:00'), { datum: '2026-10-25', tijd: '14:00' });
  assert.equal(carreTijdstip('x'), null);
});
