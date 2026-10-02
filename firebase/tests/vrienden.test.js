// Rules voor vriendschappen (vrienden, stap 2): verzoeken, accepteren,
// verbreken, blokkeren, uitnodigingslinks en het profiel voor vrienden.
// Via de functies uit de app (public/js/vrienden.js) en met directe
// schrijfacties zoals een kwaadwillende client die zou doen.

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import {
  doc,
  getDoc,
  getDocs,
  setDoc,
  deleteDoc,
  writeBatch,
  collection,
  query,
  where,
  serverTimestamp,
  getCountFromServer,
  runTransaction,
  Timestamp,
} from 'firebase/firestore';
import { maakOmgeving, als, zonderRules } from './omgeving.js';
import { bewaarProfiel } from '../../public/js/profiel.js';
import {
  zoekGebruiker,
  stuurVerzoek,
  accepteer,
  haalVerzoekWeg,
  verbreek,
  blokkeer,
  deblokkeer,
  maakLink,
  trekLinkIn,
  bekijkLink,
  gebruikLink,
  laadVriendenScherm,
  telInkomend,
  maakToken,
  VriendFout,
  NIET_MOGELIJK,
} from '../../public/js/vrienden.js';

const fs = { doc, getDoc, getDocs, setDoc, deleteDoc, writeBatch, collection, query, where, serverTimestamp, getCountFromServer, runTransaction };
const PLEK = { origin: 'https://voorbeeld.nl', pathname: '/app/' };
const PROFIEL = {
  alice: { gebruikersnaam: 'Alice', naam: 'Alice de Boer' },
  bob: { gebruikersnaam: 'bob', naam: 'Bob Jansen' },
  carol: { gebruikersnaam: 'carol', naam: 'Carol Smit' },
};
const ALS = (uid) => ({ uid, gebruikersnaam: PROFIEL[uid].gebruikersnaam, naam: PROFIEL[uid].naam });

let omgeving;
before(async () => {
  omgeving = await maakOmgeving();
});
after(async () => {
  await omgeving?.cleanup();
});
beforeEach(async () => {
  await omgeving.clearFirestore();
  for (const [uid, p] of Object.entries(PROFIEL)) {
    await bewaarProfiel({ db: als(omgeving, uid), fs, uid, ...p });
  }
});

const db = (uid) => als(omgeving, uid);
const metDb = (uid, extra = {}) => ({ db: db(uid), fs, ik: uid, mijnProfiel: PROFIEL[uid], ...extra });
const bestaat = async (pad) => {
  let uit;
  await zonderRules(omgeving, async (d) => {
    uit = (await getDoc(doc(d, pad))).exists();
  });
  return uit;
};
const zijnVrienden = async (a, b) => (await bestaat(`vrienden/${a}/lijst/${b}`)) && (await bestaat(`vrienden/${b}/lijst/${a}`));
const geenVriendschap = async (a, b) => !(await bestaat(`vrienden/${a}/lijst/${b}`)) && !(await bestaat(`vrienden/${b}/lijst/${a}`));

/** Rechtstreeks een verzoek, met per test één ding anders. */
function verzoekDirect(van, naar, anders = {}) {
  return setDoc(doc(db(van), 'vriendverzoeken', anders.id ?? `${van}_${naar}`), {
    van,
    naar,
    vanGebruikersnaam: PROFIEL[van].gebruikersnaam,
    vanNaam: PROFIEL[van].naam,
    naarGebruikersnaam: PROFIEL[naar].gebruikersnaam,
    naarNaam: PROFIEL[naar].naam,
    aangemaaktOp: serverTimestamp(),
    ...(anders.velden ?? {}),
  });
}

/** Rechtstreeks een vriendschap (beide kanten) door `wie`, met verzoek- of linkvelden. */
function vriendschapDirect(wie, a, b, { via = 'verzoek', token, verwijder = [] } = {}) {
  const d = db(wie);
  const batch = writeBatch(d);
  const extra = token ? { token } : {};
  batch.set(doc(d, 'vrienden', a, 'lijst', b), { uid: b, sinds: serverTimestamp(), via, ...extra });
  batch.set(doc(d, 'vrienden', b, 'lijst', a), { uid: a, sinds: serverTimestamp(), via, ...extra });
  for (const pad of verwijder) batch.delete(doc(d, pad));
  return batch.commit();
}

const vriendenMaken = async (a, b) => {
  await stuurVerzoek({ ...metDb(a), ander: ALS(b) });
  await accepteer({ db: db(b), fs, ik: b, van: a });
};

// ---------- Zoeken ----------

test('zoeken op de exacte gebruikersnaam, hoofdletterongevoelig; deel van een naam vindt niets', async () => {
  assert.deepEqual(await zoekGebruiker({ db: db('bob'), fs, invoer: 'ALICE' }), ALS('alice'));
  assert.deepEqual(await zoekGebruiker({ db: db('bob'), fs, invoer: '@alice' }), ALS('alice'));
  assert.equal(await zoekGebruiker({ db: db('bob'), fs, invoer: 'alic' }), null);
  await assert.rejects(zoekGebruiker({ db: db('bob'), fs, invoer: 'al' }), (e) => e instanceof VriendFout && e.code === 'ongeldig');
});

// ---------- Verzoeken ----------

test('verzoek sturen en accepteren: beide kanten, verzoek weg', async () => {
  assert.equal(await stuurVerzoek({ ...metDb('alice'), ander: ALS('bob') }), 'verstuurd');
  const bob = await laadVriendenScherm({ db: db('bob'), fs, ik: 'bob' });
  assert.deepEqual(bob.inkomend, [ALS('alice')]);
  const alice = await laadVriendenScherm({ db: db('alice'), fs, ik: 'alice' });
  assert.deepEqual(alice.uitgaand, [ALS('bob')]);
  assert.equal(await telInkomend({ db: db('bob'), fs, ik: 'bob' }), 1);

  await assertSucceeds(accepteer({ db: db('bob'), fs, ik: 'bob', van: 'alice' }));
  assert.ok(await zijnVrienden('alice', 'bob'));
  assert.equal(await bestaat('vriendverzoeken/alice_bob'), false);
  const na = await laadVriendenScherm({ db: db('alice'), fs, ik: 'alice' });
  assert.deepEqual(na.vrienden, [ALS('bob')]);
  assert.equal(await telInkomend({ db: db('bob'), fs, ik: 'bob' }), 0);
});

test('verzoek aan iemand die jou al een verzoek stuurde: meteen vrienden', async () => {
  await stuurVerzoek({ ...metDb('alice'), ander: ALS('bob') });
  assert.equal(await stuurVerzoek({ ...metDb('bob'), ander: ALS('alice') }), 'vrienden');
  assert.ok(await zijnVrienden('alice', 'bob'));
  assert.equal(await bestaat('vriendverzoeken/alice_bob'), false);
  // Rechtstreeks een tegenverzoek terwijl er al een ligt: geweigerd.
  await omgeving.clearFirestore();
  for (const [uid, p] of Object.entries(PROFIEL)) await bewaarProfiel({ db: db(uid), fs, uid, ...p });
  await stuurVerzoek({ ...metDb('alice'), ander: ALS('bob') });
  await assertFails(verzoekDirect('bob', 'alice'));
});

test('geen dubbel verzoek, geen verzoek aan jezelf, geen verzoek aan een vriend', async () => {
  await stuurVerzoek({ ...metDb('alice'), ander: ALS('bob') });
  await assert.rejects(stuurVerzoek({ ...metDb('alice'), ander: ALS('bob') }), (e) => e.code === 'al-verstuurd');
  await assertFails(verzoekDirect('alice', 'bob')); // bestaat al: zou een update zijn
  await assert.rejects(stuurVerzoek({ ...metDb('alice'), ander: ALS('alice') }), (e) => e.code === 'zelf');
  await assertFails(
    setDoc(doc(db('alice'), 'vriendverzoeken', 'alice_alice'), {
      van: 'alice', naar: 'alice', vanGebruikersnaam: 'Alice', vanNaam: 'Alice de Boer',
      naarGebruikersnaam: 'Alice', naarNaam: 'Alice de Boer', aangemaaktOp: serverTimestamp(),
    })
  );
  await accepteer({ db: db('bob'), fs, ik: 'bob', van: 'alice' });
  await assert.rejects(stuurVerzoek({ ...metDb('alice'), ander: ALS('bob') }), (e) => e.code === 'al-vrienden');
  await assertFails(verzoekDirect('alice', 'bob'));
  await assertFails(verzoekDirect('bob', 'alice'));
});

test('weigeren (ontvanger) en intrekken (afzender); een derde kan niets', async () => {
  await stuurVerzoek({ ...metDb('alice'), ander: ALS('bob') });
  await assertFails(getDoc(doc(db('carol'), 'vriendverzoeken', 'alice_bob')));
  await assertFails(deleteDoc(doc(db('carol'), 'vriendverzoeken', 'alice_bob')));
  await assertSucceeds(haalVerzoekWeg({ db: db('bob'), fs, van: 'alice', naar: 'bob' }));
  assert.equal(await bestaat('vriendverzoeken/alice_bob'), false);
  await stuurVerzoek({ ...metDb('alice'), ander: ALS('bob') });
  await assertSucceeds(haalVerzoekWeg({ db: db('alice'), fs, van: 'alice', naar: 'bob' }));
  assert.equal(await bestaat('vriendverzoeken/alice_bob'), false);
});

test('verzoeken als lijst: alleen je eigen in- of uitgaande', async () => {
  await stuurVerzoek({ ...metDb('alice'), ander: ALS('bob') });
  await assertFails(getDocs(collection(db('carol'), 'vriendverzoeken')));
  await assertFails(getDocs(query(collection(db('carol'), 'vriendverzoeken'), where('naar', '==', 'bob'))));
  await assertSucceeds(getDocs(query(collection(db('bob'), 'vriendverzoeken'), where('naar', '==', 'bob'))));
  await assertSucceeds(getDocs(query(collection(db('alice'), 'vriendverzoeken'), where('van', '==', 'alice'))));
});

const ONGELDIG_VERZOEK = {
  'andere afzender (namens een ander)': { velden: { van: 'carol' } },
  'id past niet bij van/naar': { id: 'alice_carol' },
  'valse eigen naam': { velden: { vanNaam: 'Iemand Anders' } },
  'valse eigen gebruikersnaam': { velden: { vanGebruikersnaam: 'bob' } },
  'naam van de ontvanger klopt niet': { velden: { naarNaam: 'Verzonnen' } },
  'gebruikersnaam van de ontvanger is van een ander': { velden: { naarGebruikersnaam: 'carol' } },
  'extra veld': { velden: { bericht: 'hoi' } },
  'zelfgekozen aangemaaktOp': { velden: { aangemaaktOp: new Date('2020-01-01') } },
};
for (const [wat, anders] of Object.entries(ONGELDIG_VERZOEK)) {
  test(`verzoek geweigerd: ${wat}`, async () => {
    await assertFails(verzoekDirect('alice', 'bob', anders));
  });
}

test('controle: het directe verzoek zelf is geldig', async () => {
  await assertSucceeds(verzoekDirect('alice', 'bob'));
});

test('verzoek zonder eigen profiel: geweigerd', async () => {
  await assertFails(
    setDoc(doc(db('dave'), 'vriendverzoeken', 'dave_bob'), {
      van: 'dave', naar: 'bob', vanGebruikersnaam: 'dave', vanNaam: 'Dave',
      naarGebruikersnaam: 'bob', naarNaam: 'Bob Jansen', aangemaaktOp: serverTimestamp(),
    })
  );
});

// ---------- Misbruik bij het ontstaan van een vriendschap ----------

test('een vriendschap zelf aanmaken zonder verzoek: geweigerd', async () => {
  await assertFails(vriendschapDirect('alice', 'alice', 'bob'));
  await assertFails(vriendschapDirect('carol', 'alice', 'bob'));
  assert.ok(await geenVriendschap('alice', 'bob'));
});

test('je eigen verzoek accepteren, of dat van een ander: geweigerd', async () => {
  await stuurVerzoek({ ...metDb('alice'), ander: ALS('bob') });
  // Alice "accepteert" haar eigen verzoek aan Bob.
  await assertFails(vriendschapDirect('alice', 'alice', 'bob', { verwijder: ['vriendverzoeken/alice_bob'] }));
  // Carol accepteert namens Bob.
  await assertFails(vriendschapDirect('carol', 'alice', 'bob', { verwijder: ['vriendverzoeken/alice_bob'] }));
  await assert.rejects(accepteer({ db: db('carol'), fs, ik: 'bob', van: 'alice' }), (e) => e.code === 'niet-mogelijk');
  assert.ok(await geenVriendschap('alice', 'bob'));
});

test('accepteren zonder het verzoek weg te halen, of maar één kant: geweigerd', async () => {
  await stuurVerzoek({ ...metDb('alice'), ander: ALS('bob') });
  await assertFails(vriendschapDirect('bob', 'bob', 'alice'));
  const d = db('bob');
  const b = writeBatch(d);
  b.set(doc(d, 'vrienden', 'bob', 'lijst', 'alice'), { uid: 'alice', sinds: serverTimestamp(), via: 'verzoek' });
  b.delete(doc(d, 'vriendverzoeken', 'alice_bob'));
  await assertFails(b.commit());
  // Met beide kanten en het verzoek weg: wel.
  await assertSucceeds(vriendschapDirect('bob', 'bob', 'alice', { verwijder: ['vriendverzoeken/alice_bob'] }));
});

test('vriendschapsdocument met extra of verkeerde velden: geweigerd', async () => {
  await stuurVerzoek({ ...metDb('alice'), ander: ALS('bob') });
  const d = db('bob');
  const zet = (velden) => {
    const b = writeBatch(d);
    b.set(doc(d, 'vrienden', 'bob', 'lijst', 'alice'), { uid: 'alice', sinds: serverTimestamp(), via: 'verzoek', ...velden });
    b.set(doc(d, 'vrienden', 'alice', 'lijst', 'bob'), { uid: 'bob', sinds: serverTimestamp(), via: 'verzoek' });
    b.delete(doc(d, 'vriendverzoeken', 'alice_bob'));
    return b.commit();
  };
  await assertFails(zet({ uid: 'carol' }));
  await assertFails(zet({ extra: true }));
  await assertFails(zet({ via: 'link' }));
  await assertFails(zet({ token: maakToken() }));
  await assertFails(zet({ sinds: new Date('2020-01-01') }));
});

// ---------- Verbreken en profiel lezen ----------

test('elk van beiden kan verbreken; een derde niet', async () => {
  await vriendenMaken('alice', 'bob');
  await assertFails(deleteDoc(doc(db('carol'), 'vrienden', 'alice', 'lijst', 'bob')));
  await assertSucceeds(verbreek({ db: db('bob'), fs, ik: 'bob', ander: 'alice' }));
  assert.ok(await geenVriendschap('alice', 'bob'));
  await vriendenMaken('alice', 'bob');
  await assertSucceeds(verbreek({ db: db('alice'), fs, ik: 'alice', ander: 'bob' }));
  assert.ok(await geenVriendschap('alice', 'bob'));
});

test('eenzijdig verbreken (één richting weghalen) wordt geweigerd, door beide partijen', async () => {
  await vriendenMaken('alice', 'bob');
  // Alice haalt alleen haar eigen kant weg: daarna zou Bob haar nog als vriend hebben.
  await assertFails(deleteDoc(doc(db('alice'), 'vrienden', 'alice', 'lijst', 'bob')));
  // Alice haalt alleen Bobs kant weg: daarna zou zij Bobs gegevens nog kunnen lezen.
  await assertFails(deleteDoc(doc(db('alice'), 'vrienden', 'bob', 'lijst', 'alice')));
  await assertFails(deleteDoc(doc(db('bob'), 'vrienden', 'bob', 'lijst', 'alice')));
  await assertFails(deleteDoc(doc(db('bob'), 'vrienden', 'alice', 'lijst', 'bob')));
  assert.ok(await zijnVrienden('alice', 'bob'));
});

test('beide richtingen samen weghalen mag (verbreek)', async () => {
  await vriendenMaken('alice', 'bob');
  const d = db('bob');
  const b = writeBatch(d);
  b.delete(doc(d, 'vrienden', 'alice', 'lijst', 'bob'));
  b.delete(doc(d, 'vrienden', 'bob', 'lijst', 'alice'));
  await assertSucceeds(b.commit());
  assert.ok(await geenVriendschap('alice', 'bob'));
});

test('een halve vriendschap opruimen: beide samen mag, en de overgebleven kant alleen ook', async () => {
  await zonderRules(omgeving, (d) => setDoc(doc(d, 'vrienden', 'bob', 'lijst', 'alice'), { uid: 'alice', sinds: new Date(), via: 'verzoek' }));
  await assertSucceeds(verbreek({ db: db('alice'), fs, ik: 'alice', ander: 'bob' }));
  assert.ok(await geenVriendschap('alice', 'bob'));
  await zonderRules(omgeving, (d) => setDoc(doc(d, 'vrienden', 'bob', 'lijst', 'alice'), { uid: 'alice', sinds: new Date(), via: 'verzoek' }));
  await assertSucceeds(deleteDoc(doc(db('alice'), 'vrienden', 'bob', 'lijst', 'alice')));
});

test('blokkeren bij een bestaande vriendschap, een halve, en zonder vriendschap: mag', async () => {
  await vriendenMaken('alice', 'bob');
  await assertSucceeds(blokkeer({ db: db('alice'), fs, ik: 'alice', ander: ALS('bob') }));
  assert.ok(await geenVriendschap('alice', 'bob'));

  await zonderRules(omgeving, (d) => setDoc(doc(d, 'vrienden', 'carol', 'lijst', 'alice'), { uid: 'alice', sinds: new Date(), via: 'verzoek' }));
  await assertSucceeds(blokkeer({ db: db('alice'), fs, ik: 'alice', ander: ALS('carol') }));
  assert.ok(await geenVriendschap('alice', 'carol'));

  await assertSucceeds(blokkeer({ db: db('bob'), fs, ik: 'bob', ander: ALS('carol') }));
  assert.ok(await bestaat('blokkades/bob/lijst/carol'));
});

test('vriendenlijsten: alleen je eigen', async () => {
  await vriendenMaken('alice', 'bob');
  await assertSucceeds(getDocs(collection(db('alice'), 'vrienden', 'alice', 'lijst')));
  await assertFails(getDocs(collection(db('carol'), 'vrienden', 'alice', 'lijst')));
  await assertFails(getDoc(doc(db('carol'), 'vrienden', 'alice', 'lijst', 'bob')));
});

test('profiel: vrienden mogen het lezen, een niet-vriend niet (ook niet na verbreken)', async () => {
  await assertFails(getDoc(doc(db('bob'), 'profielen', 'alice')));
  await vriendenMaken('alice', 'bob');
  await assertSucceeds(getDoc(doc(db('bob'), 'profielen', 'alice')));
  await assertSucceeds(getDoc(doc(db('alice'), 'profielen', 'bob')));
  await assertFails(getDoc(doc(db('carol'), 'profielen', 'alice')));
  await assertFails(getDoc(doc(db(null), 'profielen', 'alice')));
  await verbreek({ db: db('alice'), fs, ik: 'alice', ander: 'bob' });
  await assertFails(getDoc(doc(db('bob'), 'profielen', 'alice')));
});

test('de actuele naam van een vriend komt uit diens profiel', async () => {
  await vriendenMaken('alice', 'bob');
  await bewaarProfiel({ db: db('bob'), fs, uid: 'bob', gebruikersnaam: 'Bobbie', naam: 'Bob J.' });
  const s = await laadVriendenScherm({ db: db('alice'), fs, ik: 'alice' });
  assert.deepEqual(s.vrienden, [{ uid: 'bob', gebruikersnaam: 'Bobbie', naam: 'Bob J.' }]);
});

// ---------- Blokkeren ----------

test('blokkeren verbreekt de vriendschap en haalt verzoeken in beide richtingen weg', async () => {
  await vriendenMaken('alice', 'bob');
  await zonderRules(omgeving, (d) => setDoc(doc(d, 'vriendverzoeken', 'bob_alice'), { van: 'bob', naar: 'alice' }));
  await stuurVerzoek({ ...metDb('carol'), ander: ALS('alice') });
  await assertSucceeds(blokkeer({ db: db('alice'), fs, ik: 'alice', ander: ALS('bob') }));
  assert.ok(await geenVriendschap('alice', 'bob'));
  assert.equal(await bestaat('vriendverzoeken/bob_alice'), false);
  assert.equal(await bestaat('vriendverzoeken/carol_alice'), true);
  // Ook zonder vriendschap of verzoek lukt blokkeren (alles in één batch).
  await assertSucceeds(blokkeer({ db: db('alice'), fs, ik: 'alice', ander: ALS('carol') }));
  assert.equal(await bestaat('vriendverzoeken/carol_alice'), false);
});

test('geblokkeerd: geen verzoek (neutrale melding), geen link, geen vriendschap', async () => {
  const { token } = await maakLink({ ...metDb('alice'), plek: PLEK });
  await blokkeer({ db: db('alice'), fs, ik: 'alice', ander: ALS('bob') });
  await assert.rejects(
    stuurVerzoek({ ...metDb('bob'), ander: ALS('alice') }),
    (e) => e instanceof VriendFout && e.code === 'niet-mogelijk' && e.message === NIET_MOGELIJK
  );
  await assertFails(verzoekDirect('bob', 'alice'));
  const bekeken = await bekijkLink({ db: db('bob'), fs, ik: 'bob', token });
  assert.equal(bekeken.status, 'ok'); // Bob kan niet zien dat hij geblokkeerd is …
  await assert.rejects(gebruikLink({ db: db('bob'), fs, ik: 'bob', link: bekeken.link }), (e) => e.code === 'niet-mogelijk');
  assert.ok(await geenVriendschap('alice', 'bob'));
  assert.equal(await bestaat(`uitnodigingslinks/${token}`), true);
  // … en Alice zelf krijgt een duidelijke melding.
  await assert.rejects(stuurVerzoek({ ...metDb('alice'), ander: ALS('bob') }), (e) => e.code === 'jij-blokkeert');
  await assertFails(verzoekDirect('alice', 'bob'));
});

test('een blokkade van een ander lezen, maken of weghalen: geweigerd', async () => {
  await blokkeer({ db: db('alice'), fs, ik: 'alice', ander: ALS('bob') });
  await assertFails(getDoc(doc(db('bob'), 'blokkades', 'alice', 'lijst', 'bob')));
  await assertFails(getDocs(collection(db('bob'), 'blokkades', 'alice', 'lijst')));
  await assertFails(deleteDoc(doc(db('bob'), 'blokkades', 'alice', 'lijst', 'bob')));
  await assertFails(
    setDoc(doc(db('bob'), 'blokkades', 'alice', 'lijst', 'carol'), { uid: 'carol', gebruikersnaam: 'carol', naam: 'Carol Smit', sinds: serverTimestamp() })
  );
  await assertSucceeds(getDocs(collection(db('alice'), 'blokkades', 'alice', 'lijst')));
});

test('deblokkeren: daarna kan de ander weer een verzoek sturen', async () => {
  await blokkeer({ db: db('alice'), fs, ik: 'alice', ander: ALS('bob') });
  assert.deepEqual((await laadVriendenScherm({ db: db('alice'), fs, ik: 'alice' })).geblokkeerd, [ALS('bob')]);
  await assertSucceeds(deblokkeer({ db: db('alice'), fs, ik: 'alice', ander: 'bob' }));
  assert.equal(await stuurVerzoek({ ...metDb('bob'), ander: ALS('alice') }), 'verstuurd');
});

test('blokkadedocument met extra of verkeerde velden: geweigerd', async () => {
  const zet = (velden) =>
    setDoc(doc(db('alice'), 'blokkades', 'alice', 'lijst', 'bob'), { uid: 'bob', gebruikersnaam: 'bob', naam: 'Bob Jansen', sinds: serverTimestamp(), ...velden });
  await assertFails(zet({ uid: 'carol' }));
  await assertFails(zet({ extra: 1 }));
  await assertFails(zet({ sinds: new Date('2020-01-01') }));
  await assertFails(setDoc(doc(db('alice'), 'blokkades', 'alice', 'lijst', 'alice'), { uid: 'alice', gebruikersnaam: 'Alice', naam: 'A', sinds: serverTimestamp() }));
  await assertSucceeds(zet({}));
});

// ---------- Uitnodigingslinks ----------

test('link: maken, bekijken, gebruiken → vrienden en het token is weg', async () => {
  const { token, url } = await maakLink({ ...metDb('alice'), plek: PLEK });
  assert.match(token, /^[A-Za-z0-9_-]{32}$/);
  assert.equal(url, `https://voorbeeld.nl/app/#/vriend-link/${token}`);
  const bekeken = await bekijkLink({ db: db('bob'), fs, ik: 'bob', token });
  assert.equal(bekeken.status, 'ok');
  assert.equal(bekeken.link.gebruikersnaam, 'Alice');
  await assertSucceeds(gebruikLink({ db: db('bob'), fs, ik: 'bob', link: bekeken.link }));
  assert.ok(await zijnVrienden('alice', 'bob'));
  assert.equal(await bestaat(`uitnodigingslinks/${token}`), false);
});

test('link hergebruiken: de tweede vindt niets, rechtstreeks geweigerd', async () => {
  const { token } = await maakLink({ ...metDb('alice'), plek: PLEK });
  const bekeken = await bekijkLink({ db: db('bob'), fs, ik: 'bob', token });
  await gebruikLink({ db: db('bob'), fs, ik: 'bob', link: bekeken.link });
  assert.equal((await bekijkLink({ db: db('carol'), fs, ik: 'carol', token })).status, 'ongeldig');
  await assert.rejects(gebruikLink({ db: db('carol'), fs, ik: 'carol', link: bekeken.link }), (e) => e.code === 'niet-mogelijk');
  await assertFails(vriendschapDirect('carol', 'carol', 'alice', { via: 'link', token }));
  assert.ok(await geenVriendschap('alice', 'carol'));
});

test('link gebruiken zonder het token weg te halen: geweigerd', async () => {
  const { token } = await maakLink({ ...metDb('alice'), plek: PLEK });
  await assertFails(vriendschapDirect('bob', 'bob', 'alice', { via: 'link', token }));
  await assertSucceeds(vriendschapDirect('bob', 'bob', 'alice', { via: 'link', token, verwijder: [`uitnodigingslinks/${token}`] }));
});

test('verlopen link (ouder dan 7 dagen): melding en rechtstreeks geweigerd', async () => {
  const token = maakToken();
  const acht = Timestamp.fromMillis(Date.now() - 8 * 24 * 3600 * 1000);
  await zonderRules(omgeving, (d) => setDoc(doc(d, 'uitnodigingslinks', token), { uid: 'alice', gebruikersnaam: 'Alice', naam: 'Alice de Boer', aangemaaktOp: acht }));
  const bekeken = await bekijkLink({ db: db('bob'), fs, ik: 'bob', token });
  assert.equal(bekeken.status, 'verlopen');
  await assert.rejects(gebruikLink({ db: db('bob'), fs, ik: 'bob', link: bekeken.link }), (e) => e.code === 'niet-mogelijk');
  // Net binnen de 7 dagen: wel.
  const token2 = maakToken();
  const bijna = Timestamp.fromMillis(Date.now() - 7 * 24 * 3600 * 1000 + 60_000);
  await zonderRules(omgeving, (d) => setDoc(doc(d, 'uitnodigingslinks', token2), { uid: 'alice', gebruikersnaam: 'Alice', naam: 'Alice de Boer', aangemaaktOp: bijna }));
  const ok = await bekijkLink({ db: db('bob'), fs, ik: 'bob', token: token2 });
  assert.equal(ok.status, 'ok');
  await assertSucceeds(gebruikLink({ db: db('bob'), fs, ik: 'bob', link: ok.link }));
});

test('eigen link, al vrienden, onbekend token: nette status; eigen link gebruiken geweigerd', async () => {
  const { token } = await maakLink({ ...metDb('alice'), plek: PLEK });
  const eigen = await bekijkLink({ db: db('alice'), fs, ik: 'alice', token });
  assert.equal(eigen.status, 'eigen');
  await assert.rejects(gebruikLink({ db: db('alice'), fs, ik: 'alice', link: eigen.link }), (e) => e.code === 'niet-mogelijk');
  await assertFails(vriendschapDirect('alice', 'alice', 'alice', { via: 'link', token, verwijder: [`uitnodigingslinks/${token}`] }));
  await vriendenMaken('alice', 'bob');
  assert.equal((await bekijkLink({ db: db('bob'), fs, ik: 'bob', token })).status, 'vrienden');
  assert.equal((await bekijkLink({ db: db('bob'), fs, ik: 'bob', token: maakToken() })).status, 'ongeldig');
  assert.equal((await bekijkLink({ db: db('bob'), fs, ik: 'bob', token: 'kort' })).status, 'ongeldig');
});

test('links intrekken: alleen je eigen; een ander kan jouw token niet weghalen', async () => {
  const { token } = await maakLink({ ...metDb('alice'), plek: PLEK });
  await assertFails(trekLinkIn({ db: db('bob'), fs, token }));
  assert.equal(await bestaat(`uitnodigingslinks/${token}`), true);
  await assertSucceeds(trekLinkIn({ db: db('alice'), fs, token }));
  assert.equal(await bestaat(`uitnodigingslinks/${token}`), false);
});

test('een token van een ander weghalen via een vriendschap langs een andere weg: geweigerd', async () => {
  const { token } = await maakLink({ ...metDb('carol'), plek: PLEK });
  await stuurVerzoek({ ...metDb('alice'), ander: ALS('bob') });
  // Bob accepteert Alice en probeert in dezelfde batch Carols token weg te halen.
  await assertFails(vriendschapDirect('bob', 'bob', 'alice', { verwijder: ['vriendverzoeken/alice_bob', `uitnodigingslinks/${token}`] }));
  assert.equal(await bestaat(`uitnodigingslinks/${token}`), true);
});

test('links als lijst: alleen je eigen; een exact token opvragen mag', async () => {
  const { token } = await maakLink({ ...metDb('alice'), plek: PLEK });
  await assertFails(getDocs(collection(db('bob'), 'uitnodigingslinks')));
  await assertFails(getDocs(query(collection(db('bob'), 'uitnodigingslinks'), where('uid', '==', 'alice'))));
  await assertSucceeds(getDocs(query(collection(db('alice'), 'uitnodigingslinks'), where('uid', '==', 'alice'))));
  await assertSucceeds(getDoc(doc(db('bob'), 'uitnodigingslinks', token)));
  await assertFails(getDoc(doc(db(null), 'uitnodigingslinks', token)));
  const s = await laadVriendenScherm({ db: db('alice'), fs, ik: 'alice' });
  assert.deepEqual(s.links.map((l) => l.token), [token]);
});

test('link maken met een zwak token, voor een ander, met eigen tijd of valse naam: geweigerd', async () => {
  const zet = (token, velden = {}) =>
    setDoc(doc(db('alice'), 'uitnodigingslinks', token), { uid: 'alice', gebruikersnaam: 'Alice', naam: 'Alice de Boer', aangemaaktOp: serverTimestamp(), ...velden });
  await assertFails(zet('abc'));
  await assertFails(zet('a'.repeat(31)));
  await assertFails(zet(maakToken(), { uid: 'bob' }));
  await assertFails(zet(maakToken(), { aangemaaktOp: new Date() }));
  await assertFails(zet(maakToken(), { naam: 'Iemand Anders' }));
  await assertFails(zet(maakToken(), { extra: 1 }));
  await assertSucceeds(zet(maakToken()));
  // Bijwerken (bv. verlengen) kan niet.
  const t = maakToken();
  await zet(t);
  await assertFails(setDoc(doc(db('alice'), 'uitnodigingslinks', t), { aangemaaktOp: serverTimestamp() }, { merge: true }));
});

// ---------- Uitgelogd ----------

test('uitgelogd: niets lezen of schrijven in de vriendencollecties', async () => {
  const u = db(null);
  await assertFails(getDoc(doc(u, 'vriendverzoeken', 'alice_bob')));
  await assertFails(getDocs(collection(u, 'vrienden', 'alice', 'lijst')));
  await assertFails(setDoc(doc(u, 'blokkades', 'alice', 'lijst', 'bob'), { uid: 'bob' }));
  await assertFails(getDoc(doc(u, 'usernames', 'alice')));
});
