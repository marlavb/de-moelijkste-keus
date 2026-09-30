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
  const withMelding = buildTheatersJson([{ id: 'c', naam: 'C', stad: 'Z', podiumpas: true, melding: 'Dicht' }]).theaters.c;
  assert.equal(withMelding.melding, 'Dicht');
});

test('theaters.json: gepauzeerd theater krijgt een melding met link naar de eigen agenda', () => {
  const { theaters } = buildTheatersJson([
    { id: 'p', naam: 'P', stad: 'Z', podiumpas: true, agendaUrl: 'https://p.test/agenda', gepauzeerd: { sinds: '2026-09-28', reden: 'x' } },
  ]);
  assert.match(theaters.p.melding, /Agenda tijdelijk niet beschikbaar/);
  assert.equal(theaters.p.meldingLink, 'https://p.test/agenda');
});

test('config: elk podiumpasReserveren heeft een manier om te reserveren', () => {
  for (const t of THEATERS.filter((x) => x.podiumpasReserveren)) {
    const r = t.podiumpasReserveren;
    // online: true = reserveren via de eigen website (tarief "Podiumpas").
    assert.ok(r.online || r.telefoon || r.email || r.formulier, t.id);
    if (r.online) assert.ok(r.toelichting, `${t.id}: online zonder toelichting`);
    assert.ok(t.podiumpas, `${t.id}: reserveerinfo zonder podiumpas`);
  }
  const size = JSON.stringify(buildTheatersJson(THEATERS)).length;
  assert.ok(size < 15000, `theaters.json blijft klein (${size} bytes)`);
});

test('elk theater in config.js heeft een provincie (voor de latere provinciefilter)', async () => {
  const { THEATERS } = await import('../src/lib/config.js');
  const geldig = new Set(['Noord-Holland', 'Zuid-Holland', 'Utrecht', 'Flevoland', 'Limburg', 'Noord-Brabant', 'Gelderland', 'Overijssel', 'Drenthe', 'Groningen', 'Friesland', 'Zeeland']);
  for (const t of THEATERS) assert.ok(geldig.has(t.provincie), `${t.id}: provincie "${t.provincie}"`);
});
