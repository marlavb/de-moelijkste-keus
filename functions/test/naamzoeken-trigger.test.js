// De echte functies in de Functions-emulator: de triggers houden de
// zoekindex bij (profiel aanmaken, vindbaar uit), en de callable zoekOpNaam
// werkt alleen ingelogd.

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { Timestamp } from 'firebase-admin/firestore';
import { admin, wis, PROJECT } from './hulp.js';

const FUNCTIES = `http://127.0.0.1:5011/${PROJECT}/europe-west4`;
let db;
let auth;

async function wachtOp(fn, ms = 30000) {
  const eind = Date.now() + ms;
  while (Date.now() < eind) {
    const r = await fn();
    if (r) return r;
    await new Promise((x) => setTimeout(x, 250));
  }
  return null;
}

async function token(uid) {
  await auth.createUser({ uid, email: `${uid}@mail.test`, password: `geheim-${uid}` });
  const r = await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: `${uid}@mail.test`, password: `geheim-${uid}`, returnSecureToken: true }),
  });
  return (await r.json()).idToken;
}

const roep = (naam, idToken) =>
  fetch(`${FUNCTIES}/zoekOpNaam`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(idToken ? { authorization: `Bearer ${idToken}` } : {}) },
    body: JSON.stringify({ data: { naam } }),
  }).then(async (r) => ({ status: r.status, body: await r.json() }));

before(async () => {
  ({ db, auth } = admin());
  await wis();
});

test('trigger: nieuw profiel komt in de index; vindbaar uit haalt het eruit; callable vindt alleen ingelogd', async () => {
  await db.doc('profielen/anna').set({ gebruikersnaam: 'anna', gebruikersnaamLaag: 'anna', naam: 'Anna de Vries', aangemaaktOp: Timestamp.now(), gewijzigdOp: Timestamp.now(), v: 1 });
  assert.ok(await wachtOp(async () => (await db.doc('naamIndexLid/anna').get()).exists), 'indexregel na het profiel');
  const bob = await token('bob');

  const uitgelogd = await roep('Anna de Vries', null);
  assert.equal(uitgelogd.status, 401);
  const gevonden = await roep('anna de vries', bob);
  assert.equal(gevonden.status, 200);
  assert.deepEqual(gevonden.body.result, { treffers: [{ gebruikersnaam: 'anna', naam: 'Anna de Vries' }] });
  const ongeldig = await roep('Anna', bob);
  assert.equal(ongeldig.body.error?.status, 'INVALID_ARGUMENT');

  await db.doc('naamvoorkeur/anna').set({ vindbaar: false, gewijzigdOp: Timestamp.now() });
  assert.ok(await wachtOp(async () => !(await db.doc('naamIndexLid/anna').get()).exists), 'indexregel weg na vindbaar uit');
  assert.deepEqual((await roep('Anna de Vries', bob)).body.result, { treffers: [] });
});
