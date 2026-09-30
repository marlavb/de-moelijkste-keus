import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  createRowDateResolver,
  classifyPepperedButton,
  createGroupScraper,
  dedupeShows,
  pagineerListing,
} from '../src/lib/peppered.js';

const SEPT_2026 = new Date('2026-09-27T10:00:00');

test('datum: data-event-start heeft voorrang (met jaartal en tijd)', () => {
  const resolve = createRowDateResolver(SEPT_2026);
  assert.deepEqual(resolve({ start: '2027-01-07 20:00:00', dateText: '7 jan', timeText: '20:00' }), { datum: '2027-01-07', tijd: '20:00' });
});

test('datum: zichtbare tekst in de drie notaties', () => {
  const resolve = createRowDateResolver(SEPT_2026);
  assert.deepEqual(resolve({ dateText: 'zo 27 sep 2026', timeText: '14:00' }), { datum: '2026-09-27', tijd: '14:00' });
  assert.deepEqual(resolve({ dateText: '27 sep ’26', timeText: '13:00 - 14:55' }), { datum: '2026-09-27', tijd: '13:00' });
  assert.deepEqual(resolve({ dateText: 'za 10 okt', timeText: '20:15' }), { datum: '2026-10-10', tijd: '20:15' });
  assert.equal(resolve({ dateText: null }), null);
});

test('knopteksten → beschikbaarheid, of overslaan', () => {
  assert.equal(classifyPepperedButton('Bestel kaarten +'), 'beschikbaar');
  assert.equal(classifyPepperedButton('laatste kaarten'), 'beschikbaar');
  assert.equal(classifyPepperedButton('Tickets'), 'beschikbaar');
  assert.equal(classifyPepperedButton('Wachtlijst'), 'wachtlijst');
  assert.equal(classifyPepperedButton('Uitverkocht'), 'uitverkocht');
  assert.equal(classifyPepperedButton('Geweest'), null);
  // Sinds 30 sep 2026 niet meer overgeslagen, maar gemarkeerd.
  assert.equal(classifyPepperedButton('Geannuleerd'), 'afgelast');
  assert.equal(classifyPepperedButton('Afgelast'), 'afgelast');
  assert.equal(classifyPepperedButton('Verkoop elders'), null);
  assert.equal(classifyPepperedButton('Verplaatst'), 'verplaatst');
  assert.equal(classifyPepperedButton('Kaartverkoop binnenkort'), 'onbekend');
  assert.equal(classifyPepperedButton('Met audiodescriptie'), 'onbekend');
  assert.equal(classifyPepperedButton('Tickets via theater'), null);
  assert.equal(classifyPepperedButton('toegang gratis'), 'beschikbaar');
  assert.equal(classifyPepperedButton('zet mij op de wachtlijst'), 'wachtlijst');
  assert.equal(classifyPepperedButton('laatste kaarten via 010 - 458 6400'), 'beschikbaar');
  assert.equal(classifyPepperedButton(null), 'onbekend');
});

test('groepsscraper: één scrape per run, elk lid krijgt alleen de eigen shows', async () => {
  let calls = 0;
  const scrape = createGroupScraper(async () => {
    calls++;
    return [{ theaterId: 'a', id: 1 }, { theaterId: 'b', id: 2 }, { theaterId: 'a', id: 3 }];
  });
  const log = () => {};
  const a = await scrape({ theater: { id: 'a' }, log });
  const b = await scrape({ theater: { id: 'b' }, log });
  assert.equal(calls, 1);
  assert.deepEqual(a.map((s) => s.id), [1, 3]);
  assert.deepEqual(b.map((s) => s.id), [2]);
});

test('groepsscraper: faalt de scrape, dan faalt elk lid (zodat elk terugvalt)', async () => {
  const scrape = createGroupScraper(async () => {
    throw new Error('site weg');
  });
  const log = () => {};
  await assert.rejects(scrape({ theater: { id: 'a' }, log }), /site weg/);
  await assert.rejects(scrape({ theater: { id: 'b' }, log }), /site weg/);
});

test('dedupeShows: toegankelijke variant van dezelfde voorstelling telt niet dubbel', () => {
  const base = { theaterId: 'ks', titel: 'Liefdesbrieven', datum: '2026-10-04', tijd: '15:00' };
  const out = dedupeShows([
    { ...base, id: 'a', beschikbaarheid: 'onbekend', reserverenUrl: 'livetext' },
    { ...base, id: 'a-2', beschikbaarheid: 'beschikbaar', reserverenUrl: 'order' },
    { ...base, tijd: '20:00', id: 'b', beschikbaarheid: 'beschikbaar' },
  ]);
  assert.equal(out.length, 2);
  const first = out.find((s) => s.tijd === '15:00');
  assert.equal(first.beschikbaarheid, 'beschikbaar');
  assert.equal(first.reserverenUrl, 'order');
  assert.equal(first.id, 'a', 'id zonder -2-suffix blijft');
});

// ---------- pagineerListing ----------


// Nep-Playwright-pagina: `paginas(url)` geeft de items voor die URL; de eerste
// evaluate na een goto is (bij leesParameter) de keuzelijst-naam.
function nepPagina({ paginas, parameterNaam = null }) {
  let huidige = null;
  const bezocht = [];
  return {
    bezocht,
    url: () => huidige,
    goto: async (url) => {
      bezocht.push(url);
      huidige = url;
    },
    evaluate: async (fn) => {
      if (/page-selection/.test(String(fn))) return parameterNaam;
      return paginas(huidige);
    },
  };
}

const nepTheater = { baseUrl: 'https://t.test', agendaUrl: 'https://t.test/agenda' };
const alles = { isAllowed: () => true };
const kaarten = (n, van = 0) => Array.from({ length: n }, (_, i) => ({ id: String(van + i) }));

async function pagineer(page, extra = {}) {
  const logs = [];
  const warns = [];
  const items = await pagineerListing({
    page,
    theater: nepTheater,
    robots: alles,
    waitForTurn: async () => {},
    log: (m) => logs.push(m),
    warn: (m) => warns.push(m),
    agendaPath: '/agenda',
    extract: () => {},
    sleutelVan: (k) => k.id,
    maxPages: 10,
    ...extra,
  });
  return { items, logs, warns };
}

test('pagineerListing: parameter uit de keuzelijst, stopt bij niets nieuws', async () => {
  // Zoals sinds sep 2026: ?page=N geeft pagina 1, alleen p54_page werkt.
  const page = nepPagina({
    parameterNaam: 'p54_page',
    paginas: (url) => {
      const n = Number(new URL(url).searchParams.get('p54_page') ?? 1);
      return n <= 3 ? kaarten(20, (n - 1) * 20) : kaarten(20, 0); // voorbij het einde: weer pagina 1
    },
  });
  const { items, warns } = await pagineer(page);
  assert.equal(items.length, 60);
  assert.deepEqual(page.bezocht, [
    'https://t.test/agenda',
    'https://t.test/agenda?p54_page=2',
    'https://t.test/agenda?p54_page=3',
    'https://t.test/agenda?p54_page=4',
  ]);
  assert.deepEqual(warns, []);
});

test('pagineerListing: site die altijd pagina 1 geeft levert geen kopieën op', async () => {
  const page = nepPagina({ paginas: () => kaarten(20) });
  const { items } = await pagineer(page, { leesParameter: false });
  assert.equal(items.length, 20);
  assert.equal(page.bezocht.length, 2);
});

test('pagineerListing: bovengrens bereikt → waarschuwing', async () => {
  let teller = 0;
  const page = nepPagina({ paginas: () => kaarten(5, (teller += 5)) });
  const { items, warns } = await pagineer(page, { maxPages: 4, leesParameter: false });
  assert.equal(items.length, 20);
  assert.equal(warns.length, 1);
  assert.match(warns[0], /bovengrens van 4/);
});

test('pagineerListing: lege pagina 1 met leegIsFout → exception; eigen parameter (sf_paged)', async () => {
  await assert.rejects(pagineer(nepPagina({ paginas: () => [] }), { leegIsFout: true }), /geen agendakaarten/);
  const page = nepPagina({ paginas: (url) => (url.includes('sf_paged=2') ? kaarten(3, 10) : url.includes('sf_paged') ? [] : kaarten(3)) });
  const { items } = await pagineer(page, { parameter: 'sf_paged', leesParameter: false });
  assert.equal(items.length, 6);
  assert.equal(page.bezocht[1], 'https://t.test/agenda?sf_paged=2');
});

test('dedupeShows: afgelaste en gewone rij op hetzelfde tijdstip blijven allebei', () => {
  const rij = { id: 'hnt-a', theaterId: 'hnt', titel: 'A', datum: '2026-10-01', tijd: '20:00', beschikbaarheid: 'beschikbaar' };
  const out = dedupeShows([{ ...rij, id: 'hnt-a-2', beschikbaarheid: 'afgelast' }, rij]);
  assert.deepEqual(out.map((s) => s.beschikbaarheid), ['afgelast', 'beschikbaar']);
});
