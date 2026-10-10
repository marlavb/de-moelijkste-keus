// Aliasvoorstel (src/lib/aliasGroepen.js): groepen, soorten, twijfel en de
// canonieke titel op een kleine vaste agenda. De regels zelf zijn op 10 okt
// 2026 ongewijzigd overgenomen (zelfde uitvoer als het voorstel van 9 okt).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { maakGroepen, maakVoorstel } from '../src/lib/aliasGroepen.js';

const s = (theaterId, titel, maker, datum, genre = 'Cabaret') => ({ theaterId, theaterNaam: theaterId, titel, maker, datum, genre });
const SHOWS = [
  s('a', 'Appeltje Eitje – Nienke Plas', null, '2026-11-01'),
  s('b', 'Appeltje Eitje – Nienke Plas', null, '2026-11-02'),
  s('c', 'Nienke Plas', null, '2026-11-03'),
  s('a', 'The Drama', 'Theater Oostpool', '2026-11-04', 'Toneel'),
  s('d', 'Theater Oostpool – The Drama', 'regie: Florian Myjer', '2026-11-05', 'Toneel'),
  // Voorbij: telt niet mee.
  s('e', 'Oud – Nienke Plas', null, '2026-01-01'),
];

test('aliasvoorstel: maker ontbreekt (e) zonder twijfel; omgedraaid (f) met twijfel; voorbije data tellen niet', () => {
  const groepen = maakGroepen(SHOWS, { vandaag: '2026-10-10' });
  const { resultaat } = maakVoorstel(groepen, SHOWS);
  const plas = resultaat.find((g) => g.anker === 'nienke plas');
  assert.deepEqual(plas.soorten, ['e']);
  assert.deepEqual(plas.twijfel, []);
  assert.equal(plas.canoniek, 'Appeltje Eitje – Nienke Plas');
  assert.deepEqual(plas.sleutels.sort(), ['appeltje eitje | nienke plas', 'nienke plas']);
  assert.ok(!plas.leden.some((l) => l.theater === 'e'));
  const drama = resultaat.find((g) => g.anker === 'theater oostpool');
  assert.deepEqual(drama.soorten, ['f']);
  assert.match(drama.twijfel.join(' '), /omgedraaid/);
  assert.equal(resultaat.length, 2);
});
