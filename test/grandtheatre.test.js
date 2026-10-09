// Grand Theatre: de echte scraper op de programmapagina uit de cache van
// 8 okt 2026 (test/fixtures/grandtheatre-programma.html), in Chromium, zonder
// netwerk. (robots.txt gaf op 8 en 9 okt HTTP 500: geen echte run.)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

import { scrapeGrandTheatre, verwerkGrandTheatre } from '../src/sites/grandtheatre.js';
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

test('Grand Theatre: één pagina, jaar afgeleid, verhuur en externe kaartverkoop zonder Podiumpas', async () => {
  const { shows, urls, logs } = await draai(scrapeGrandTheatre, 'grandtheatre', () => html(lees('grandtheatre-programma.html')));
  assert.deepEqual(urls, ['/nl/programma']);
  assert.ok(shows.length >= 40, `${shows.length} speeldata`);
  const per = (titel) => shows.filter((s) => s.titel === titel);
  assert.deepEqual(per('HYPERPOËZIE').map(kort), ['HYPERPOËZIE | 2026-10-08 20:00 | onbekend | pas true | -']);
  assert.equal(per('HYPERPOËZIE')[0].beschrijving.split(' · ')[0], 'première');
  assert.ok(per('Popronde').every((s) => s.podiumpas === false), 'verhuur/extern');
  const jongeHarten = shows.filter((s) => /jongeharten\.nl/.test(s.reserverenUrl));
  assert.ok(jongeHarten.length > 0 && jongeHarten.every((s) => s.podiumpas === false));
  assert.ok(shows.some((s) => s.datum.startsWith('2027-01')), 'jaarovergang');
  assert.equal(per('Onder de Vulkaan')[0].beschikbaarheid, 'uitverkocht');
  assert.ok(logs.some((l) => /^podiumpas false: /.test(l)), logs.join('\n'));
});

test('Grand Theatre: workshops en kinderactiviteiten weg; tijd ontbreekt → null', () => {
  const theater = THEATERS.find((t) => t.id === 'grandtheatre');
  const ev = (titel, labels, dag = 'za 10 okt', tijd = '20:00') => ({ titel, onder: null, tekst: null, labels, verhuur: false, href: null, speeldata: [{ dag, tijd, knop: 'Tickets', ticket: 'https://grandtheatregroningen.podiumnederland.nl/x' }] });
  const shows = verwerkGrandTheatre([ev('A', ['workshop']), ev('B', ['kinderactiviteit']), ev('C', ['Music and Concerts'], 'zo 11 okt', null)], { theater, referentie: new Date('2026-10-08T12:00:00') });
  assert.deepEqual(shows.map((s) => `${s.titel} ${s.datum} ${s.tijd}`), ['C 2026-10-11 null']);
});
