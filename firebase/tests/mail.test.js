// Rules voor mail (stap 5): mailvoorkeur/{uid} alleen voor jezelf, met
// veldcontrole; mailLog en mailTellers voor niemand (alleen de Cloud
// Function via de Admin SDK).

import { test, before, after, beforeEach } from 'node:test';
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, getDocs, setDoc, deleteDoc, collection, serverTimestamp } from 'firebase/firestore';
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
  await zonderRules(omgeving, async (d) => {
    await setDoc(doc(d, 'mailLog', 'P1_bob'), { planId: 'P1', dag: '2026-10-02', status: 'verstuurd', aangemaaktOp: new Date() });
    await setDoc(doc(d, 'mailTellers', '2026-10-02'), { dag: '2026-10-02', totaal: 1, afzender: {}, ontvanger: {} });
  });
});

const db = (uid) => als(omgeving, uid);
const zet = (uid, wie = uid, velden = {}) => setDoc(doc(db(uid), 'mailvoorkeur', wie), { uitnodigingen: false, gewijzigdOp: serverTimestamp(), ...velden });

test('mailvoorkeur: jezelf lezen, zetten, wijzigen en weghalen mag', async () => {
  await assertSucceeds(zet('bob'));
  await assertSucceeds(getDoc(doc(db('bob'), 'mailvoorkeur', 'bob')));
  await assertSucceeds(zet('bob', 'bob', { uitnodigingen: true }));
  await assertSucceeds(deleteDoc(doc(db('bob'), 'mailvoorkeur', 'bob')));
  await assertSucceeds(getDoc(doc(db('bob'), 'mailvoorkeur', 'bob'))); // bestaat niet: mag gelezen worden
});

test('mailvoorkeur van een ander: lezen, zetten en weghalen geweigerd; lijst en uitgelogd ook', async () => {
  await zet('bob');
  await assertFails(getDoc(doc(db('anna'), 'mailvoorkeur', 'bob')));
  await assertFails(zet('anna', 'bob', { uitnodigingen: true }));
  await assertFails(deleteDoc(doc(db('anna'), 'mailvoorkeur', 'bob')));
  await assertFails(getDocs(collection(db('bob'), 'mailvoorkeur')));
  await assertFails(getDoc(doc(db(null), 'mailvoorkeur', 'bob')));
});

test('mailvoorkeur met ongeldige velden: geweigerd', async () => {
  await assertFails(zet('bob', 'bob', { uitnodigingen: 'nee' }));
  await assertFails(zet('bob', 'bob', { email: 'bob@mail.test' }));
  await assertFails(zet('bob', 'bob', { gewijzigdOp: new Date('2020-01-01') }));
  await assertFails(setDoc(doc(db('bob'), 'mailvoorkeur', 'bob'), { uitnodigingen: false }));
});

test('mailLog en mailTellers: voor niemand leesbaar of schrijfbaar', async () => {
  for (const uid of ['bob', 'anna', null]) {
    await assertFails(getDoc(doc(db(uid), 'mailLog', 'P1_bob')));
    await assertFails(getDocs(collection(db(uid), 'mailLog')));
    await assertFails(setDoc(doc(db(uid), 'mailLog', 'P2_bob'), { planId: 'P2' }));
    await assertFails(deleteDoc(doc(db(uid), 'mailLog', 'P1_bob')));
    await assertFails(getDoc(doc(db(uid), 'mailTellers', '2026-10-02')));
    await assertFails(setDoc(doc(db(uid), 'mailTellers', '2026-10-02'), { totaal: 0 }));
  }
});
