import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createNumericDayParser } from '../src/lib/normalize.js';

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
