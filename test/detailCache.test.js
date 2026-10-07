// Tests voor de cache van detailpagina's tussen runs (src/lib/detailCache.js).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { openDetailCache, moetVerversen, emmer, MAX_DAGEN, BEWAAR_DAGEN } from '../src/lib/detailCache.js';

const DAG = 86_400_000;
const T0 = Date.parse('2026-10-08T03:00:00Z');

test('moetVerversen: nieuw altijd, daarna hooguit één keer per week, verspreid over de weekdagen', () => {
  const url = 'https://www.musis.nl/nl/agenda/x/1';
  assert.equal(moetVerversen(null, url, T0), true);
  // Precies één dag in een week van 7 dagen (de eigen weekdag), plus na 7 dagen altijd.
  const entry = { opgehaaldOp: new Date(T0).toISOString() };
  const dagen = [];
  for (let d = 1; d <= 7; d++) if (moetVerversen(entry, url, T0 + d * DAG)) dagen.push(d);
  assert.ok(dagen.length >= 1 && dagen.length <= 2, dagen.join(','));
  assert.ok(dagen[0] <= MAX_DAGEN);
  assert.equal(moetVerversen(entry, url, T0 + MAX_DAGEN * DAG), true);
  // Dezelfde dag nooit opnieuw.
  assert.equal(moetVerversen(entry, url, T0 + 3_600_000), false);
  // Spreiding: 700 URL's verdelen zich over de 7 weekdagen.
  const tel = Array(7).fill(0);
  for (let i = 0; i < 700; i++) tel[emmer(`https://x.nl/agenda/p-${i}`)]++;
  assert.ok(Math.min(...tel) > 60, tel.join(','));
});

test('openDetailCache: haal() uit de cache of ophalen; mislukt ophalen → oude versie; bewaar() ruimt op', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'detailcache-'));
  let nu = T0;
  const c1 = await openDetailCache('musis', { dir, nu: () => nu });
  let opgehaald = 0;
  const r1 = await c1.haal('a', async () => { opgehaald++; return { zaal: 'Musis' }; });
  assert.deepEqual(r1, { data: { zaal: 'Musis' }, uitCache: false });
  await c1.haal('b', async () => ({ zaal: 'Stadstheater' }));
  await c1.bewaar();
  // Volgende nacht: beide bekend; ophalen alleen op hun weekdag.
  nu = T0 + DAG;
  const c2 = await openDetailCache('musis', { dir, nu: () => nu });
  const r2 = await c2.haal('a', async () => { opgehaald++; return { zaal: 'Musis' }; });
  assert.equal(r2.data.zaal, 'Musis');
  // Mislukt ophalen bij een verlopen item: de oude versie.
  nu = T0 + 8 * DAG;
  const c3 = await openDetailCache('musis', { dir, nu: () => nu });
  const r3 = await c3.haal('b', async () => { throw new Error('time-out'); });
  assert.equal(r3.oud, true);
  assert.equal(r3.data.zaal, 'Stadstheater');
  // Nieuw en mislukt: de fout gaat door.
  await assert.rejects(c3.haal('c', async () => { throw new Error('404'); }), /404/);
  await c3.bewaar();
  // 'a' niet gezien in run 3, maar jonger dan BEWAAR_DAGEN: blijft; na die termijn weg.
  let opgeslagen = JSON.parse(await readFile(path.join(dir, 'musis.json'), 'utf-8'));
  assert.deepEqual(Object.keys(opgeslagen.items).sort(), ['a', 'b']);
  nu = T0 + (BEWAAR_DAGEN + 2) * DAG;
  const c4 = await openDetailCache('musis', { dir, nu: () => nu });
  await c4.haal('b', async () => ({ zaal: 'Stadstheater' }));
  await c4.bewaar();
  opgeslagen = JSON.parse(await readFile(path.join(dir, 'musis.json'), 'utf-8'));
  assert.deepEqual(Object.keys(opgeslagen.items), ['b']);
  assert.ok(opgehaald >= 1);
});
