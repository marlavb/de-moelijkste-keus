import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildTheatersJson } from '../src/lib/theatersJson.js';
import { THEATERS } from '../src/lib/config.js';

test('theaters.json: alle theaters, podiumpasReserveren alleen waar ingevuld', () => {
  const { theaters } = buildTheatersJson([
    { id: 'a', naam: 'A', stad: 'X', podiumpas: true, baseUrl: 'https://a', podiumpasReserveren: { telefoon: '0180' } },
    { id: 'b', naam: 'B', stad: 'Y', podiumpas: false, baseUrl: 'https://b' },
  ]);
  assert.deepEqual(theaters.a, { naam: 'A', stad: 'X', podiumpas: true, podiumpasReserveren: { telefoon: '0180' } });
  assert.deepEqual(theaters.b, { naam: 'B', stad: 'Y', podiumpas: false });
});

test('config: elk podiumpasReserveren heeft een manier om te reserveren', () => {
  for (const t of THEATERS.filter((x) => x.podiumpasReserveren)) {
    const r = t.podiumpasReserveren;
    assert.ok(r.telefoon || r.email || r.formulier, t.id);
    assert.ok(t.podiumpas, `${t.id}: reserveerinfo zonder podiumpas`);
  }
  const size = JSON.stringify(buildTheatersJson(THEATERS)).length;
  assert.ok(size < 15000, `theaters.json blijft klein (${size} bytes)`);
});
