// Rabo Theater De Meenthe: de echte scraper op een selectie uit
// /shows.php (test/fixtures/meenthe-shows.json, uit de cache van 9 okt
// 2026), in Chromium, zonder netwerk; en de gedeelde X-com-helpers.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

import { scrapeMeenthe, verwerkMeenthe } from '../src/sites/meenthe.js';
import { amsterdamUitUnix, xcomBeschikbaarheid, xcomToonStatus } from '../src/lib/xcom.js';
import { THEATERS } from '../src/lib/config.js';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/meenthe-shows.json', import.meta.url), 'utf-8'));
const theater = THEATERS.find((t) => t.id === 'meenthe');

async function draai(paginas) {
  const browser = await chromium.launch();
  const urls = [];
  const logs = [];
  try {
    const page = await browser.newPage();
    await page.route('**/*', (r) => {
      const url = new URL(r.request().url());
      urls.push(url.pathname + url.search);
      const p = Number(url.searchParams.get('page'));
      return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(paginas[p - 1]) });
    });
    const shows = await scrapeMeenthe({ page, theater, robots: { isAllowed: () => true }, waitForTurn: async () => {}, log: (m) => logs.push(m), warn: (m) => logs.push(`WARN ${m}`) });
    return { shows, urls, logs };
  } finally {
    await browser.close();
  }
}

test('De Meenthe: twee pagina’s, Podiumpas-uitsluitingen, kerkconcert met locatie, titelcode weg', async () => {
  const helft = Math.ceil(fixture.raw.length / 2);
  const paginas = [
    { ...fixture, raw: fixture.raw.slice(0, helft) },
    { ...fixture, currentPage: 2, raw: fixture.raw.slice(helft) },
  ];
  const { shows, urls, logs } = await draai(paginas);
  assert.deepEqual(urls, ['/shows.php?showtype=theater&page=1', '/shows.php?showtype=theater&page=2']);
  const kort = (s) => `${s.titel} | ${s.datum} ${s.tijd} | ${s.genre} | ${s.beschikbaarheid} | pas ${s.podiumpas} | ${s.zaal ?? s.locatie}`;
  assert.deepEqual(shows.map(kort), [
    'Percossa | 2026-10-09 20:00 | Musical | beschikbaar | pas true | Eleq Theaterzaal',
    'Dennis Hendriks Band | 2026-10-09 21:30 | Muziek & Concert | afgelast | pas false | Dyka Vestzaktheater',
    'Marietta Petkova | 2026-10-11 15:30 | Muziek & Concert | beschikbaar | pas null | De Grote Kerk Blokzijl | Blokzijl',
    '[on]geduldig – Anuar | 2026-10-30 20:00 | Cabaret | beschikbaar | pas true | Eleq Theaterzaal',
    'Beach Boys Best | 2026-10-22 20:00 | Overig | beschikbaar | pas false | Evenementenhal',
    'Waylon | 2026-10-21 20:00 | Muziek & Concert | beschikbaar | pas true | Eleq Theaterzaal',
    'Met stickers beplakte gitaarkisten | 2026-10-31 20:00 | Overig | beschikbaar | pas false | Eleq Theaterzaal',
    'Fred van Leer | 2026-11-04 20:00 | Musical | uitverkocht | pas true | Eleq Theaterzaal',
    'CaDansa | 2026-10-15 11:00 | Overig | onbekend | pas false | De Meenthe',
    'Fest der Blasmusik | 2026-10-31 12:00 | Overig | beschikbaar | pas false | De Meenthe',
    'Mama is boos – Esther van der Voort | 2027-01-15 20:00 | Cabaret | uitverkocht | pas true | Eleq Theaterzaal',
    'Wagyu – Rundfunk | 2027-01-27 20:00 | Cabaret | beschikbaar | pas true | Eleq Theaterzaal',
    'Tapas2000 | 2026-12-21 18:30 | Overig | beschikbaar | pas false | Dyka Vestzaktheater',
  ]);
  assert.equal(shows.find((s) => s.titel === 'Marietta Petkova').podiumpasNoot, 'Geldt de Podiumpas ook voor concerten in de kerk? Nog niet bekend — vraag het theater.');
  assert.equal(shows.filter((s) => 'podiumpasNoot' in s).length, 1, 'alleen bij het kerkconcert');
  const dennis = shows.find((s) => s.titel === 'Dennis Hendriks Band');
  assert.equal(dennis.beschrijving, 'Vrijdagavond Vestzakconcert');
  assert.equal(shows.find((s) => s.titel === 'Percossa').reserverenUrl, 'https://www.demeenthe.nl/theater/voorstellingen/percossa-bommetje/09-10-2026-20-00/');
  assert.ok(logs.includes('weggelaten: passe-partout (1), Mega Bricks (1)'), logs.join('\n'));
  assert.ok(logs.includes('titelcode weggehaald: (R) (2), (T) (1)'), logs.join('\n'));
  assert.equal(logs.some((l) => /WARN/.test(l)), false, logs.join('\n'));
});

test('De Meenthe: geen voorstellingen → exception (geen stille [])', async () => {
  await assert.rejects(draai([{ pages: 1, currentPage: 1, raw: [] }]), /geen voorstellingen/);
});

test('De Meenthe: antwoord zonder "pages" → exception', async () => {
  await assert.rejects(draai([{ raw: fixture.raw }]), /zonder "pages"/);
});

test('X-com: Unix-tijd → Amsterdamse datum en tijd, zomer- en wintertijd', () => {
  assert.deepEqual(amsterdamUitUnix(Date.UTC(2026, 9, 9, 18, 0) / 1000), { datum: '2026-10-09', tijd: '20:00' });
  assert.deepEqual(amsterdamUitUnix(Date.UTC(2027, 0, 15, 19, 0) / 1000), { datum: '2027-01-15', tijd: '20:00' });
  assert.deepEqual(amsterdamUitUnix(Date.UTC(2026, 9, 9, 22, 30) / 1000), { datum: '2026-10-10', tijd: '00:30' });
  assert.equal(amsterdamUitUnix(NaN), null);
});

test('X-com: status → beschikbaarheid, en de getoonde status zoals het site-script', () => {
  assert.equal(xcomBeschikbaarheid('reserveren'), 'beschikbaar');
  assert.equal(xcomBeschikbaarheid('uitverkocht'), 'uitverkocht');
  assert.equal(xcomBeschikbaarheid('geannuleerd'), 'afgelast');
  assert.equal(xcomBeschikbaarheid('geen_webverkoop'), 'onbekend');
  assert.equal(xcomBeschikbaarheid('iets nieuws'), null);
  assert.equal(xcomToonStatus('reserveren', '', 'uitverkocht'), 'uitverkocht');
  assert.equal(xcomToonStatus('reserveren', '', null), 'reserveren');
  assert.equal(xcomToonStatus('uitverkocht', '', 'wachtlijst'), 'wachtlijst');
  assert.equal(xcomToonStatus('reserveren', '', 'geannuleerd'), 'geannuleerd');
});

test('De Meenthe: een vriendenlidmaatschap is geen voorstelling', () => {
  const logs = [];
  const item = (title) => ({ ...fixture.raw[0], title, subtitle: '', itix_from_raw: 1806616740 });
  const shows = verwerkMeenthe([item('Word Vriend van De Meenthe'), item('Word Vriend van het Filmhuis 26/27'), item('Vriendenconcert')], { theater, log: (m) => logs.push(m) });
  assert.deepEqual(shows.map((s) => s.titel), ['Vriendenconcert']);
  assert.ok(logs.includes('weggelaten: vriendenlidmaatschap (2)'), logs.join('\n'));
});
