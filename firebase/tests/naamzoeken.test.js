// Rules voor zoeken op naam (okt 2026): naamvoorkeur/{uid} alleen voor
// jezelf, met veldcontrole; de zoekindex (naamIndex, naamIndexLid) en de
// zoektellers voor geen enkele client leesbaar, opsombaar of schrijfbaar,
// ook niet de eigen vermelding (alleen de Cloud Functions via de Admin SDK).

import { test, before, after, beforeEach } from 'node:test';
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, getDocs, setDoc, deleteDoc, collection, collectionGroup, query, where, serverTimestamp } from 'firebase/firestore';
import { maakOmgeving, als, zonderRules } from './omgeving.js';

const SLEUTEL = 'a'.repeat(64);
let omgeving;
before(async () => {
  omgeving = await maakOmgeving();
});
after(async () => {
  await omgeving?.cleanup();
});
beforeEach(async () => {
  await omgeving.clearFirestore();
  await zonderRules(omgeving, async (d) => {
    await setDoc(doc(d, 'naamIndex', SLEUTEL, 'vermeldingen', 'bob'), { uid: 'bob', bijgewerktOp: new Date() });
    await setDoc(doc(d, 'naamIndexLid', 'bob'), { sleutel: SLEUTEL, bijgewerktOp: new Date() });
    await setDoc(doc(d, 'zoekTellers', '2026-10-08'), { dag: '2026-10-08', per: { bob: 3 } });
  });
});

const db = (uid) => als(omgeving, uid);
const zet = (uid, wie = uid, velden = {}) => setDoc(doc(db(uid), 'naamvoorkeur', wie), { vindbaar: false, gewijzigdOp: serverTimestamp(), ...velden });

test('naamvoorkeur: jezelf lezen, zetten, wijzigen en weghalen mag', async () => {
  await assertSucceeds(getDoc(doc(db('bob'), 'naamvoorkeur', 'bob'))); // bestaat nog niet
  await assertSucceeds(zet('bob'));
  await assertSucceeds(zet('bob', 'bob', { vindbaar: true }));
  await assertSucceeds(getDoc(doc(db('bob'), 'naamvoorkeur', 'bob')));
  await assertSucceeds(deleteDoc(doc(db('bob'), 'naamvoorkeur', 'bob')));
});

test('naamvoorkeur van een ander, lijst en uitgelogd: geweigerd; ongeldige velden ook', async () => {
  await zet('bob');
  await assertFails(getDoc(doc(db('anna'), 'naamvoorkeur', 'bob')));
  await assertFails(zet('anna', 'bob', { vindbaar: true }));
  await assertFails(deleteDoc(doc(db('anna'), 'naamvoorkeur', 'bob')));
  await assertFails(getDocs(collection(db('bob'), 'naamvoorkeur')));
  await assertFails(getDoc(doc(db(null), 'naamvoorkeur', 'bob')));
  await assertFails(zet('bob', 'bob', { vindbaar: 'ja' }));
  await assertFails(zet('bob', 'bob', { naam: 'Bob Jansen' }));
  await assertFails(zet('bob', 'bob', { gewijzigdOp: new Date('2020-01-01') }));
});

test('zoekindex: niet lezen, niet opsommen (ook niet als collectiegroep), niet schrijven, ook de eigen vermelding niet', async () => {
  for (const uid of ['bob', 'anna', null]) {
    await assertFails(getDoc(doc(db(uid), 'naamIndex', SLEUTEL)));
    await assertFails(getDoc(doc(db(uid), 'naamIndex', SLEUTEL, 'vermeldingen', 'bob')));
    await assertFails(getDocs(collection(db(uid), 'naamIndex', SLEUTEL, 'vermeldingen')));
    await assertFails(getDocs(collection(db(uid), 'naamIndex')));
    await assertFails(getDocs(query(collectionGroup(db(uid), 'vermeldingen'), where('uid', '==', 'bob'))));
    await assertFails(getDoc(doc(db(uid), 'naamIndexLid', 'bob')));
    await assertFails(getDocs(collection(db(uid), 'naamIndexLid')));
  }
  // Ook voor jezelf: geen eigen vermelding schrijven of weghalen (alleen de functie).
  await assertFails(setDoc(doc(db('anna'), 'naamIndex', SLEUTEL, 'vermeldingen', 'anna'), { uid: 'anna' }));
  await assertFails(setDoc(doc(db('anna'), 'naamIndexLid', 'anna'), { sleutel: SLEUTEL }));
  await assertFails(deleteDoc(doc(db('bob'), 'naamIndex', SLEUTEL, 'vermeldingen', 'bob')));
  await assertFails(deleteDoc(doc(db('bob'), 'naamIndexLid', 'bob')));
});

test('zoekTellers: voor niemand leesbaar of schrijfbaar', async () => {
  for (const uid of ['bob', 'anna', null]) {
    await assertFails(getDoc(doc(db(uid), 'zoekTellers', '2026-10-08')));
    await assertFails(getDocs(collection(db(uid), 'zoekTellers')));
    await assertFails(setDoc(doc(db(uid), 'zoekTellers', '2026-10-08'), { per: {} }));
  }
});
