// Het bestaande gedrag van users/{uid} (sinds 21 aug 2026, ongewijzigd):
// alleen de ingelogde eigenaar mag lezen en schrijven; een ander niet,
// uitgelogd niets, en buiten users/ is alles dicht.

import { test, before, after, beforeEach } from 'node:test';
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, deleteDoc, collection, getDocs } from 'firebase/firestore';
import { maakOmgeving, als, zonderRules } from './omgeving.js';

let omgeving;
before(async () => {
  omgeving = await maakOmgeving();
});
after(async () => {
  await omgeving?.cleanup();
});
beforeEach(async () => {
  await omgeving.clearFirestore();
  await zonderRules(omgeving, (db) => setDoc(doc(db, 'users/bob'), { favorites: [], enabledTheaters: {} }));
});

test('eigen users-document: lezen, aanmaken, bijwerken (merge) en weghalen mag', async () => {
  const db = als(omgeving, 'alice');
  await assertSucceeds(setDoc(doc(db, 'users/alice'), { favorites: ['x'], watchlist: [] }));
  await assertSucceeds(getDoc(doc(db, 'users/alice')));
  await assertSucceeds(setDoc(doc(db, 'users/alice'), { gepland: [] }, { merge: true }));
  await assertSucceeds(updateDoc(doc(db, 'users/alice'), { gezien: [] }));
  await assertSucceeds(deleteDoc(doc(db, 'users/alice')));
});

test('eigen users-document: willekeurige velden mogen (oude app-versies schrijven vrij)', async () => {
  const db = als(omgeving, 'alice');
  await assertSucceeds(setDoc(doc(db, 'users/alice'), { watErOokMaarIs: { a: 1 }, favoritesMigrated: true }));
});

test('users-document van een ander: lezen en schrijven geweigerd', async () => {
  const db = als(omgeving, 'alice');
  await assertFails(getDoc(doc(db, 'users/bob')));
  await assertFails(setDoc(doc(db, 'users/bob'), { favorites: ['kaap'] }, { merge: true }));
  await assertFails(updateDoc(doc(db, 'users/bob'), { favorites: [] }));
  await assertFails(deleteDoc(doc(db, 'users/bob')));
  await assertFails(setDoc(doc(db, 'users/carol'), { favorites: [] }));
});

test('uitgelogd: niets lezen of schrijven', async () => {
  const db = als(omgeving, null);
  await assertFails(getDoc(doc(db, 'users/bob')));
  await assertFails(setDoc(doc(db, 'users/bob'), { favorites: [] }));
  await assertFails(setDoc(doc(db, 'users/niemand'), { favorites: [] }));
});

test('de users-collectie opvragen (list) mag niemand', async () => {
  await assertFails(getDocs(collection(als(omgeving, 'alice'), 'users')));
  await assertFails(getDocs(collection(als(omgeving, null), 'users')));
});

test('buiten users/ is alles dicht', async () => {
  const db = als(omgeving, 'alice');
  await assertFails(getDoc(doc(db, 'iets/anders')));
  await assertFails(setDoc(doc(db, 'iets/anders'), { a: 1 }));
  await assertFails(setDoc(doc(db, 'users/alice/sub/x'), { a: 1 }));
});
