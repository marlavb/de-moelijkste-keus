// Tests voor de hernoeming van favorieten-sleutels (public/js/favorites.js).
// `persist` staat hier voor de schrijfactie naar localStorage of Firestore.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { RENAMED_FAVORITE_KEYS, renameFavoritesAndPersist } from '../public/js/favorites.js';

const OLD_GONE = 'ita::GONE -  Inspired by Benjamin Clementine';
const NEW_GONE = 'ita::GONE';
const OLD_MAK = 'ita::Geert Mak - een helder theatercollege over de h...';
const NEW_MAK = 'ita::Geert Mak - een helder theatercollege over de huidige situatie in de wereld';
const OTHER = 'delamar::Marcel van Roosmalen';

function spy() {
  const calls = [];
  const persist = (set) => calls.push([...set].sort());
  return { calls, persist };
}

test('oude sleutels → vervangen door de nieuwe, en één keer opgeslagen', () => {
  const { calls, persist } = spy();
  const result = renameFavoritesAndPersist(new Set([OLD_GONE, OLD_MAK, OTHER]), persist);
  assert.deepEqual([...result].sort(), [NEW_GONE, NEW_MAK, OTHER].sort());
  assert.equal(calls.length, 1, 'precies één schrijfactie');
  assert.deepEqual(calls[0], [NEW_GONE, NEW_MAK, OTHER].sort());
});

test('oud én nieuw tegelijk → alleen de oude verdwijnt, en opgeslagen', () => {
  const { calls, persist } = spy();
  const result = renameFavoritesAndPersist(new Set([OLD_GONE, NEW_GONE, OTHER]), persist);
  assert.deepEqual([...result].sort(), [NEW_GONE, OTHER].sort());
  assert.equal(calls.length, 1);
});

test('geen oude sleutels → set ongewijzigd en niets geschreven', () => {
  const { calls, persist } = spy();
  const input = new Set([NEW_GONE, OTHER]);
  const result = renameFavoritesAndPersist(input, persist);
  assert.deepEqual([...result].sort(), [...input].sort());
  assert.equal(calls.length, 0, 'geen schrijfactie');
});

test('idempotent: een tweede keer toepassen schrijft niets meer', () => {
  const { calls, persist } = spy();
  const once = renameFavoritesAndPersist(new Set([OLD_MAK]), persist);
  renameFavoritesAndPersist(once, persist);
  assert.equal(calls.length, 1);
});

test('mapping: 7 ITA-sleutels, oud ≠ nieuw', () => {
  assert.equal(RENAMED_FAVORITE_KEYS.size, 7);
  for (const [oldKey, newKey] of RENAMED_FAVORITE_KEYS) {
    assert.ok(oldKey.startsWith('ita::') && newKey.startsWith('ita::'));
    assert.notEqual(oldKey, newKey);
  }
});
