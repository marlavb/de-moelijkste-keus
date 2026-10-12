// Rules rond account verwijderen (vrienden stap 6, okt 2026). Het verwijderen
// zelf gaat via de callable verwijderAccount met de admin SDK (buiten de
// rules). Hier: de pogingentellers zijn voor geen enkele client leesbaar of
// schrijfbaar, en een client kan wat de functie opruimt niet zelf (een plan
// weghalen, een blokkade van een ander, een bericht in andermans inbox).

import { test, before, after, beforeEach } from 'node:test';
import { assertFails } from '@firebase/rules-unit-testing';
import { doc, getDoc, getDocs, setDoc, deleteDoc, collection } from 'firebase/firestore';
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
    await setDoc(doc(d, 'verwijderTellers', '2026-10-12'), { dag: '2026-10-12', per: { anna: 1 } });
    await setDoc(doc(d, 'plannen', 'plan-a'), { eigenaar: 'anna', genodigden: ['bob'] });
    await setDoc(doc(d, 'blokkades', 'carol', 'lijst', 'anna'), { uid: 'anna' });
    await setDoc(doc(d, 'inbox', 'bob', 'berichten', 'b1'), { van: 'anna', soort: 'uitnodiging', planId: 'plan-a' });
  });
});

const db = (uid) => als(omgeving, uid);

test('verwijderTellers: voor niemand leesbaar of schrijfbaar, ook niet voor jezelf', async () => {
  for (const uid of ['anna', 'bob', null]) {
    await assertFails(getDoc(doc(db(uid), 'verwijderTellers', '2026-10-12')));
    await assertFails(getDocs(collection(db(uid), 'verwijderTellers')));
    await assertFails(setDoc(doc(db(uid), 'verwijderTellers', '2026-10-12'), { per: {} }));
    await assertFails(deleteDoc(doc(db(uid), 'verwijderTellers', '2026-10-12')));
  }
});

test('wat de functie opruimt, kan een client niet zelf: eigen plan, blokkade van een ander, bericht bij een ander', async () => {
  await assertFails(deleteDoc(doc(db('anna'), 'plannen', 'plan-a')));
  await assertFails(deleteDoc(doc(db('anna'), 'blokkades', 'carol', 'lijst', 'anna')));
  await assertFails(deleteDoc(doc(db('anna'), 'inbox', 'bob', 'berichten', 'b1')));
});
