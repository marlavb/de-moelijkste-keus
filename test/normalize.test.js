import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createNumericDayParser, createDutchAbbrevDayParser } from '../src/lib/normalize.js';

const SEPT_2026 = new Date('2026-09-27T10:00:00');

test('numerieke datums (ITA): chronologische agenda rolt over naar 2027', () => {
  const parse = createNumericDayParser(SEPT_2026);
  assert.equal(parse('Zo 27.09'), '2026-09-27');
  assert.equal(parse('Do 31.12'), '2026-12-31');
  assert.equal(parse('Za 02.01'), '2027-01-02');
  assert.equal(parse('Wo 09.06'), '2027-06-09');
});

test('numerieke datums: "02.01" zonder voorgaande datums komt via de weekdag op 2027', () => {
  assert.equal(createNumericDayParser(SEPT_2026)('Za 02.01'), '2027-01-02');
});

test('numerieke datums: zonder weekdag, en ongeldige invoer', () => {
  const parse = createNumericDayParser(SEPT_2026);
  assert.equal(parse('27.09'), '2026-09-27');
  assert.equal(parse('02.01'), '2027-01-02');
  assert.equal(parse('geen datum'), null);
  assert.equal(parse('45.13'), null);
});

test('genre: varianten van samengestelde labels (en/&, /, volgorde) mappen hetzelfde', async () => {
  const { normalizeGenre, normalizeGenreFromList } = await import('../src/lib/genre.js');
  for (const label of ['Jeugd en familie', 'jeugd & familie', 'Familie & Jeugd', 'jeugd/familie', 'familie en jeugd']) {
    assert.equal(normalizeGenre(label), 'Familie & Jeugd', label);
  }
  assert.equal(normalizeGenre('Theater'), 'Toneel');
  assert.equal(normalizeGenre('iets heel nieuws'), 'Overig');
  assert.equal(normalizeGenreFromList(['PREMIÈRE', 'Jeugd en familie']), 'Familie & Jeugd');
});

test('createDutchAbbrevDayParser: weekdag beslist over het jaar (lopende reeks tussendoor)', () => {
  // Bijlmer Parktheater, sep 2026: "do 24 sep" (reeks t/m 17 dec) na "za 3 okt".
  const parse = createDutchAbbrevDayParser(new Date('2026-09-29T10:00:00'));
  assert.equal(parse('wo 30 sep'), '2026-09-30');
  assert.equal(parse('za 3 okt'), '2026-10-03');
  assert.equal(parse('do 24 sep'), '2026-09-24');
  assert.equal(parse('zo 4 okt'), '2026-10-04');
  assert.equal(parse('di 5 jan'), '2027-01-05');
  assert.equal(parse('vr 24 sep'), '2027-09-24');
});

test('createDutchAbbrevDayParser: zonder weekdag de gewone rollover', () => {
  const parse = createDutchAbbrevDayParser(new Date('2026-09-29T10:00:00'));
  assert.equal(parse('3 okt'), '2026-10-03');
  assert.equal(parse('24 sep'), '2027-09-24');
});

test('genres Noord-Brabant (okt 2026): cabaret & comedy → Cabaret, en de nieuwe labels zijn bekend', async () => {
  const { normalizeGenre, isBekendGenre } = await import('../src/lib/genre.js');
  for (const label of ['cabaret & comedy', 'Cabaret & Comedy', 'Comedy & cabaret']) assert.equal(normalizeGenre(label), 'Cabaret', label);
  assert.equal(normalizeGenre('musical & muziektheater'), 'Musical');
  assert.equal(normalizeGenre('Sta-concert'), 'Muziek & Concert');
  for (const label of ['College', 'kennis & personality', 'Personality show', 'Entertainment', 'Toegepast theater', 'Taal', 'Lezing / debat', 'Divers', 'Evenement', 'Event', 'Carnaval', 'Echt Bosch', 'circus & variété']) {
    assert.equal(normalizeGenre(label), 'Overig', label);
    assert.ok(isBekendGenre(label), label);
  }
  // Bestaande labels blijven gelijk.
  assert.equal(normalizeGenre('Theatercollege'), 'Overig');
  assert.equal(normalizeGenre('Met thema Carnaval'), 'Overig');
  assert.equal(isBekendGenre('Met thema Carnaval'), false);
});
