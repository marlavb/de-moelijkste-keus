// Rules voor profielen/{uid} en usernames/{laag} (vrienden, stap 1).
// Eerst via bewaarProfiel() uit de app zelf (public/js/profiel.js), dan met
// directe schrijfacties die de controle in de app overslaan, zoals een
// kwaadwillende client dat zou doen.

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import {
  doc,
  getDoc,
  getDocs,
  setDoc,
  deleteDoc,
  collection,
  query,
  where,
  writeBatch,
  runTransaction,
  serverTimestamp,
} from 'firebase/firestore';
import { maakOmgeving, als, zonderRules } from './omgeving.js';
import { bewaarProfiel, laadProfiel, ProfielFout } from '../../public/js/profiel.js';

const fs = { runTransaction, doc, getDoc, serverTimestamp };

let omgeving;
before(async () => {
  omgeving = await maakOmgeving();
});
after(async () => {
  await omgeving?.cleanup();
});
beforeEach(async () => {
  await omgeving.clearFirestore();
});

const bewaar = (uid, gebruikersnaam, naam = 'Iemand') =>
  bewaarProfiel({ db: als(omgeving, uid), fs, uid, gebruikersnaam, naam });

/**
 * Directe batch: profiel + usernames-document zoals de app ze schrijft, met
 * per test één ding anders. `laag`/`weergave` gelden voor beide, tenzij
 * overschreven in `profiel`/`naamDoc`. `oudVrijgeven` haalt een oude naam weg.
 */
async function direct(uid, { laag = 'alice', weergave = laag, naam = 'Alice A', profiel = {}, naamDoc = {}, naamId = laag, oudVrijgeven = null, zonderNaamDoc = false } = {}) {
  const db = als(omgeving, uid);
  const b = writeBatch(db);
  b.set(doc(db, 'profielen', uid), {
    gebruikersnaam: weergave,
    gebruikersnaamLaag: laag,
    naam,
    aangemaaktOp: serverTimestamp(),
    gewijzigdOp: serverTimestamp(),
    v: 1,
    ...profiel,
  });
  if (!zonderNaamDoc) b.set(doc(db, 'usernames', naamId), { uid, gebruikersnaam: weergave, naam, ...naamDoc });
  if (oudVrijgeven) b.delete(doc(db, 'usernames', oudVrijgeven));
  return b.commit();
}

// ---------- Kiezen, uniekheid ----------

test('een gebruikersnaam kiezen: profiel en usernames-document staan er, met dezelfde gegevens', async () => {
  await assertSucceeds(bewaar('alice', 'Alice_B', 'Alice de Boer'));
  const profiel = await laadProfiel({ db: als(omgeving, 'alice'), fs, uid: 'alice' });
  assert.equal(profiel.gebruikersnaam, 'Alice_B');
  assert.equal(profiel.gebruikersnaamLaag, 'alice_b');
  assert.equal(profiel.naam, 'Alice de Boer');
  const naam = await getDoc(doc(als(omgeving, 'bob'), 'usernames', 'alice_b'));
  assert.deepEqual(naam.data(), { uid: 'alice', gebruikersnaam: 'Alice_B', naam: 'Alice de Boer' });
});

test('uniek, ook met andere hoofdletters: de tweede krijgt "bezet"', async () => {
  await bewaar('alice', 'anna');
  await assert.rejects(bewaar('bob', 'ANNA'), (e) => e instanceof ProfielFout && e.code === 'bezet');
  await assert.rejects(bewaar('bob', 'Anna'), (e) => e instanceof ProfielFout && e.code === 'bezet');
  assert.equal(await laadProfiel({ db: als(omgeving, 'bob'), fs, uid: 'bob' }), null);
});

test('gelijktijdig dezelfde naam (ook in andere hoofdletters): precies één wint', async () => {
  for (const [a, b] of [['zelfde', 'zelfde'], ['Zelfde', 'zELFDE']]) {
    await omgeving.clearFirestore();
    const uitkomst = await Promise.allSettled([bewaar('alice', a), bewaar('bob', b)]);
    const gelukt = uitkomst.filter((u) => u.status === 'fulfilled');
    assert.equal(gelukt.length, 1, `${a}/${b}: ${JSON.stringify(uitkomst.map((u) => u.status))}`);
    const winnaar = uitkomst[0].status === 'fulfilled' ? 'alice' : 'bob';
    const verliezer = winnaar === 'alice' ? 'bob' : 'alice';
    const naamDoc = await getDoc(doc(als(omgeving, 'carol'), 'usernames', 'zelfde'));
    assert.equal(naamDoc.data().uid, winnaar);
    assert.equal(await laadProfiel({ db: als(omgeving, verliezer), fs, uid: verliezer }), null);
  }
});

test('gelijktijdig, rechtstreeks (zonder leescontrole): de tweede schrijfactie wordt geweigerd', async () => {
  const uitkomst = await Promise.allSettled([
    direct('alice', { laag: 'gedeeld' }),
    direct('bob', { laag: 'gedeeld' }),
  ]);
  assert.equal(uitkomst.filter((u) => u.status === 'fulfilled').length, 1);
});

// ---------- Wijzigen en vrijgeven ----------

test('naam wijzigen geeft de oude vrij; een ander kan die dan kiezen', async () => {
  await bewaar('alice', 'alice');
  await assertSucceeds(bewaar('alice', 'alice2', 'Alice Nieuw'));
  const db = als(omgeving, 'bob');
  assert.equal((await getDoc(doc(db, 'usernames', 'alice'))).exists(), false);
  assert.equal((await getDoc(doc(db, 'usernames', 'alice2'))).data().naam, 'Alice Nieuw');
  await assertSucceeds(bewaar('bob', 'Alice'));
});

test('alleen hoofdletters of de volledige naam wijzigen kan (zelfde usernames-document)', async () => {
  await bewaar('alice', 'alice', 'Alice');
  await assertSucceeds(bewaar('alice', 'ALICE', 'Alice van Dam'));
  const naamDoc = await getDoc(doc(als(omgeving, 'bob'), 'usernames', 'alice'));
  assert.deepEqual(naamDoc.data(), { uid: 'alice', gebruikersnaam: 'ALICE', naam: 'Alice van Dam' });
});

test('aangemaaktOp blijft staan bij wijzigen', async () => {
  await bewaar('alice', 'alice');
  const eerst = await laadProfiel({ db: als(omgeving, 'alice'), fs, uid: 'alice' });
  await bewaar('alice', 'alice.b');
  const daarna = await laadProfiel({ db: als(omgeving, 'alice'), fs, uid: 'alice' });
  assert.ok(eerst.aangemaaktOp.isEqual(daarna.aangemaaktOp));
});

test('andere naam kiezen zonder de oude vrij te geven: geweigerd', async () => {
  await bewaar('alice', 'alice');
  await assertFails(
    direct('alice', { laag: 'alice2', profiel: { aangemaaktOp: (await laadProfiel({ db: als(omgeving, 'alice'), fs, uid: 'alice' })).aangemaaktOp } })
  );
});

test('de naam die het profiel gebruikt kan niet los worden weggehaald, en het profiel niet los', async () => {
  await bewaar('alice', 'alice');
  const db = als(omgeving, 'alice');
  await assertFails(deleteDoc(doc(db, 'usernames', 'alice')));
  await assertFails(deleteDoc(doc(db, 'profielen', 'alice')));
  const b = writeBatch(db);
  b.delete(doc(db, 'profielen', 'alice'));
  b.delete(doc(db, 'usernames', 'alice'));
  await assertSucceeds(b.commit());
});

// ---------- aangemaaktOp: aanmaken versus wijzigen ----------
// Aanmaken: aangemaaktOp moet de servertijd zijn. Wijzigen: aangemaaktOp
// moet gelijk blijven, dus ook "opnieuw op nu zetten" mag niet.

test('nieuw profiel met aangemaaktOp = servertijd: toegestaan', async () => {
  await assertSucceeds(direct('alice', { profiel: { aangemaaktOp: serverTimestamp() } }));
});

test('profiel wijzigen en aangemaaktOp opnieuw op "nu" zetten: geweigerd', async () => {
  await bewaar('alice', 'alice', 'Alice A');
  await assertFails(direct('alice', { laag: 'alice', naam: 'Alice B', profiel: { aangemaaktOp: serverTimestamp() } }));
});

test('profiel wijzigen met een andere aangemaaktOp of zonder: geweigerd; met de oude: toegestaan', async () => {
  await bewaar('alice', 'alice', 'Alice A');
  const { aangemaaktOp } = await laadProfiel({ db: als(omgeving, 'alice'), fs, uid: 'alice' });
  await assertFails(direct('alice', { laag: 'alice', naam: 'Alice B', profiel: { aangemaaktOp: new Date('2020-01-01') } }));
  const db = als(omgeving, 'alice');
  await assertFails(
    setDoc(doc(db, 'profielen', 'alice'), {
      gebruikersnaam: 'alice', gebruikersnaamLaag: 'alice', naam: 'Alice A', gewijzigdOp: serverTimestamp(), v: 1,
    })
  );
  await assertSucceeds(direct('alice', { laag: 'alice', naam: 'Alice B', profiel: { aangemaaktOp } }));
});

// ---------- Opruimen van losse resten (de !existsAfter-takken) ----------

test('een losse naam zonder profiel kan de eigenaar weghalen, een ander niet', async () => {
  await zonderRules(omgeving, (db) => setDoc(doc(db, 'usernames', 'los'), { uid: 'alice', gebruikersnaam: 'los', naam: 'Alice' }));
  await assertFails(deleteDoc(doc(als(omgeving, 'bob'), 'usernames', 'los')));
  await assertSucceeds(deleteDoc(doc(als(omgeving, 'alice'), 'usernames', 'los')));
});

test('een los profiel zonder naam kan de eigenaar weghalen', async () => {
  await zonderRules(omgeving, (db) =>
    setDoc(doc(db, 'profielen', 'alice'), { gebruikersnaam: 'weg', gebruikersnaamLaag: 'weg', naam: 'Alice', aangemaaktOp: new Date(), gewijzigdOp: new Date(), v: 1 })
  );
  await assertSucceeds(deleteDoc(doc(als(omgeving, 'alice'), 'profielen', 'alice')));
});

test('een oude naam weghalen terwijl het profiel al een nieuwe heeft: toegestaan', async () => {
  await bewaar('alice', 'nieuw');
  await zonderRules(omgeving, (db) => setDoc(doc(db, 'usernames', 'oud'), { uid: 'alice', gebruikersnaam: 'oud', naam: 'Iemand' }));
  await assertSucceeds(deleteDoc(doc(als(omgeving, 'alice'), 'usernames', 'oud')));
});

// ---------- Kapen ----------

test('iemand anders z\'n naam kapen: overschrijven, weghalen of overnemen wordt geweigerd', async () => {
  await bewaar('alice', 'alice', 'Alice');
  const db = als(omgeving, 'bob');
  await assertFails(setDoc(doc(db, 'usernames', 'alice'), { uid: 'bob', gebruikersnaam: 'alice', naam: 'Bob' }));
  await assertFails(setDoc(doc(db, 'usernames', 'alice'), { naam: 'Bob' }, { merge: true }));
  await assertFails(deleteDoc(doc(db, 'usernames', 'alice')));
  await assertFails(direct('bob', { laag: 'alice', naam: 'Bob' }));
  // Profiel van Bob dat naar Alices naam wijst, zonder usernames-document.
  await assertFails(direct('bob', { laag: 'alice', naam: 'Alice', zonderNaamDoc: true }));
});

test('een naam vastleggen voor een ander of in andermans profiel schrijven: geweigerd', async () => {
  const db = als(omgeving, 'bob');
  await assertFails(setDoc(doc(db, 'usernames', 'carol'), { uid: 'carol', gebruikersnaam: 'carol', naam: 'Carol' }));
  await bewaar('alice', 'alice');
  await assertFails(setDoc(doc(db, 'profielen', 'alice'), { naam: 'Gekaapt' }, { merge: true }));
  await assertFails(deleteDoc(doc(db, 'profielen', 'alice')));
});

test('een usernames-document zonder bijpassend profiel: geweigerd', async () => {
  const db = als(omgeving, 'bob');
  await assertFails(setDoc(doc(db, 'usernames', 'bob'), { uid: 'bob', gebruikersnaam: 'bob', naam: 'Bob' }));
});

test('een tweede naam vasthouden naast de eigen: geweigerd', async () => {
  await bewaar('bob', 'bob', 'Bob');
  const db = als(omgeving, 'bob');
  await assertFails(setDoc(doc(db, 'usernames', 'bob2'), { uid: 'bob', gebruikersnaam: 'bob2', naam: 'Bob' }));
});

// ---------- Lezen ----------

test('usernames: ingelogd opvragen op de exacte naam mag, uitgelogd niet', async () => {
  await bewaar('alice', 'alice');
  await assertSucceeds(getDoc(doc(als(omgeving, 'bob'), 'usernames', 'alice')));
  await assertSucceeds(getDoc(doc(als(omgeving, 'bob'), 'usernames', 'bestaatniet')));
  await assertFails(getDoc(doc(als(omgeving, null), 'usernames', 'alice')));
});

test('usernames en profielen: een lijst opvragen (list) wordt altijd geweigerd', async () => {
  await bewaar('alice', 'alice');
  const db = als(omgeving, 'alice');
  await assertFails(getDocs(collection(db, 'usernames')));
  await assertFails(getDocs(query(collection(db, 'usernames'), where('uid', '==', 'alice'))));
  await assertFails(getDocs(collection(db, 'profielen')));
  await assertFails(getDocs(query(collection(db, 'profielen'), where('gebruikersnaamLaag', '==', 'alice'))));
});

test('profielen: de eigenaar leest het eigen profiel, een niet-vriend en uitgelogd niet (vrienden: vrienden.test.js)', async () => {
  await bewaar('alice', 'alice');
  await assertSucceeds(getDoc(doc(als(omgeving, 'alice'), 'profielen', 'alice')));
  await assertFails(getDoc(doc(als(omgeving, 'bob'), 'profielen', 'alice')));
  await assertFails(getDoc(doc(als(omgeving, null), 'profielen', 'alice')));
});

// ---------- Ongeldige velden (rechtstreeks, zonder de controle in de app) ----------

test('controle: de directe schrijfactie zelf is geldig', async () => {
  await assertSucceeds(direct('alice'));
});

const ONGELDIG = {
  'te kort': { laag: 'ab' },
  'te lang': { laag: 'a'.repeat(21) },
  'hoofdletters in de id': { naamId: 'Alice', weergave: 'Alice' },
  'spatie': { laag: 'al ice' },
  'accent': { laag: 'aliçe' },
  'begint met een punt': { laag: '.alice' },
  'eindigt met een liggend streepje': { laag: 'alice_' },
  'twee leestekens achter elkaar': { laag: 'al..ice' },
  'gereserveerd': { laag: 'admin' },
  'met podiumpas erin': { laag: 'fan.podiumpas' },
  'weergave past niet bij de id': { weergave: 'bob' },
  'naam leeg': { naam: '' },
  'naam te lang': { naam: 'x'.repeat(61) },
  'naam met regeleinde': { naam: 'Alice\nA' },
  'naam met spatie aan het eind': { naam: 'Alice ' },
  'naam geen tekst': { naam: 42 },
  'extra veld in profiel': { profiel: { rol: 'admin' } },
  'extra veld in usernames': { naamDoc: { email: 'x@y.nl' } },
  'ander uid in usernames': { naamDoc: { uid: 'bob' } },
  'andere naam in usernames': { naamDoc: { naam: 'Iemand anders' } },
  'versie 2': { profiel: { v: 2 } },
  'zelfgekozen aangemaaktOp': { profiel: { aangemaaktOp: new Date('2020-01-01') } },
  'zelfgekozen gewijzigdOp': { profiel: { gewijzigdOp: new Date('2020-01-01') } },
  'veld ontbreekt': { profiel: { v: undefined } },
};

for (const [wat, opties] of Object.entries(ONGELDIG)) {
  test(`ongeldig geweigerd: ${wat}`, async () => {
    const o = { ...opties };
    if (o.profiel && 'v' in o.profiel && o.profiel.v === undefined) {
      // Een veld weglaten: zonder v schrijven.
      const db = als(omgeving, 'alice');
      const b = writeBatch(db);
      b.set(doc(db, 'profielen', 'alice'), {
        gebruikersnaam: 'alice', gebruikersnaamLaag: 'alice', naam: 'Alice A',
        aangemaaktOp: serverTimestamp(), gewijzigdOp: serverTimestamp(),
      });
      b.set(doc(db, 'usernames', 'alice'), { uid: 'alice', gebruikersnaam: 'alice', naam: 'Alice A' });
      await assertFails(b.commit());
      return;
    }
    await assertFails(direct('alice', o));
  });
}

test('bewaarProfiel weigert ongeldige invoer al vóór Firestore', async () => {
  await assert.rejects(bewaar('alice', 'a'), (e) => e.code === 'ongeldig');
  await assert.rejects(bewaar('alice', 'alice', '   '), (e) => e.code === 'ongeldig');
});
