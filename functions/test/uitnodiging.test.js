// De uitnodigingsmail (kernlogica) tegen de Firestore- en Auth-emulator met
// de Admin SDK; versturen is een nepfunctie die de mails bewaart.

import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Timestamp } from 'firebase-admin/firestore';
import { verwerkUitnodiging, ruimOp, LIMIETEN } from '../uitnodiging.js';
import { amsterdamDatum } from '../mail.js';
import { admin, wis, gebruiker, vrienden, plan, alleDocumenten, APP_URL, DAG } from './hulp.js';

let db;
let auth;
let verstuurd;
const verstuur = async (m) => {
  verstuurd.push(m);
};
const draai = (planId, uid, extra = {}) => verwerkUitnodiging({ db, auth, verstuur, appUrl: APP_URL, planId, uid, ...extra });

before(() => {
  ({ db, auth } = admin());
});
beforeEach(async () => {
  await wis();
  verstuurd = [];
  await gebruiker('anna');
  await gebruiker('bob');
  await vrienden('anna', 'bob');
  await plan('P1', 'anna', 'bob');
});

test('de mail gaat uit naar het adres uit Auth, met de juiste inhoud; mailLog en teller', async () => {
  assert.equal(await draai('P1', 'bob'), 'verstuurd');
  assert.equal(verstuurd.length, 1);
  assert.equal(verstuurd[0].aan, 'bob@mail.test');
  assert.equal(verstuurd[0].subject, '@anna nodigt je uit voor Grip – Rayen Panday');
  assert.match(verstuurd[0].text, /@anna \(Naam anna\) nodigt je uit/);
  const log = (await db.doc('mailLog/P1_bob').get()).data();
  assert.equal(log.status, 'verstuurd');
  assert.deepEqual(Object.keys(log).sort(), ['aangemaaktOp', 'dag', 'planId', 'status']);
  const t = (await db.doc(`mailTellers/${amsterdamDatum()}`).get()).data();
  assert.equal(t.totaal, 1);
  assert.equal(t.afzender.anna, 1);
  assert.equal(t.ontvanger.bob, 1);
});

test('geen tweede mail bij dezelfde uitnodiging (ook niet tegelijk)', async () => {
  const [a, b] = await Promise.all([draai('P1', 'bob'), draai('P1', 'bob')]);
  assert.deepEqual([a, b].sort(), ['al-verwerkt', 'verstuurd']);
  assert.equal(await draai('P1', 'bob'), 'al-verwerkt');
  assert.equal(verstuurd.length, 1);
});

test('geen mail: plan opgeheven, weg of het lid reageerde al', async () => {
  await db.doc('plannen/P1').update({ opgeheven: true });
  assert.equal(await draai('P1', 'bob'), 'opgeheven');
  await db.doc('plannen/P1').update({ opgeheven: false });
  await db.doc('plannen/P1/leden/bob').update({ status: 'kan-niet' });
  assert.equal(await draai('P1', 'bob'), 'geen-open-uitnodiging');
  assert.equal(await draai('P1', 'anna'), 'geen-open-uitnodiging');
  assert.equal(await draai('bestaat-niet', 'bob'), 'geen-plan');
  assert.equal(verstuurd.length, 0);
});

test('geen mail: vriendschap verbroken (een van beide kanten)', async () => {
  await db.doc('vrienden/anna/lijst/bob').delete();
  assert.equal(await draai('P1', 'bob'), 'geen-vrienden');
  await vrienden('anna', 'bob');
  await db.doc('vrienden/bob/lijst/anna').delete();
  assert.equal(await draai('P1', 'bob'), 'geen-vrienden');
  assert.equal(verstuurd.length, 0);
});

test('geen mail: blokkade (in beide richtingen)', async () => {
  await db.doc('blokkades/bob/lijst/anna').set({ uid: 'anna', sinds: Timestamp.now() });
  assert.equal(await draai('P1', 'bob'), 'blokkade');
  await db.doc('blokkades/bob/lijst/anna').delete();
  await db.doc('blokkades/anna/lijst/bob').set({ uid: 'bob', sinds: Timestamp.now() });
  assert.equal(await draai('P1', 'bob'), 'blokkade');
  assert.equal(verstuurd.length, 0);
});

test('geen mail: mail uitgezet; aan (of geen voorkeur) wel', async () => {
  await db.doc('mailvoorkeur/bob').set({ uitnodigingen: false, gewijzigdOp: Timestamp.now() });
  assert.equal(await draai('P1', 'bob'), 'mail-uit');
  assert.equal(verstuurd.length, 0);
  await db.doc('mailvoorkeur/bob').set({ uitnodigingen: true, gewijzigdOp: Timestamp.now() });
  assert.equal(await draai('P1', 'bob'), 'verstuurd');
});

test('geen mail: voorbije speeldag (Amsterdamse tijd), ook net na middernacht', async () => {
  await plan('P2', 'anna', 'bob', { datum: '2026-07-15' });
  assert.equal(await draai('P2', 'bob', { nu: Date.parse('2026-07-15T22:00:00Z') }), 'voorbij'); // 00:00 Amsterdam
  assert.equal(verstuurd.length, 0);
  assert.equal(await draai('P2', 'bob', { nu: Date.parse('2026-07-15T21:59:00Z') }), 'verstuurd'); // 23:59 Amsterdam
});

test('geen mail: geen geverifieerd adres of geen account', async () => {
  await gebruiker('carol', { geverifieerd: false });
  await vrienden('anna', 'carol');
  await plan('P3', 'anna', 'carol');
  assert.equal(await draai('P3', 'carol'), 'geen-adres');
  await auth.deleteUser('bob');
  assert.equal(await draai('P1', 'bob'), 'geen-account');
  assert.equal(verstuurd.length, 0);
});

test(`dagteller per ontvanger: hooguit ${LIMIETEN.ontvanger}`, async () => {
  for (let i = 0; i <= LIMIETEN.ontvanger; i++) {
    await gebruiker(`a${i}`);
    await vrienden(`a${i}`, 'bob');
    await plan(`R${i}`, `a${i}`, 'bob');
  }
  const uitkomst = [];
  for (let i = 0; i <= LIMIETEN.ontvanger; i++) uitkomst.push(await draai(`R${i}`, 'bob'));
  assert.deepEqual(uitkomst, [...Array(LIMIETEN.ontvanger).fill('verstuurd'), 'limiet-ontvanger']);
  assert.equal((await db.doc(`mailLog/R${LIMIETEN.ontvanger}_bob`).get()).data().status, 'limiet-ontvanger');
});

test(`dagteller per afzender: hooguit ${LIMIETEN.afzender}`, async () => {
  for (let i = 0; i <= LIMIETEN.afzender; i++) {
    await gebruiker(`g${i}`);
    await vrienden('anna', `g${i}`);
    await plan(`S${i}`, 'anna', `g${i}`);
  }
  const uitkomst = [];
  for (let i = 0; i <= LIMIETEN.afzender; i++) uitkomst.push(await draai(`S${i}`, `g${i}`));
  assert.deepEqual(uitkomst, [...Array(LIMIETEN.afzender).fill('verstuurd'), 'limiet-afzender']);
});

test(`dagteller totaal: hooguit ${LIMIETEN.totaal}`, async () => {
  await db.doc(`mailTellers/${amsterdamDatum()}`).set({ dag: amsterdamDatum(), totaal: LIMIETEN.totaal, afzender: {}, ontvanger: {} });
  assert.equal(await draai('P1', 'bob'), 'limiet-totaal');
  assert.equal(verstuurd.length, 0);
  // Een nieuwe dag begint opnieuw.
  assert.equal(await draai('P1', 'bob', { nu: Date.now() + DAG }), 'al-verwerkt');
});

test('versturen mislukt: mailLog "mislukt", geen tweede poging, geen adres in de log', async () => {
  const logs = [];
  const r = await verwerkUitnodiging({
    db, auth, appUrl: APP_URL, planId: 'P1', uid: 'bob',
    verstuur: async () => { throw Object.assign(new Error('550 bob@mail.test bestaat niet'), { responseCode: 550 }); },
    log: (...a) => logs.push(a),
  });
  assert.equal(r, 'mislukt');
  assert.equal((await db.doc('mailLog/P1_bob').get()).data().status, 'mislukt');
  assert.ok(!JSON.stringify(logs).includes('@'), JSON.stringify(logs));
  assert.equal(await draai('P1', 'bob'), 'al-verwerkt');
});

test('geen e-mailadres in Firestore', async () => {
  await draai('P1', 'bob');
  const json = JSON.stringify(await alleDocumenten());
  assert.ok(!json.includes('@mail.test'), json);
});

test('opruimen: mailLog en tellers ouder dan 60 dagen weg, recente blijven', async () => {
  const oud = Date.now() - 61 * DAG;
  await db.doc('mailLog/oud_bob').set({ planId: 'oud', dag: amsterdamDatum(oud), status: 'verstuurd', aangemaaktOp: Timestamp.fromMillis(oud) });
  await db.doc(`mailTellers/${amsterdamDatum(oud)}`).set({ dag: amsterdamDatum(oud), totaal: 3, afzender: {}, ontvanger: {} });
  await draai('P1', 'bob');
  assert.equal(await ruimOp({ db }), 2);
  assert.equal((await db.doc('mailLog/oud_bob').get()).exists, false);
  assert.equal((await db.doc(`mailTellers/${amsterdamDatum(oud)}`).get()).exists, false);
  assert.equal((await db.doc('mailLog/P1_bob').get()).exists, true);
  assert.equal((await db.doc(`mailTellers/${amsterdamDatum()}`).get()).exists, true);
});
