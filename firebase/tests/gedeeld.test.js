// Rules voor delen met vrienden (stap 3): de instelling gedeeld/{uid} en de
// kopieën gedeeld/{uid}/onderdelen/{gezien|watchlist}. Via de functies uit de
// app (public/js/gedeeld.js) en met directe schrijfacties.

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
} from 'firebase/firestore';
import { maakOmgeving, als, zonderRules } from './omgeving.js';
import { bewaarProfiel } from '../../public/js/profiel.js';
import { stuurVerzoek, accepteer, verbreek, blokkeer } from '../../public/js/vrienden.js';
import { zetInstelling, schrijfKopie, laadEigenDelen, laadVriendDelen } from '../../public/js/gedeeld.js';

const fs = { doc, getDoc, getDocs, setDoc, deleteDoc, writeBatch, collection, query, where, serverTimestamp, getCountFromServer, runTransaction };
const PROFIEL = {
  alice: { gebruikersnaam: 'Alice', naam: 'Alice de Boer' },
  bob: { gebruikersnaam: 'bob', naam: 'Bob Jansen' },
  carol: { gebruikersnaam: 'carol', naam: 'Carol Smit' },
};
const GEZIEN = { items: [{ sleutel: 'controle', titel: 'Controle', genre: 'Toneel', beoordeling: 4.5, laatsteBezoek: '2026-09-12', aantal: 2 }], stand: 1000 };
const WATCHLIST = { items: [{ sleutel: 'titanique', titel: 'Titanique', genre: 'Musical' }], stand: 2000 };

let omgeving;
before(async () => {
  omgeving = await maakOmgeving();
});
after(async () => {
  await omgeving?.cleanup();
});
beforeEach(async () => {
  await omgeving.clearFirestore();
  for (const [uid, p] of Object.entries(PROFIEL)) await bewaarProfiel({ db: als(omgeving, uid), fs, uid, ...p });
  // Alice en Bob zijn vrienden; Carol niet.
  await stuurVerzoek({ db: db('alice'), fs, ik: 'alice', mijnProfiel: PROFIEL.alice, ander: { uid: 'bob', ...PROFIEL.bob } });
  await accepteer({ db: db('bob'), fs, ik: 'bob', van: 'alice' });
});

function db(uid) {
  return als(omgeving, uid);
}
const kopie = (wie, eigenaar, onderdeel) => doc(db(wie), 'gedeeld', eigenaar, 'onderdelen', onderdeel);
const deelAlles = () => zetInstelling({ db: db('alice'), fs, uid: 'alice', instelling: { gezien: true, watchlist: true }, kopieen: { gezien: GEZIEN, watchlist: WATCHLIST } });
const bestaat = async (pad) => {
  let uit;
  await zonderRules(omgeving, async (d) => {
    uit = (await getDoc(doc(d, pad))).exists();
  });
  return uit;
};
/** Rechtstreeks een kopie van Alice, met per test één ding anders. */
const kopieDirect = (velden = {}, onderdeel = 'gezien', wie = 'alice') =>
  setDoc(doc(db(wie), 'gedeeld', 'alice', 'onderdelen', onderdeel), {
    items: GEZIEN.items, stand: 5000, nv: 4, v: 1, bijgewerktOp: serverTimestamp(), ...velden,
  });

// ---------- Eigenaar ----------

test('eigenaar: instelling en kopieën in één batch, en zelf lezen', async () => {
  await assertSucceeds(deelAlles());
  const eigen = await laadEigenDelen({ db: db('alice'), fs, uid: 'alice' });
  assert.deepEqual(eigen.instelling, { gezien: true, watchlist: true });
  assert.deepEqual(eigen.kopieen.gezien.items, GEZIEN.items);
  assert.equal(eigen.kopieen.watchlist.stand, 2000);
});

test('nog niets gekozen: geen instelling, en een kopie schrijven wordt geweigerd', async () => {
  assert.equal((await laadEigenDelen({ db: db('alice'), fs, uid: 'alice' })).instelling, null);
  await assertFails(schrijfKopie({ db: db('alice'), fs, uid: 'alice', onderdeel: 'gezien', ...GEZIEN }));
});

test('uitzetten haalt de kopie weg; weer aanzetten schrijft hem opnieuw', async () => {
  await deelAlles();
  await assertSucceeds(zetInstelling({ db: db('alice'), fs, uid: 'alice', instelling: { gezien: true, watchlist: false } }));
  assert.equal(await bestaat('gedeeld/alice/onderdelen/watchlist'), false);
  assert.equal(await bestaat('gedeeld/alice/onderdelen/gezien'), true);
  await assertSucceeds(zetInstelling({ db: db('alice'), fs, uid: 'alice', instelling: { gezien: true, watchlist: true }, kopieen: { watchlist: WATCHLIST } }));
  assert.equal(await bestaat('gedeeld/alice/onderdelen/watchlist'), true);
});

test('een kopie schrijven voor een onderdeel dat uit staat: geweigerd', async () => {
  await zetInstelling({ db: db('alice'), fs, uid: 'alice', instelling: { gezien: true, watchlist: false } });
  await assertFails(schrijfKopie({ db: db('alice'), fs, uid: 'alice', onderdeel: 'watchlist', ...WATCHLIST }));
  await assertSucceeds(schrijfKopie({ db: db('alice'), fs, uid: 'alice', onderdeel: 'gezien', ...GEZIEN }));
});

test('een oudere stand over een nieuwere: geweigerd; gelijk of nieuwer mag', async () => {
  await deelAlles();
  await assertFails(schrijfKopie({ db: db('alice'), fs, uid: 'alice', onderdeel: 'gezien', items: [], stand: 999 }));
  await assertSucceeds(schrijfKopie({ db: db('alice'), fs, uid: 'alice', onderdeel: 'gezien', items: GEZIEN.items, stand: 1000 }));
  await assertSucceeds(schrijfKopie({ db: db('alice'), fs, uid: 'alice', onderdeel: 'gezien', items: [], stand: 1001 }));
});

// ---------- Lezen door anderen ----------

test('vriend leest wat gedeeld wordt', async () => {
  await deelAlles();
  await assertSucceeds(getDoc(kopie('bob', 'alice', 'gezien')));
  await assertSucceeds(getDoc(doc(db('bob'), 'gedeeld', 'alice')));
  const v = await laadVriendDelen({ db: db('bob'), fs, uid: 'alice' });
  assert.equal(v.gebruikersnaam, 'Alice');
  assert.deepEqual(v.gezien, GEZIEN.items);
  assert.deepEqual(v.watchlist, WATCHLIST.items);
});

test('vriend leest een niet-gedeeld onderdeel: geweigerd, ook als de kopie er nog staat', async () => {
  await deelAlles();
  await zetInstelling({ db: db('alice'), fs, uid: 'alice', instelling: { gezien: false, watchlist: true } });
  // Kopie staat er (bv. een mislukte opruiming) terwijl de instelling uit is.
  await zonderRules(omgeving, (d) => setDoc(doc(d, 'gedeeld', 'alice', 'onderdelen', 'gezien'), { items: GEZIEN.items, stand: 1, nv: 4, v: 1, bijgewerktOp: new Date() }));
  await assertFails(getDoc(kopie('bob', 'alice', 'gezien')));
  const v = await laadVriendDelen({ db: db('bob'), fs, uid: 'alice' });
  assert.equal(v.gezien, null);
  assert.deepEqual(v.watchlist, WATCHLIST.items);
});

test('gedeeld maar nog geen kopie: leeg in plaats van "deelt dit niet"', async () => {
  await zetInstelling({ db: db('alice'), fs, uid: 'alice', instelling: { gezien: true, watchlist: true } });
  const v = await laadVriendDelen({ db: db('bob'), fs, uid: 'alice' });
  assert.deepEqual(v.gezien, []);
  assert.deepEqual(v.watchlist, []);
});

test('niet-vriend: instelling en kopieën geweigerd', async () => {
  await deelAlles();
  await assertFails(getDoc(kopie('carol', 'alice', 'gezien')));
  await assertFails(getDoc(kopie('carol', 'alice', 'watchlist')));
  await assertFails(getDoc(doc(db('carol'), 'gedeeld', 'alice')));
  assert.equal(await laadVriendDelen({ db: db('carol'), fs, uid: 'alice' }), null);
  await assertFails(getDoc(doc(db(null), 'gedeeld', 'alice', 'onderdelen', 'gezien')));
});

test('na verbreken: geweigerd', async () => {
  await deelAlles();
  await verbreek({ db: db('bob'), fs, ik: 'bob', ander: 'alice' });
  await assertFails(getDoc(kopie('bob', 'alice', 'gezien')));
  await assertFails(getDoc(kopie('bob', 'alice', 'watchlist')));
});

test('geblokkeerd (in beide richtingen): geweigerd', async () => {
  await deelAlles();
  await blokkeer({ db: db('alice'), fs, ik: 'alice', ander: { uid: 'bob', ...PROFIEL.bob } });
  await assertFails(getDoc(kopie('bob', 'alice', 'gezien')));
  // En andersom: Bob blokkeert Alice, Alice deelt nog steeds.
  await omgeving.clearFirestore();
  for (const [uid, p] of Object.entries(PROFIEL)) await bewaarProfiel({ db: db(uid), fs, uid, ...p });
  await stuurVerzoek({ db: db('alice'), fs, ik: 'alice', mijnProfiel: PROFIEL.alice, ander: { uid: 'bob', ...PROFIEL.bob } });
  await accepteer({ db: db('bob'), fs, ik: 'bob', van: 'alice' });
  await deelAlles();
  await blokkeer({ db: db('bob'), fs, ik: 'bob', ander: { uid: 'alice', ...PROFIEL.alice } });
  await assertFails(getDoc(kopie('bob', 'alice', 'gezien')));
});

test('lijsten opvragen: geweigerd', async () => {
  await deelAlles();
  await assertFails(getDocs(collection(db('bob'), 'gedeeld', 'alice', 'onderdelen')));
  await assertFails(getDocs(collection(db('bob'), 'gedeeld')));
  await assertFails(getDocs(collection(db('alice'), 'gedeeld')));
});

// ---------- Schrijven door anderen ----------

test('een ander schrijft of wist in jouw kopie of instelling: geweigerd', async () => {
  await deelAlles();
  await assertFails(kopieDirect({}, 'gezien', 'bob'));
  await assertFails(deleteDoc(kopie('bob', 'alice', 'gezien')));
  await assertFails(setDoc(doc(db('bob'), 'gedeeld', 'alice'), { gezien: false, watchlist: false, gewijzigdOp: serverTimestamp() }));
  await assertFails(deleteDoc(doc(db('bob'), 'gedeeld', 'alice')));
  await assertFails(schrijfKopie({ db: db('bob'), fs, uid: 'alice', onderdeel: 'gezien', ...GEZIEN }));
});

// ---------- Vorm ----------

test('controle: de directe kopie zelf is geldig', async () => {
  await deelAlles();
  await assertSucceeds(kopieDirect());
});

const ONGELDIGE_KOPIE = {
  'extra veld': { theaters: ['delamar'] },
  'items geen lijst': { items: { a: 1 } },
  'meer dan 1000 items': { items: Array.from({ length: 1001 }, (_, i) => ({ sleutel: `s${i}`, titel: 't' })) },
  'stand geen geheel getal': { stand: 1.5 },
  'stand als tekst': { stand: '5000' },
  'negatieve stand': { stand: -1 },
  'nv 0': { nv: 0 },
  'versie 2': { v: 2 },
  'zelfgekozen bijgewerktOp': { bijgewerktOp: new Date('2020-01-01') },
};
for (const [wat, velden] of Object.entries(ONGELDIGE_KOPIE)) {
  test(`ongeldige kopie geweigerd: ${wat}`, async () => {
    await deelAlles();
    await assertFails(kopieDirect(velden));
  });
}

test('ongeldige kopie geweigerd: ontbrekend veld en onbekend onderdeel', async () => {
  await deelAlles();
  await assertFails(setDoc(kopie('alice', 'alice', 'gezien'), { items: [], stand: 5000, v: 1, bijgewerktOp: serverTimestamp() }));
  await assertFails(kopieDirect({}, 'gepland'));
});

test('ongeldige instelling geweigerd: geen ja/nee, extra veld, eigen tijd', async () => {
  const zet = (velden) => setDoc(doc(db('alice'), 'gedeeld', 'alice'), { gezien: true, watchlist: true, gewijzigdOp: serverTimestamp(), ...velden });
  await assertFails(zet({ gezien: 'ja' }));
  await assertFails(zet({ gepland: true }));
  await assertFails(zet({ gewijzigdOp: new Date('2020-01-01') }));
  await assertSucceeds(zet({}));
});

test('instelling weghalen alleen samen met de kopieën', async () => {
  await deelAlles();
  await assertFails(deleteDoc(doc(db('alice'), 'gedeeld', 'alice')));
  const d = db('alice');
  const b = writeBatch(d);
  b.delete(doc(d, 'gedeeld', 'alice', 'onderdelen', 'gezien'));
  b.delete(doc(d, 'gedeeld', 'alice', 'onderdelen', 'watchlist'));
  b.delete(doc(d, 'gedeeld', 'alice'));
  await assertSucceeds(b.commit());
});

test('de lezer maakt een kopie schoon (geen extra velden, ingekorte tekst, geldige sterren)', async () => {
  await zetInstelling({ db: db('alice'), fs, uid: 'alice', instelling: { gezien: true, watchlist: false } });
  await zonderRules(omgeving, (d) =>
    setDoc(doc(d, 'gedeeld', 'alice', 'onderdelen', 'gezien'), {
      items: [
        { sleutel: 'a', titel: 'x'.repeat(500), beoordeling: 7, laatsteBezoek: 'gisteren', aantal: -3, zaal: 'Grote zaal', html: '<b>' },
        { titel: 'zonder sleutel' },
        'geen object',
      ],
      stand: 1, nv: 4, v: 1, bijgewerktOp: new Date(),
    })
  );
  const v = await laadVriendDelen({ db: db('bob'), fs, uid: 'alice' });
  assert.deepEqual(v.gezien, [{ sleutel: 'a', titel: 'x'.repeat(200), aantal: 1 }]);
});
