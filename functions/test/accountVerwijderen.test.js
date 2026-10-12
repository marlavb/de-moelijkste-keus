// Account verwijderen (functions/accountVerwijderen.js), tegen de Firestore-
// en Auth-emulator met de Admin SDK: na het verwijderen staat er niets meer
// van die gebruiker, ook niet bij een vriend; de vriend houdt zijn eigen
// gegevens; een tweede keer is geen fout (idempotent); daglimiet.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Timestamp } from 'firebase-admin/firestore';
import { admin, wis, gebruiker, vrienden, plan } from './hulp.js';
import { indexeerNaam } from '../naamzoeken.js';
import { amsterdamDatum } from '../mail.js';
import { verwijderAccount, telPoging, VERWIJDER_LIMIET } from '../accountVerwijderen.js';

let db;
let auth;
beforeEach(async () => {
  ({ db, auth } = admin());
  await wis();
});

/** Alle documenten, ook in subcollecties onder een ontbrekend ouderdocument (vrienden/{x}, inbox/{x}). */
async function alles() {
  const uit = [];
  async function loop(cols) {
    for (const c of cols) {
      for (const ref of await c.listDocuments()) {
        const snap = await ref.get();
        if (snap.exists) uit.push({ pad: ref.path, data: snap.data() });
        await loop(await ref.listCollections());
      }
    }
  }
  await loop(await db.listCollections());
  return uit;
}

const nu = Timestamp.now();
const dag = amsterdamDatum(Date.now());

/** Anna met een vriend (bob), een blokkade (carol), een open verzoek (dirk), plannen, berichten, lijsten. */
async function wereld() {
  for (const uid of ['anna', 'bob', 'carol', 'dirk']) {
    await gebruiker(uid);
    await db.doc(`usernames/${uid}`).set({ uid, gebruikersnaam: uid, naam: `Naam ${uid}` });
  }
  await db.doc('profielen/anna').update({ naam: 'Anna de Vries' });
  await db.doc('usernames/anna').update({ naam: 'Anna de Vries' });
  await db.doc('naamvoorkeur/anna').set({ vindbaar: true, gewijzigdOp: nu });
  await indexeerNaam({ db, uid: 'anna' });
  await db.doc('mailvoorkeur/anna').set({ uitnodigingen: false, gewijzigdOp: nu });
  await db.doc('users/anna').set({ watchlist: [{ sleutel: 'grip' }], gezien: [], gepland: [], enabledTheaters: { delamar: true } });
  await db.doc('users/bob').set({ watchlist: [{ sleutel: 'teckel' }] });

  await vrienden('anna', 'bob');
  await vrienden('bob', 'carol');
  // Anna blokkeerde dirk; carol blokkeerde anna.
  await db.doc('blokkades/anna/lijst/dirk').set({ uid: 'dirk', gebruikersnaam: 'dirk', naam: 'Naam dirk', sinds: nu });
  await db.doc('blokkades/carol/lijst/anna').set({ uid: 'anna', gebruikersnaam: 'anna', naam: 'Anna de Vries', sinds: nu });
  await db.doc('vriendverzoeken/dirk_anna').set({ van: 'dirk', naar: 'anna', vanGebruikersnaam: 'dirk', vanNaam: 'Naam dirk', naarGebruikersnaam: 'anna', naarNaam: 'Anna de Vries', aangemaaktOp: nu });
  await db.doc('vriendverzoeken/anna_carol').set({ van: 'anna', naar: 'carol', vanGebruikersnaam: 'anna', vanNaam: 'Anna de Vries', naarGebruikersnaam: 'carol', naarNaam: 'Naam carol', aangemaaktOp: nu });
  await db.doc('uitnodigingslinks/tokenvananna123456').set({ uid: 'anna', gebruikersnaam: 'anna', naam: 'Anna de Vries', aangemaaktOp: nu });
  await db.doc('gedeeld/anna').set({ gezien: true, watchlist: true, gewijzigdOp: nu });
  await db.doc('gedeeld/anna/onderdelen/watchlist').set({ items: [{ sleutel: 'grip' }], stand: 1, nv: 1, v: 1, bijgewerktOp: nu });

  // Anna organiseert plan-a (bob gast); bob organiseert plan-b (anna gast).
  await plan('plan-a', 'anna', 'bob');
  await plan('plan-b', 'bob', 'anna');
  await db.doc('plannen/plan-b').update({ genodigden: ['anna', 'carol'] });
  await db.doc('plannen/plan-b/leden/carol').set({ uid: 'carol', planId: 'plan-b', rol: 'gast', status: 'gaat', uitgenodigdDoor: 'bob', uitgenodigdOp: nu, kaarten: false });
  await db.doc('inbox/bob/berichten/uitnodiging_plan-a').set({ soort: 'uitnodiging', van: 'anna', planId: 'plan-a', aangemaaktOp: nu, gelezen: false });
  await db.doc('inbox/bob/berichten/gaat-mee_plan-b').set({ soort: 'gaat-mee', van: 'anna', planId: 'plan-b', aangemaaktOp: nu, gelezen: true });
  await db.doc('inbox/bob/berichten/van-carol').set({ soort: 'gaat-mee', van: 'carol', planId: 'plan-b', aangemaaktOp: nu, gelezen: false });
  await db.doc('inbox/anna/berichten/uitnodiging_plan-b').set({ soort: 'uitnodiging', van: 'bob', planId: 'plan-b', aangemaaktOp: nu, gelezen: false });
  await db.doc('mailLog/plan-b_anna').set({ planId: 'plan-b', dag, aangemaaktOp: nu, status: 'verstuurd' });
  await db.doc('mailLog/plan-a_bob').set({ planId: 'plan-a', dag, aangemaaktOp: nu, status: 'verstuurd' });
  await db.doc('mailLog/plan-b_carol').set({ planId: 'plan-b', dag, aangemaaktOp: nu, status: 'verstuurd' });
  await db.doc(`mailTellers/${dag}`).set({ dag, totaal: 3, afzender: { anna: 1, bob: 2 }, ontvanger: { anna: 1, bob: 1, carol: 1 }, bijgewerktOp: nu });
  await db.doc(`zoekTellers/${dag}`).set({ dag, per: { anna: 4, bob: 1 }, bijgewerktOp: nu });
}

/** Zit `uid` ergens in een pad of in de inhoud (ook als naam of gebruikersnaam)? */
function sporen(docs, uid, naam) {
  const zoek = new RegExp(`(^|[^a-z])${uid}([^a-z]|$)|${naam}`, 'i');
  return docs.filter((d) => zoek.test(d.pad) || zoek.test(JSON.stringify(d.data))).map((d) => d.pad);
}

test('account verwijderen: niets meer van de gebruiker, ook niet bij een vriend; de vriend houdt zijn eigen gegevens', async () => {
  await wereld();
  assert.ok(sporen(await alles(), 'anna', 'Anna de Vries').length > 20, 'de wereld bevat anna');
  const telling = await verwijderAccount({ db, auth, uid: 'anna' });
  assert.deepEqual(
    { ...telling },
    { plannenEigen: 1, plannenGast: 1, vrienden: 1, lijstBijAnderen: 2, verzoeken: 2, links: 1, berichtenVanMij: 2, gebruikersnamen: 1, tellers: 2 }
  );

  const na = await alles();
  assert.deepEqual(sporen(na, 'anna', 'Anna de Vries'), []);
  await assert.rejects(auth.getUser('anna'), (e) => e.code === 'auth/user-not-found');

  // Bob: profiel, lijsten, eigen plan (zonder anna), vriendschap met carol, bericht van carol.
  assert.equal((await db.doc('profielen/bob').get()).exists, true);
  assert.deepEqual((await db.doc('users/bob').get()).data(), { watchlist: [{ sleutel: 'teckel' }] });
  const planB = (await db.doc('plannen/plan-b').get()).data();
  assert.deepEqual(planB.genodigden, ['carol']);
  assert.deepEqual((await db.collection('plannen/plan-b/leden').get()).docs.map((d) => d.id).sort(), ['bob', 'carol']);
  assert.equal((await db.doc('plannen/plan-a').get()).exists, false);
  assert.equal((await db.collection('plannen/plan-a/leden').get()).size, 0);
  assert.deepEqual((await db.collection('vrienden/bob/lijst').get()).docs.map((d) => d.id), ['carol']);
  assert.deepEqual((await db.collection('inbox/bob/berichten').get()).docs.map((d) => d.id), ['van-carol']);
  assert.equal((await db.doc('mailLog/plan-b_carol').get()).exists, true);
  assert.deepEqual((await db.doc(`mailTellers/${dag}`).get()).data().afzender, { bob: 2 });
  assert.deepEqual((await db.doc(`zoekTellers/${dag}`).get()).data().per, { bob: 1 });
  // De gebruikersnaam is weer vrij.
  assert.equal((await db.doc('usernames/anna').get()).exists, false);
  await (await auth.getUser('bob')).uid;
});

test('account verwijderen: een tweede keer (of na een halve eerste keer) is geen fout', async () => {
  await wereld();
  // Halverwege: alleen de plannen al weg.
  await db.recursiveDelete(db.doc('plannen/plan-a'));
  await verwijderAccount({ db, auth, uid: 'anna' });
  const telling = await verwijderAccount({ db, auth, uid: 'anna' });
  assert.equal(Object.values(telling).reduce((a, b) => a + b, 0), 0);
  assert.deepEqual(sporen(await alles(), 'anna', 'Anna de Vries'), []);
});

test('account verwijderen: hooguit VERWIJDER_LIMIET pogingen per dag per gebruiker', async () => {
  for (let i = 0; i < VERWIJDER_LIMIET; i++) assert.equal(await telPoging({ db, uid: 'anna' }), true);
  assert.equal(await telPoging({ db, uid: 'anna' }), false);
  assert.equal(await telPoging({ db, uid: 'bob' }), true);
  // Na het verwijderen verdwijnt anna ook uit deze teller; oude tellers gaan weg.
  await db.doc('verwijderTellers/2020-01-01').set({ dag: '2020-01-01', per: { bob: 1 } });
  await verwijderAccount({ db, auth, uid: 'anna' });
  assert.deepEqual((await db.doc(`verwijderTellers/${dag}`).get()).data().per, { bob: 1 });
  assert.equal((await db.doc('verwijderTellers/2020-01-01').get()).exists, false);
});
