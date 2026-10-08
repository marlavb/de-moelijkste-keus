// Vrienden zoeken op volledige naam (okt 2026), zonder Cloud Functions-
// afhankelijkheden (zie index.js), zodat de tests het met de emulators
// kunnen draaien.
//
// Zoekindex (alleen deze functies schrijven en lezen; clients niets, zie
// firestore.rules):
//   naamIndex/{sleutel}/vermeldingen/{uid}: { uid, bijgewerktOp }
//   naamIndexLid/{uid}:              { sleutel, bijgewerktOp }  (waar uid nu staat)
//   zoekTellers/{dag}:               { dag, per: { uid: n }, bijgewerktOp }
// sleutel = sha256 van de genormaliseerde naam (geen naam leesbaar in de
// documentnamen, en geen problemen met "/" of lengte).
//
// Vindbaar op naam: naamvoorkeur/{uid} { vindbaar, gewijzigdOp }; geen
// document = aan (standaard, ook voor bestaande gebruikers). De index volgt
// het profiel en de voorkeur via triggers (indexeerNaam). Bij het zoeken
// wordt alles nog eens gecontroleerd tegen het profiel en de voorkeur, dus
// een verouderde indexregel geeft nooit een verkeerde treffer.

import { createHash } from 'node:crypto';
import { Timestamp } from 'firebase-admin/firestore';
import { amsterdamDatum } from './mail.js';

export const ZOEK_LIMIET = 20; // per gebruiker per (Amsterdamse) dag
export const MAX_TREFFERS = 10;
export const NAAM_MAX = 60;
const MAX_VERMELDINGEN = 50; // hooguit zoveel indexregels per naam bekijken
const TELLER_DAGEN = 7;
const DAG_MS = 24 * 3600 * 1000;

/** Hoofdletters, accenten en dubbele spaties maken niet uit. */
export function normaliseerNaam(naam) {
  return String(naam ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Minimaal voornaam + achternaam: twee woorden of meer. */
export const isVolledigeNaam = (genormaliseerd) => genormaliseerd.split(' ').filter(Boolean).length >= 2;

/** De indexsleutel van een naam, of null als het geen volledige naam is. */
export function naamSleutel(naam) {
  const n = normaliseerNaam(naam);
  if (!isVolledigeNaam(n) || n.length > NAAM_MAX) return null;
  return createHash('sha256').update(n).digest('hex');
}

const isVindbaar = (voorkeurSnap) => !(voorkeurSnap.exists && voorkeurSnap.data().vindbaar === false);

/**
 * Zet de indexregel van `uid` goed: onder de sleutel van zijn naam als hij
 * een profiel heeft en vindbaar is, anders nergens. Na elke wijziging van
 * profielen/{uid} of naamvoorkeur/{uid}. Geeft 'ongewijzigd', 'gezet' of
 * 'verwijderd'.
 */
export async function indexeerNaam({ db, uid, nu = Date.now() }) {
  return db.runTransaction(async (tx) => {
    const lidRef = db.doc(`naamIndexLid/${uid}`);
    const [profiel, voorkeur, lid] = await Promise.all([tx.get(db.doc(`profielen/${uid}`)), tx.get(db.doc(`naamvoorkeur/${uid}`)), tx.get(lidRef)]);
    const sleutel = profiel.exists && isVindbaar(voorkeur) ? naamSleutel(profiel.data().naam) : null;
    const oud = lid.exists ? lid.data().sleutel : null;
    if (oud === sleutel) return 'ongewijzigd';
    const tijd = Timestamp.fromMillis(nu);
    if (oud) tx.delete(db.doc(`naamIndex/${oud}/vermeldingen/${uid}`));
    if (sleutel) {
      tx.set(db.doc(`naamIndex/${sleutel}/vermeldingen/${uid}`), { uid, bijgewerktOp: tijd });
      tx.set(lidRef, { sleutel, bijgewerktOp: tijd });
      return 'gezet';
    }
    tx.delete(lidRef);
    return 'verwijderd';
  });
}

/**
 * Zoekt op de exacte volledige naam (genormaliseerd). Telt mee voor de
 * daglimiet. Geeft { status: 'ok', treffers: [{ gebruikersnaam, naam }] },
 * { status: 'ongeldig' } of { status: 'limiet' }. Nooit uid's of e-mail.
 * Uitgesloten: jezelf, wie niet (meer) vindbaar is, een naam die niet (meer)
 * klopt, en blokkades in beide richtingen.
 */
export async function zoekOpNaam({ db, uid, invoer, nu = Date.now() }) {
  if (typeof invoer !== 'string' || invoer.length > NAAM_MAX * 2) return { status: 'ongeldig' };
  const sleutel = naamSleutel(invoer);
  if (!sleutel) return { status: 'ongeldig' };

  const dag = amsterdamDatum(nu);
  const telRef = db.doc(`zoekTellers/${dag}`);
  const mag = await db.runTransaction(async (tx) => {
    const snap = await tx.get(telRef);
    const per = snap.exists ? snap.data().per ?? {} : {};
    const n = per[uid] ?? 0;
    if (n >= ZOEK_LIMIET) return false;
    tx.set(telRef, { dag, per: { ...per, [uid]: n + 1 }, bijgewerktOp: Timestamp.fromMillis(nu) });
    return true;
  });
  if (!mag) return { status: 'limiet' };

  const vermeldingen = await db.collection(`naamIndex/${sleutel}/vermeldingen`).limit(MAX_VERMELDINGEN).get();
  const treffers = [];
  for (const d of vermeldingen.docs) {
    const ander = d.id;
    if (ander === uid) continue;
    const [profiel, voorkeur, blokHeen, blokTerug] = await Promise.all([
      db.doc(`profielen/${ander}`).get(),
      db.doc(`naamvoorkeur/${ander}`).get(),
      db.doc(`blokkades/${uid}/lijst/${ander}`).get(),
      db.doc(`blokkades/${ander}/lijst/${uid}`).get(),
    ]);
    if (!profiel.exists || !isVindbaar(voorkeur) || blokHeen.exists || blokTerug.exists) continue;
    const p = profiel.data();
    if (naamSleutel(p.naam) !== sleutel) continue;
    treffers.push({ gebruikersnaam: p.gebruikersnaam, naam: p.naam });
  }
  treffers.sort((a, b) => a.gebruikersnaam.localeCompare(b.gebruikersnaam));
  return { status: 'ok', treffers: treffers.slice(0, MAX_TREFFERS) };
}

/** zoekTellers ouder dan TELLER_DAGEN weghalen (hooguit 50 per keer). */
export async function ruimZoekTellersOp({ db, nu = Date.now() }) {
  const grens = amsterdamDatum(nu - TELLER_DAGEN * DAG_MS);
  const oud = await db.collection('zoekTellers').where('dag', '<', grens).limit(50).get();
  if (oud.empty) return 0;
  const b = db.batch();
  for (const d of oud.docs) b.delete(d.ref);
  await b.commit();
  return oud.size;
}
