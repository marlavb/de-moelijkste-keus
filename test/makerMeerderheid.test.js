// Tests voor de maker op productieniveau (src/lib/makerMeerderheid.js).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { pasMakerMeerderheidToe, kiesMaker, makerSleutel } from '../src/lib/makerMeerderheid.js';

let n = 0;
const s = (theaterId, maker, titel = 'Teckel') => ({ id: `${theaterId}-${++n}`, theaterId, titel, maker, datum: '2027-02-11', tijd: '20:30' });

test('lege maker neemt de ene maker over; makerBron bewaard (ook null)', () => {
  const invoer = [s('bellevue', 'Nina van Tongeren'), s('ssu', null), s('schuur', undefined), s('kunstlinie', '  ')];
  const { shows, gewijzigd } = pasMakerMeerderheidToe(invoer);
  assert.deepEqual(shows.map((x) => x.maker), Array(4).fill('Nina van Tongeren'));
  assert.equal(shows[1].makerBron, null);
  assert.equal(shows[2].makerBron, null);
  assert.equal(shows[3].makerBron, '  ');
  assert.equal('makerBron' in shows[0], false);
  assert.equal(gewijzigd, 3);
});

test('oude data zonder makerveld: niets verzonnen', () => {
  const { shows, gewijzigd } = pasMakerMeerderheidToe([{ theaterId: 'a', titel: 'Teckel' }, { theaterId: 'b', titel: 'Teckel' }]);
  assert.equal(gewijzigd, 0);
  assert.equal(shows[0].maker, undefined);
});

test('nooit van een andere productie (andere sleutel) of een theatergebonden titel', () => {
  const { shows } = pasMakerMeerderheidToe([s('a', 'Nina van Tongeren', 'Teckel'), s('b', null, 'Teckel 2'), s('c', 'KOBRA', 'Nora'), s('d', null, 'Nora')]);
  assert.equal(shows[1].maker, null);
  assert.equal(shows[3].maker, null);
});

test('schrijfwijzen tellen samen; meerderheid van de theaters wint, ook over een andere maker heen', () => {
  assert.equal(makerSleutel('Nina van Tongeren / Theater Bellevue'), makerSleutel('Nina van Tongeren – Theater Bellevue'));
  assert.equal(makerSleutel('Linssen & Provily'), makerSleutel('Linssen en Provily'));
  const { shows } = pasMakerMeerderheidToe([
    s('mozaiek', 'Nina van Tongeren / Theater Bellevue'),
    s('zaal3', 'Nina van Tongeren – Theater Bellevue'),
    s('bellevue', 'Nina van Tongeren / Bellevue Producties'),
    s('ssu', null),
  ]);
  // Twee schrijfwijzen met elk één stem: de laagste in tekenvolgorde.
  assert.deepEqual(new Set(shows.map((x) => x.maker)), new Set(['Nina van Tongeren / Theater Bellevue']));
  assert.equal(shows[2].makerBron, 'Nina van Tongeren / Bellevue Producties');
  // Eén stem per theater: tien speeldata bij één theater tellen als één.
  const veel = Array.from({ length: 10 }, () => s('a', 'X'));
  assert.equal(pasMakerMeerderheidToe([...veel, s('b', 'Y'), s('c', 'Y')]).shows[0].maker, 'Y');
});

test('gelijke stand tussen verschillende makers: niets wijzigen, wel als conflict gemeld', () => {
  const conflicten = [];
  const invoer = [s('a', 'Thorn de Vries'), s('b', 'Roeland Fernhout'), s('c', null)];
  const { shows, gewijzigd } = pasMakerMeerderheidToe(invoer, { conflicten });
  assert.equal(gewijzigd, 0);
  assert.deepEqual(shows, invoer);
  assert.equal(conflicten.length, 1);
  assert.equal(conflicten[0].sleutel, 'teckel');
  assert.deepEqual(kiesMaker([{ maker: 'A' }, { maker: 'B' }]), { maker: null, gelijk: true });
  assert.equal(kiesMaker([]), null);
});

test('binnen één theater: data zonder maker krijgen de maker van de andere data', () => {
  const { shows } = pasMakerMeerderheidToe([s('a', 'Jan Beuving'), s('a', null)]);
  assert.equal(shows[1].maker, 'Jan Beuving');
});

test('idempotent: terug naar makerBron en opnieuw toepassen geeft hetzelfde', () => {
  const invoer = [s('a', 'X'), s('b', 'X'), s('c', 'Y'), s('d', null)];
  const { shows } = pasMakerMeerderheidToe(invoer);
  const terug = shows.map(({ makerBron, ...x }) => (makerBron !== undefined ? { ...x, maker: makerBron } : x));
  assert.deepEqual(terug, invoer);
  assert.deepEqual(pasMakerMeerderheidToe(terug).shows, shows);
});
