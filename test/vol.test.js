// Tests voor isVol (public/js/weergave.js): uitverkocht en wachtlijst staan
// niet in de agenda; afgelast, verplaatst en onbekend wel (okt 2026).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { isVol, isVervallen, VOL } from '../public/js/weergave.js';

test('isVol: uitverkocht en wachtlijst, als voorstelling of als status', () => {
  assert.deepEqual(VOL, ['uitverkocht', 'wachtlijst']);
  for (const b of ['uitverkocht', 'wachtlijst']) {
    assert.equal(isVol(b), true, b);
    assert.equal(isVol({ beschikbaarheid: b }), true, b);
    assert.equal(isVervallen(b), false, b);
  }
  for (const b of ['beschikbaar', 'onbekend', 'afgelast', 'verplaatst', undefined, null]) {
    assert.equal(isVol(b), false, String(b));
    assert.equal(isVol({ beschikbaarheid: b }), false, String(b));
  }
  assert.equal(isVol(null), false);
});
