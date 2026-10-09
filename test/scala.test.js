// Scala: de datumlijsten van de 8 producties die tot 9 okt 2026 werden
// overgeslagen (letterlijk uit de log van de nachtrun van 9 okt), plus de
// oude vormen. Scala blijft zonder tijden (avondvullend, zie CLAUDE.md).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDateList } from '../src/sites/scala.js';

const REF = new Date('2026-10-09T12:00:00');
const reeks = (maand, ...dagen) => dagen.map((d) => `2026-${maand}-${String(d).padStart(2, '0')}`);

test('Scala: de 8 overgeslagen datumlijsten (maand voluit, t/m-reeksen, taalvlaggen)', () => {
  const gevallen = [
    ['11, 12, 13, 14, 18, 19, 20 & 21 november', reeks('11', 11, 12, 13, 14, 18, 19, 20, 21)],
    ['12, 14, 18, 19, 21, 25, 26, 27 & 29 november', reeks('11', 12, 14, 18, 19, 21, 25, 26, 27, 29)],
    ['25 t/m 29 november', reeks('11', 25, 26, 27, 28, 29)],
    ['25, 26, 27, 28 & 29 november', reeks('11', 25, 26, 27, 28, 29)],
    ['4 t/m 7 & 11 t/m 14 november', reeks('11', 4, 5, 6, 7, 11, 12, 13, 14)],
    ['4, 5 & 7 november, 9, 10 & 12 december', [...reeks('11', 4, 5, 7), ...reeks('12', 9, 10, 12)]],
    ['6, 13 & 20 november', reeks('11', 6, 13, 20)],
    ['🇳🇱  7, 8 oktober🇬🇧  9, 10, 16, 23, 30 oktober', reeks('10', 7, 8, 9, 10, 16, 23, 30)],
  ];
  let totaal = 0;
  for (const [lijst, verwacht] of gevallen) {
    assert.deepEqual(parseDateList(lijst, REF), verwacht, lijst);
    totaal += verwacht.length;
  }
  assert.equal(totaal, 51);
});

test('Scala: oude vormen blijven werken; reeks over de maandgrens; jaarwisseling', () => {
  assert.deepEqual(parseDateList('21, 22, 28 okt, 2, 3 & 10 nov', REF), ['2026-10-21', '2026-10-22', '2026-10-28', '2026-11-02', '2026-11-03', '2026-11-10']);
  assert.deepEqual(parseDateList('3 sept & 1 okt', new Date('2026-08-01T12:00:00')), ['2026-09-03', '2026-10-01']);
  assert.deepEqual(parseDateList('30 okt t/m 2 nov', REF), ['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02']);
  assert.deepEqual(parseDateList('18 dec, 8 & 9 jan', REF), ['2026-12-18', '2027-01-08', '2027-01-09']);
  assert.deepEqual(parseDateList('binnenkort', REF), []);
});
