// Vrienden zoeken op naam (functions/naamzoeken.js), tegen de Firestore-
// emulator met de Admin SDK: index bijhouden, exacte match, vindbaar uit,
// blokkades, daglimiet en hooguit 10 treffers.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Timestamp } from 'firebase-admin/firestore';
import { admin, wis } from './hulp.js';
import { normaliseerNaam, naamSleutel, indexeerNaam, zoekOpNaam, ZOEK_LIMIET, MAX_TREFFERS } from '../naamzoeken.js';

let db;
beforeEach(async () => {
  ({ db } = admin());
  await wis();
});

async function persoon(uid, naam, { vindbaar = null } = {}) {
  await db.doc(`profielen/${uid}`).set({ gebruikersnaam: uid, gebruikersnaamLaag: uid.toLowerCase(), naam, aangemaaktOp: Timestamp.now(), gewijzigdOp: Timestamp.now(), v: 1 });
  if (vindbaar !== null) await db.doc(`naamvoorkeur/${uid}`).set({ vindbaar, gewijzigdOp: Timestamp.now() });
  await indexeerNaam({ db, uid });
}
const zoek = (uid, invoer, nu) => zoekOpNaam({ db, uid, invoer, nu });

test('normaliseren: hoofdletters, accenten en dubbele spaties maken niet uit; minimaal twee woorden', () => {
  assert.equal(normaliseerNaam('  Zoë   VAN  Dijk '), 'zoe van dijk');
  assert.equal(naamSleutel('Zoë van Dijk'), naamSleutel('zoe  VAN dijk'));
  assert.equal(naamSleutel('Zoë'), null);
  assert.equal(naamSleutel('   '), null);
});

test('exacte volledige naam: gevonden met gebruikersnaam en naam, niet op een deel van de naam; jezelf niet', async () => {
  await persoon('anna', 'Anna de Vries');
  await persoon('bob', 'Bob Jansen');
  assert.deepEqual(await zoek('bob', 'anna DE  vríes'), { status: 'ok', treffers: [{ gebruikersnaam: 'anna', naam: 'Anna de Vries' }] });
  assert.deepEqual(await zoek('bob', 'Anna de'), { status: 'ok', treffers: [] });
  assert.deepEqual(await zoek('bob', 'Anna'), { status: 'ongeldig' });
  assert.deepEqual(await zoek('anna', 'Anna de Vries'), { status: 'ok', treffers: [] });
  // Geen uid's, geen e-mail: alleen deze twee velden.
  const { treffers } = await zoek('bob', 'Anna de Vries');
  assert.deepEqual(Object.keys(treffers[0]).sort(), ['gebruikersnaam', 'naam']);
});

test('vindbaar uit: niet gevonden, uit de index; weer aan: gevonden. Naam wijzigen verplaatst de indexregel', async () => {
  await persoon('anna', 'Anna de Vries');
  await persoon('carol', 'Anna de Vries', { vindbaar: false });
  assert.deepEqual((await zoek('bob', 'Anna de Vries')).treffers.map((t) => t.gebruikersnaam), ['anna']);
  assert.equal((await db.collection(`naamIndex/${naamSleutel('Anna de Vries')}/vermeldingen`).get()).size, 1);
  await db.doc('naamvoorkeur/carol').set({ vindbaar: true, gewijzigdOp: Timestamp.now() });
  assert.equal(await indexeerNaam({ db, uid: 'carol' }), 'gezet');
  assert.deepEqual((await zoek('bob', 'Anna de Vries')).treffers.map((t) => t.gebruikersnaam), ['anna', 'carol']);
  await db.doc('profielen/carol').update({ naam: 'Carol Smit' });
  assert.equal(await indexeerNaam({ db, uid: 'carol' }), 'gezet');
  assert.deepEqual((await zoek('bob', 'Anna de Vries')).treffers.map((t) => t.gebruikersnaam), ['anna']);
  assert.deepEqual((await zoek('bob', 'Carol Smit')).treffers.map((t) => t.gebruikersnaam), ['carol']);
  await db.doc('profielen/carol').delete();
  assert.equal(await indexeerNaam({ db, uid: 'carol' }), 'verwijderd');
  assert.equal((await db.doc('naamIndexLid/carol').get()).exists, false);
  // Een verouderde indexregel (voorkeur uit, nog niet geïndexeerd) geeft toch geen treffer.
  await db.doc('naamvoorkeur/anna').set({ vindbaar: false, gewijzigdOp: Timestamp.now() });
  assert.deepEqual((await zoek('bob', 'Anna de Vries')).treffers, []);
});

test('blokkade in beide richtingen: niet gevonden', async () => {
  await persoon('anna', 'Anna de Vries');
  await persoon('dirk', 'Anna de Vries');
  await db.doc('blokkades/anna/lijst/bob').set({ uid: 'bob', sinds: Timestamp.now() });
  await db.doc('blokkades/bob/lijst/dirk').set({ uid: 'dirk', sinds: Timestamp.now() });
  assert.deepEqual(await zoek('bob', 'Anna de Vries'), { status: 'ok', treffers: [] });
  assert.equal((await zoek('eva', 'Anna de Vries')).treffers.length, 2);
});

test(`daglimiet: ${ZOEK_LIMIET} zoekopdrachten per gebruiker per dag, daarna "limiet"; de volgende dag weer`, async () => {
  await persoon('anna', 'Anna de Vries');
  const nu = Date.parse('2026-10-08T10:00:00Z');
  for (let i = 0; i < ZOEK_LIMIET; i++) assert.equal((await zoek('bob', 'Iemand Anders', nu)).status, 'ok');
  assert.deepEqual(await zoek('bob', 'Anna de Vries', nu), { status: 'limiet' });
  assert.equal((await zoek('eva', 'Anna de Vries', nu)).status, 'ok', 'een ander heeft een eigen teller');
  assert.equal((await zoek('bob', 'Anna de Vries', nu + 24 * 3600 * 1000)).status, 'ok');
  // Ongeldige invoer telt niet mee.
  assert.equal((await zoek('fien', 'Anna', nu)).status, 'ongeldig');
  assert.equal((await db.doc('zoekTellers/2026-10-08').get()).data().per.fien, undefined);
});

test(`hooguit ${MAX_TREFFERS} treffers`, async () => {
  for (let i = 0; i < 13; i++) await persoon(`jan${String(i).padStart(2, '0')}`, 'Jan de Jong');
  const r = await zoek('bob', 'Jan de Jong');
  assert.equal(r.treffers.length, MAX_TREFFERS);
});
