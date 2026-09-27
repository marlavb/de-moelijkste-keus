import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createRowDateResolver, classifyPepperedButton, createGroupScraper, dedupeShows } from '../src/lib/peppered.js';

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
  assert.equal(classifyPepperedButton('Geannuleerd'), null);
  assert.equal(classifyPepperedButton('Verkoop elders'), null);
  assert.equal(classifyPepperedButton('Verplaatst'), null);
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
