// Rules voor gedeelde plannen, leden en berichten (stap 4). Via de functies
// uit de app (public/js/plannen.js) en met directe schrijfacties zoals een
// kwaadwillende client die zou doen.

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import {
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  writeBatch,
  collection,
  query,
  where,
  orderBy,
  serverTimestamp,
  Timestamp,
} from 'firebase/firestore';
import { maakOmgeving, als, zonderRules } from './omgeving.js';
import {
  nodigUit,
  trekIn,
  zetMijnStatus,
  zetKaarten,
  hefOp,
  laadPlan,
  laadBerichten,
  markeerGelezen,
  ruimBerichtenOp,
  speeldagVan,
  PlanFout,
} from '../../public/js/plannen.js';

const fs = { doc, getDoc, getDocs, setDoc, writeBatch, collection, query, where, orderBy, serverTimestamp };
const DAG = 24 * 3600 * 1000;
const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
const TOEKOMST = iso(Date.now() + 7 * DAG);
const VERLEDEN = iso(Date.now() - 3 * DAG);
const item = (datum = TOEKOMST) => ({
  sleutel: `delamar|${datum}|20:15|grip`, titel: 'Grip', theaterId: 'delamar', theaterNaam: 'DeLaMar', stad: 'Amsterdam', datum, tijd: '20:15', status: 'gepland',
});
// alice organiseert; bob, carol en eve zijn haar vrienden; dave niet; eve
// heeft alice geblokkeerd (vriendschap staat er nog, als halve rest).
const VRIENDEN = ['bob', 'carol', 'eve', ...Array.from({ length: 10 }, (_, i) => `v${i}`)];

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
    for (const uid of ['alice', 'bob', 'carol', 'dave', 'eve', ...VRIENDEN]) {
      await setDoc(doc(d, 'profielen', uid), { gebruikersnaam: uid, gebruikersnaamLaag: uid, naam: uid, aangemaaktOp: new Date(), gewijzigdOp: new Date(), v: 1 });
    }
    for (const v of VRIENDEN) {
      await setDoc(doc(d, 'vrienden', 'alice', 'lijst', v), { uid: v, sinds: new Date(), via: 'verzoek' });
      await setDoc(doc(d, 'vrienden', v, 'lijst', 'alice'), { uid: 'alice', sinds: new Date(), via: 'verzoek' });
    }
    await setDoc(doc(d, 'vrienden', 'bob', 'lijst', 'carol'), { uid: 'carol', sinds: new Date(), via: 'verzoek' });
    await setDoc(doc(d, 'vrienden', 'carol', 'lijst', 'bob'), { uid: 'bob', sinds: new Date(), via: 'verzoek' });
    await setDoc(doc(d, 'blokkades', 'eve', 'lijst', 'alice'), { uid: 'alice', gebruikersnaam: 'alice', naam: 'alice', sinds: new Date() });
  });
});

const db = (uid) => als(omgeving, uid);
const bestaat = async (pad) => {
  let uit;
  await zonderRules(omgeving, async (d) => {
    uit = (await getDoc(doc(d, pad))).exists();
  });
  return uit;
};
const lees = async (pad) => {
  let uit;
  await zonderRules(omgeving, async (d) => {
    uit = (await getDoc(doc(d, pad))).data() ?? null;
  });
  return uit;
};
const inboxVan = async (uid) => {
  let uit;
  await zonderRules(omgeving, async (d) => {
    uit = (await getDocs(collection(d, 'inbox', uid, 'berichten'))).docs.map((x) => x.data());
  });
  return uit;
};
const plan = async (planId) => (await laadPlan({ db: db('alice'), fs, planId })).plan;
async function nieuwPlan(gast = 'bob', it = item()) {
  return nodigUit({ db: db('alice'), fs, ik: 'alice', item: it, gast });
}
async function erbij(planId, gast) {
  return nodigUit({ db: db('alice'), fs, ik: 'alice', item: item(), planId, plan: await plan(planId), gast });
}
/** Directe uitnodiging door `wie` voor `gast` in een bestaand plan (één batch). */
function directUitnodigen(wie, planId, genodigden, gast, { metBericht = true } = {}) {
  const d = db(wie);
  const b = writeBatch(d);
  b.update(doc(d, 'plannen', planId), { genodigden, gewijzigdOp: serverTimestamp() });
  b.set(doc(d, 'plannen', planId, 'leden', gast), { uid: gast, planId, rol: 'gast', status: 'uitgenodigd', uitgenodigdDoor: wie, uitgenodigdOp: serverTimestamp(), kaarten: false });
  if (metBericht) b.set(doc(collection(d, 'inbox', gast, 'berichten')), { soort: 'uitnodiging', van: wie, planId, aangemaaktOp: serverTimestamp(), gelezen: false });
  return b.commit();
}

// ---------- Uitnodigen ----------

test('een vriend uitnodigen: plan, organisator, gast en een bericht in één batch', async () => {
  const planId = await nieuwPlan();
  const p = await lees(`plannen/${planId}`);
  assert.equal(p.eigenaar, 'alice');
  assert.deepEqual(p.genodigden, ['bob']);
  assert.equal(p.opgeheven, false);
  assert.deepEqual(p.voorstelling, { titel: 'Grip', theaterId: 'delamar', theaterNaam: 'DeLaMar', stad: 'Amsterdam', datum: TOEKOMST, tijd: '20:15' });
  assert.equal((await lees(`plannen/${planId}/leden/alice`)).rol, 'organisator');
  assert.equal((await lees(`plannen/${planId}/leden/bob`)).status, 'uitgenodigd');
  const [bericht] = await inboxVan('bob');
  assert.deepEqual({ ...bericht, aangemaaktOp: 0 }, { soort: 'uitnodiging', van: 'alice', planId, aangemaaktOp: 0, gelezen: false });
});

test('lezen: organisator en genodigden wel, een buitenstaander niet', async () => {
  const planId = await nieuwPlan();
  await erbij(planId, 'carol');
  await assertSucceeds(getDoc(doc(db('bob'), 'plannen', planId)));
  await assertSucceeds(getDocs(collection(db('bob'), 'plannen', planId, 'leden')));
  const info = await laadPlan({ db: db('carol'), fs, planId });
  assert.deepEqual(info.leden.map((l) => l.uid).sort(), ['alice', 'bob', 'carol']);
  await assertFails(getDoc(doc(db('dave'), 'plannen', planId)));
  await assertFails(getDocs(collection(db('dave'), 'plannen', planId, 'leden')));
  await assertFails(getDoc(doc(db('dave'), 'plannen', planId, 'leden', 'bob')));
  assert.equal(await laadPlan({ db: db('dave'), fs, planId }), null);
  await assertFails(getDocs(collection(db('alice'), 'plannen')));
  await assertFails(getDoc(doc(db(null), 'plannen', planId)));
});

test('uitnodigen als niet-organisator: geweigerd', async () => {
  const planId = await nieuwPlan();
  await assertFails(directUitnodigen('bob', planId, ['bob', 'carol'], 'carol'));
  assert.equal(await bestaat(`plannen/${planId}/leden/carol`), false);
});

test('een niet-vriend uitnodigen: geweigerd', async () => {
  await assert.rejects(nieuwPlan('dave'), (e) => e instanceof PlanFout && e.code === 'niet-mogelijk');
  const planId = await nieuwPlan();
  await assertFails(directUitnodigen('alice', planId, ['bob', 'dave'], 'dave'));
});

test('iemand uitnodigen met een blokkade (in een van beide richtingen): geweigerd', async () => {
  const planId = await nieuwPlan();
  await assertFails(directUitnodigen('alice', planId, ['bob', 'eve'], 'eve'));
  await zonderRules(omgeving, (d) => setDoc(doc(d, 'blokkades', 'alice', 'lijst', 'carol'), { uid: 'carol', gebruikersnaam: 'carol', naam: 'carol', sinds: new Date() }));
  await assertFails(directUitnodigen('alice', planId, ['bob', 'carol'], 'carol'));
});

test('maximaal 10 genodigden', async () => {
  const planId = await nieuwPlan('v0');
  for (let i = 1; i < 10; i++) await erbij(planId, `v${i}`);
  assert.equal((await plan(planId)).genodigden.length, 10);
  await assert.rejects(erbij(planId, 'bob'), (e) => e.code === 'vol');
  await assertFails(directUitnodigen('alice', planId, [...(await plan(planId)).genodigden, 'bob'], 'bob'));
  // Ook een nieuw plan met 11 genodigden in de lijst gaat niet.
  const d = db('alice');
  const b = writeBatch(d);
  const id = doc(collection(d, 'plannen')).id;
  b.set(doc(d, 'plannen', id), {
    eigenaar: 'alice', sleutel: 's', sleutelV: 4, voorstelling: { titel: 'Grip', theaterId: 'delamar', theaterNaam: 'DeLaMar', stad: 'Amsterdam', datum: TOEKOMST, tijd: '20:15' },
    speeldag: speeldagVan(TOEKOMST), genodigden: ['bob', 'carol', ...Array.from({ length: 9 }, (_, i) => `v${i}`)], opgeheven: false, aangemaaktOp: serverTimestamp(), gewijzigdOp: serverTimestamp(),
  });
  b.set(doc(d, 'plannen', id, 'leden', 'alice'), { uid: 'alice', planId: id, rol: 'organisator', status: 'gaat', uitgenodigdDoor: 'alice', uitgenodigdOp: serverTimestamp(), kaarten: false });
  await assertFails(b.commit());
});

test('een datum in het verleden: geen nieuw plan en geen nieuwe genodigden', async () => {
  await assert.rejects(nieuwPlan('bob', item(VERLEDEN)), (e) => e.code === 'niet-mogelijk');
  // Bestaand plan waarvan de speeldag voorbij is.
  const planId = await nieuwPlan();
  await zonderRules(omgeving, (d) => setDoc(doc(d, 'plannen', planId), { speeldag: speeldagVan(VERLEDEN) }, { merge: true }));
  await assertFails(directUitnodigen('alice', planId, ['bob', 'carol'], 'carol'));
});

test('een plan voor een datum in het verleden, ook zonder genodigden: geweigerd', async () => {
  const d = db('alice');
  const maak = (datum) => {
    const b = writeBatch(d);
    const id = doc(collection(d, 'plannen')).id;
    b.set(doc(d, 'plannen', id), {
      eigenaar: 'alice', sleutel: 's', sleutelV: 4, voorstelling: { titel: 'Grip', theaterId: 'delamar', theaterNaam: 'DeLaMar', stad: 'Amsterdam', datum, tijd: '20:15' },
      speeldag: speeldagVan(datum), genodigden: [], opgeheven: false, aangemaaktOp: serverTimestamp(), gewijzigdOp: serverTimestamp(),
    });
    b.set(doc(d, 'plannen', id, 'leden', 'alice'), { uid: 'alice', planId: id, rol: 'organisator', status: 'gaat', uitgenodigdDoor: 'alice', uitgenodigdOp: serverTimestamp(), kaarten: false });
    return b.commit();
  };
  await assertFails(maak(VERLEDEN));
  await assertSucceeds(maak(TOEKOMST));
});

test('vandaag mag nog; een speeldag die niet bij de datum past niet', async () => {
  const vandaag = iso(Date.now());
  await assertSucceeds(nieuwPlan('bob', item(vandaag)));
  const d = db('alice');
  const b = writeBatch(d);
  const id = doc(collection(d, 'plannen')).id;
  b.set(doc(d, 'plannen', id), {
    eigenaar: 'alice', sleutel: 's', sleutelV: 4, voorstelling: { titel: 'Grip', theaterId: 'delamar', theaterNaam: 'DeLaMar', stad: 'Amsterdam', datum: VERLEDEN, tijd: '20:15' },
    speeldag: speeldagVan(TOEKOMST), genodigden: [], opgeheven: false, aangemaaktOp: serverTimestamp(), gewijzigdOp: serverTimestamp(),
  });
  b.set(doc(d, 'plannen', id, 'leden', 'alice'), { uid: 'alice', planId: id, rol: 'organisator', status: 'gaat', uitgenodigdDoor: 'alice', uitgenodigdOp: serverTimestamp(), kaarten: false });
  await assertFails(b.commit());
});

test('dezelfde vriend twee keer uitnodigen: geweigerd', async () => {
  const planId = await nieuwPlan();
  await assert.rejects(erbij(planId, 'bob'), (e) => e.code === 'al-uitgenodigd');
  await assertFails(directUitnodigen('alice', planId, ['bob'], 'bob'));
});

test('een plan namens een ander maken, of zonder organisator-lid: geweigerd', async () => {
  const d = db('bob');
  const b = writeBatch(d);
  const id = doc(collection(d, 'plannen')).id;
  b.set(doc(d, 'plannen', id), {
    eigenaar: 'alice', sleutel: 's', sleutelV: 4, voorstelling: { titel: 'Grip', theaterId: 'delamar', theaterNaam: 'DeLaMar', stad: 'Amsterdam', datum: TOEKOMST, tijd: '20:15' },
    speeldag: speeldagVan(TOEKOMST), genodigden: [], opgeheven: false, aangemaaktOp: serverTimestamp(), gewijzigdOp: serverTimestamp(),
  });
  await assertFails(b.commit());
  const d2 = db('alice');
  await assertFails(
    setDoc(doc(d2, 'plannen', 'los'), {
      eigenaar: 'alice', sleutel: 's', sleutelV: 4, voorstelling: { titel: 'Grip', theaterId: 'delamar', theaterNaam: 'DeLaMar', stad: 'Amsterdam', datum: TOEKOMST, tijd: '20:15' },
      speeldag: speeldagVan(TOEKOMST), genodigden: [], opgeheven: false, aangemaaktOp: serverTimestamp(), gewijzigdOp: serverTimestamp(),
    })
  );
});

// ---------- Reageren ----------

test('ik ga mee / kan niet / ga toch niet: eigen status, met een bericht aan de organisator', async () => {
  const planId = await nieuwPlan();
  await erbij(planId, 'carol');
  await assertSucceeds(zetMijnStatus({ db: db('bob'), fs, ik: 'bob', planId, eigenaar: 'alice', status: 'gaat' }));
  await assertSucceeds(zetMijnStatus({ db: db('carol'), fs, ik: 'carol', planId, eigenaar: 'alice', status: 'kan-niet' }));
  await assertSucceeds(zetMijnStatus({ db: db('bob'), fs, ik: 'bob', planId, eigenaar: 'alice', status: 'weg' }));
  assert.equal((await lees(`plannen/${planId}/leden/bob`)).status, 'weg');
  assert.equal((await lees(`plannen/${planId}/leden/carol`)).status, 'kan-niet');
  const soorten = (await inboxVan('alice')).map((b) => `${b.van}:${b.soort}`).sort();
  assert.deepEqual(soorten, ['bob:gaat-mee', 'bob:weg', 'carol:kan-niet']);
});

test('de status van een ander zetten, of een ongeldige overgang: geweigerd', async () => {
  const planId = await nieuwPlan();
  await erbij(planId, 'carol');
  await assertFails(updateDoc(doc(db('bob'), 'plannen', planId, 'leden', 'carol'), { status: 'gaat', reactieOp: serverTimestamp() }));
  await assertFails(updateDoc(doc(db('alice'), 'plannen', planId, 'leden', 'bob'), { status: 'gaat', reactieOp: serverTimestamp() }));
  await assertFails(updateDoc(doc(db('bob'), 'plannen', planId, 'leden', 'bob'), { status: 'weg', reactieOp: serverTimestamp() }));
  await assertFails(updateDoc(doc(db('bob'), 'plannen', planId, 'leden', 'bob'), { rol: 'organisator' }));
  await assertFails(updateDoc(doc(db('bob'), 'plannen', planId, 'leden', 'bob'), { status: 'gaat', reactieOp: new Date('2020-01-01') }));
  await assertFails(updateDoc(doc(db('alice'), 'plannen', planId, 'leden', 'alice'), { status: 'weg', reactieOp: serverTimestamp() }));
  // Kan niet → toch mee kan niet (opnieuw uitnodigen is aan de organisator).
  await zetMijnStatus({ db: db('carol'), fs, ik: 'carol', planId, eigenaar: 'alice', status: 'kan-niet' });
  await assertFails(updateDoc(doc(db('carol'), 'plannen', planId, 'leden', 'carol'), { status: 'gaat', reactieOp: serverTimestamp() }));
});

test('kaarten: alleen je eigen, en zichtbaar voor de andere leden', async () => {
  const planId = await nieuwPlan();
  await zetMijnStatus({ db: db('bob'), fs, ik: 'bob', planId, eigenaar: 'alice', status: 'gaat' });
  await assertSucceeds(zetKaarten({ db: db('bob'), fs, ik: 'bob', planId, kaarten: true }));
  await assertSucceeds(zetKaarten({ db: db('alice'), fs, ik: 'alice', planId, kaarten: true }));
  await assertFails(updateDoc(doc(db('alice'), 'plannen', planId, 'leden', 'bob'), { kaarten: false }));
  const info = await laadPlan({ db: db('alice'), fs, planId });
  assert.equal(info.leden.find((l) => l.uid === 'bob').kaarten, true);
});

test('meegaan met een opgeheven of voorbij plan: geweigerd', async () => {
  const planId = await nieuwPlan();
  await erbij(planId, 'carol');
  await hefOp({ db: db('alice'), fs, ik: 'alice', planId, leden: (await laadPlan({ db: db('alice'), fs, planId })).leden });
  await assert.rejects(zetMijnStatus({ db: db('bob'), fs, ik: 'bob', planId, eigenaar: 'alice', status: 'gaat' }), (e) => e.code === 'niet-mogelijk');
  const planId2 = await nieuwPlan('carol');
  await zonderRules(omgeving, (d) => setDoc(doc(d, 'plannen', planId2), { speeldag: speeldagVan(VERLEDEN) }, { merge: true }));
  await assertFails(updateDoc(doc(db('carol'), 'plannen', planId2, 'leden', 'carol'), { status: 'gaat', reactieOp: serverTimestamp() }));
});

// ---------- Intrekken en opheffen ----------

test('intrekken: alleen de organisator; daarna kan de gast het plan niet meer lezen', async () => {
  const planId = await nieuwPlan();
  await erbij(planId, 'carol');
  const d = db('bob');
  const b = writeBatch(d);
  b.update(doc(d, 'plannen', planId), { genodigden: ['bob'], gewijzigdOp: serverTimestamp() });
  b.delete(doc(d, 'plannen', planId, 'leden', 'carol'));
  await assertFails(b.commit());
  await assertFails(deleteDoc(doc(db('alice'), 'plannen', planId, 'leden', 'carol'))); // zonder uit genodigden
  await assertSucceeds(trekIn({ db: db('alice'), fs, planId, plan: await plan(planId), gast: 'carol' }));
  assert.equal(await bestaat(`plannen/${planId}/leden/carol`), false);
  await assertFails(getDoc(doc(db('carol'), 'plannen', planId)));
});

test('opheffen: alleen de organisator, eenmalig, met berichten aan wie nog meedoet', async () => {
  const planId = await nieuwPlan();
  await erbij(planId, 'carol');
  await zetMijnStatus({ db: db('carol'), fs, ik: 'carol', planId, eigenaar: 'alice', status: 'kan-niet' });
  await assertFails(updateDoc(doc(db('bob'), 'plannen', planId), { opgeheven: true, gewijzigdOp: serverTimestamp() }));
  await assertSucceeds(hefOp({ db: db('alice'), fs, ik: 'alice', planId, leden: (await laadPlan({ db: db('alice'), fs, planId })).leden }));
  assert.equal((await lees(`plannen/${planId}`)).opgeheven, true);
  assert.deepEqual((await inboxVan('bob')).map((b) => b.soort).sort(), ['opgeheven', 'uitnodiging']);
  assert.deepEqual((await inboxVan('carol')).map((b) => b.soort), ['uitnodiging']);
  await assertFails(updateDoc(doc(db('alice'), 'plannen', planId), { opgeheven: false, gewijzigdOp: serverTimestamp() }));
  await assertFails(directUitnodigen('alice', planId, ['bob', 'carol', 'v1'], 'v1'));
  await assertFails(deleteDoc(doc(db('alice'), 'plannen', planId)));
});

test('plan wijzigen buiten genodigden en opheffen: geweigerd', async () => {
  const planId = await nieuwPlan();
  await assertFails(updateDoc(doc(db('alice'), 'plannen', planId), { voorstelling: { titel: 'Anders' }, gewijzigdOp: serverTimestamp() }));
  await assertFails(updateDoc(doc(db('alice'), 'plannen', planId), { eigenaar: 'bob', gewijzigdOp: serverTimestamp() }));
  await assertFails(updateDoc(doc(db('alice'), 'plannen', planId), { genodigden: ['bob', 'alice'], gewijzigdOp: serverTimestamp() }));
});

// ---------- Genodigde zonder lid-document ----------

/** Alice zet dave (geen vriend) rechtstreeks in `genodigden`, zonder lid-document. */
async function vreemdeInGenodigden(planId) {
  await assertSucceeds(updateDoc(doc(db('alice'), 'plannen', planId), { genodigden: [...(await plan(planId)).genodigden, 'dave'], gewijzigdOp: serverTimestamp() }));
}

test('een vreemde in genodigden zonder lid-document kan het plan en de leden niet lezen', async () => {
  const planId = await nieuwPlan();
  await vreemdeInGenodigden(planId);
  await assertFails(getDoc(doc(db('dave'), 'plannen', planId)));
  await assertFails(getDocs(collection(db('dave'), 'plannen', planId, 'leden')));
  await assertFails(getDoc(doc(db('dave'), 'plannen', planId, 'leden', 'bob')));
  // Een echte gast wel.
  await assertSucceeds(getDoc(doc(db('bob'), 'plannen', planId)));
  await assertSucceeds(getDocs(collection(db('bob'), 'plannen', planId, 'leden')));
});

test('opheffen: geen bericht aan een vreemde zonder lid-document; wel aan een gast die meegaat', async () => {
  const planId = await nieuwPlan();
  await zetMijnStatus({ db: db('bob'), fs, ik: 'bob', planId, eigenaar: 'alice', status: 'gaat' });
  await vreemdeInGenodigden(planId);
  const melding = (u, id = `opgeheven_${planId}`) =>
    setDoc(doc(db('alice'), 'inbox', u, 'berichten', id), { soort: 'opgeheven', van: 'alice', planId, aangemaaktOp: serverTimestamp(), gelezen: false });
  // Vóór het opheffen: geen opheffingsbericht.
  await assertFails(melding('bob'));
  await assertSucceeds(updateDoc(doc(db('alice'), 'plannen', planId), { opgeheven: true, gewijzigdOp: serverTimestamp() }));
  await assertFails(melding('dave'));
  await assertSucceeds(melding('bob'));
  // Hooguit één per plan, en alleen met de vaste id.
  await assertFails(melding('bob'));
  await assertFails(melding('bob', 'anders'));
  assert.deepEqual((await inboxVan('dave')), []);
  assert.deepEqual((await inboxVan('bob')).map((b) => b.soort).sort(), ['opgeheven', 'uitnodiging']);
});

test('opheffen: geen bericht aan wie "kan niet" zei of niet meer meegaat', async () => {
  const planId = await nieuwPlan();
  await erbij(planId, 'carol');
  await zetMijnStatus({ db: db('bob'), fs, ik: 'bob', planId, eigenaar: 'alice', status: 'kan-niet' });
  await zetMijnStatus({ db: db('carol'), fs, ik: 'carol', planId, eigenaar: 'alice', status: 'gaat' });
  await zetMijnStatus({ db: db('carol'), fs, ik: 'carol', planId, eigenaar: 'alice', status: 'weg' });
  await updateDoc(doc(db('alice'), 'plannen', planId), { opgeheven: true, gewijzigdOp: serverTimestamp() });
  for (const u of ['bob', 'carol']) {
    await assertFails(setDoc(doc(db('alice'), 'inbox', u, 'berichten', `opgeheven_${planId}`), { soort: 'opgeheven', van: 'alice', planId, aangemaaktOp: serverTimestamp(), gelezen: false }));
  }
});

test('opheffen met 10 gasten die meegaan: iedereen krijgt een bericht (binnen de limiet van de rules)', async () => {
  const planId = await nieuwPlan('v0');
  for (let i = 1; i < 10; i++) await erbij(planId, `v${i}`);
  for (let i = 0; i < 10; i++) await zetMijnStatus({ db: db(`v${i}`), fs, ik: `v${i}`, planId, eigenaar: 'alice', status: 'gaat' });
  await assertSucceeds(hefOp({ db: db('alice'), fs, ik: 'alice', planId, leden: (await laadPlan({ db: db('alice'), fs, planId })).leden }));
  for (let i = 0; i < 10; i++) assert.ok((await inboxVan(`v${i}`)).some((b) => b.soort === 'opgeheven'), `v${i}`);
});

// ---------- Berichten ----------

test('een los bericht in andermans inbox (zonder gebeurtenis in een plan): geweigerd', async () => {
  const planId = await nieuwPlan();
  const zet = (wie, ontvanger, velden = {}) =>
    setDoc(doc(collection(db(wie), 'inbox', ontvanger, 'berichten')), { soort: 'uitnodiging', van: wie, planId, aangemaaktOp: serverTimestamp(), gelezen: false, ...velden });
  await assertFails(zet('dave', 'alice'));
  await assertFails(zet('alice', 'bob')); // bob is al lid: geen nieuwe uitnodiging
  await assertFails(zet('bob', 'alice', { soort: 'gaat-mee' })); // geen statuswijziging in dezelfde batch
  await assertFails(zet('bob', 'alice', { soort: 'opgeheven' }));
  await assertFails(zet('alice', 'dave', { soort: 'opgeheven' }));
  await assertFails(zet('alice', 'bob', { van: 'carol' }));
  await assertFails(zet('alice', 'bob', { tekst: 'hoi' }));
  await assertFails(zet('alice', 'bob', { gelezen: true }));
  await assertFails(zet('alice', 'bob', { planId: 'bestaat-niet' }));
  await assertFails(zet('alice', 'alice'));
});

test('berichten: alleen de ontvanger leest, zet gelezen en haalt weg', async () => {
  const planId = await nieuwPlan();
  const [{ id }] = await laadBerichten({ db: db('bob'), fs, ik: 'bob' });
  await assertFails(getDoc(doc(db('carol'), 'inbox', 'bob', 'berichten', id)));
  await assertFails(getDocs(collection(db('carol'), 'inbox', 'bob', 'berichten')));
  await assertFails(getDocs(collection(db('alice'), 'inbox', 'bob', 'berichten')));
  await assertFails(updateDoc(doc(db('alice'), 'inbox', 'bob', 'berichten', id), { gelezen: true }));
  await assertFails(deleteDoc(doc(db('alice'), 'inbox', 'bob', 'berichten', id)));
  await assertFails(updateDoc(doc(db('bob'), 'inbox', 'bob', 'berichten', id), { soort: 'opgeheven' }));
  await assertFails(updateDoc(doc(db('bob'), 'inbox', 'bob', 'berichten', id), { gelezen: false }));
  await assertSucceeds(markeerGelezen({ db: db('bob'), fs, ik: 'bob', ids: [id] }));
  assert.equal((await lees(`inbox/bob/berichten/${id}`)).gelezen, true);
  await assertSucceeds(getDocs(query(collection(db('bob'), 'inbox', 'bob', 'berichten'), where('gelezen', '==', false))));
  await assertSucceeds(deleteDoc(doc(db('bob'), 'inbox', 'bob', 'berichten', id)));
  assert.ok(planId);
});

test('berichten ouder dan 60 dagen ruimt de app op', async () => {
  await nieuwPlan();
  await zonderRules(omgeving, (d) =>
    setDoc(doc(d, 'inbox', 'bob', 'berichten', 'oud'), { soort: 'uitnodiging', van: 'alice', planId: 'x', aangemaaktOp: Timestamp.fromMillis(Date.now() - 61 * DAG), gelezen: true })
  );
  const alle = await laadBerichten({ db: db('bob'), fs, ik: 'bob' });
  assert.equal(alle.length, 2);
  assert.equal(alle[1].id, 'oud'); // nieuwste eerst
  const over = await ruimBerichtenOp({ db: db('bob'), fs, ik: 'bob', berichten: alle });
  assert.equal(over.length, 1);
  assert.equal(await bestaat('inbox/bob/berichten/oud'), false);
});

test('geblokkeerd na de uitnodiging: reageren lukt, alleen zonder bericht', async () => {
  const planId = await nieuwPlan();
  await zonderRules(omgeving, (d) => setDoc(doc(d, 'blokkades', 'alice', 'lijst', 'bob'), { uid: 'bob', gebruikersnaam: 'bob', naam: 'bob', sinds: new Date() }));
  await assertSucceeds(zetMijnStatus({ db: db('bob'), fs, ik: 'bob', planId, eigenaar: 'alice', status: 'kan-niet' }));
  assert.deepEqual(await inboxVan('alice'), []);
  assert.equal((await lees(`plannen/${planId}/leden/bob`)).status, 'kan-niet');
});

test('uitgelogd: niets', async () => {
  const planId = await nieuwPlan();
  const u = db(null);
  await assertFails(getDoc(doc(u, 'plannen', planId)));
  await assertFails(getDocs(collection(u, 'inbox', 'bob', 'berichten')));
  await assertFails(setDoc(doc(collection(u, 'inbox', 'bob', 'berichten')), { soort: 'uitnodiging', van: 'x', planId, aangemaaktOp: serverTimestamp(), gelezen: false }));
});
