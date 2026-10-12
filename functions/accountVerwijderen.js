// Account verwijderen (vrienden stap 6, okt 2026), zonder Cloud Functions-
// afhankelijkheden (zie index.js), zodat de tests het met de emulators
// kunnen draaien. De callable `verwijderAccount` roept verwijderAccount()
// aan met de admin SDK; de rules gelden daar niet, dus alles wat hieronder
// staat, gebeurt ook als een client het zelf niet zou mogen.
//
// Idempotent: mislukt er halverwege iets, dan maakt een tweede aanroep het
// af. De Auth-gebruiker gaat als laatste weg, zodat opnieuw proberen kan.
//
// Wat er weggaat (alles over `uid`, ook bij anderen):
//   users/{uid}                          watchlist, Gezien, planning, theaterkeuze
//   profielen/{uid}, usernames/{laag}    profiel; de gebruikersnaam is weer vrij
//   naamvoorkeur/{uid}, mailvoorkeur/{uid}
//   naamIndexLid/{uid} + naamIndex/{s}/vermeldingen/{uid}
//   vrienden/{uid}/lijst/* en vrienden/{x}/lijst/{uid}      (beide kanten)
//   blokkades/{uid}/lijst/* en blokkades/{x}/lijst/{uid}    (ook wie jou blokkeerde)
//   vriendverzoeken van en aan uid, uitnodigingslinks van uid
//   gedeeld/{uid} (+ onderdelen)
//   plannen van uid: het plan met alle leden (gasten zien "Gedeeld plan opgeheven")
//   plannen van anderen: uid uit genodigden en zijn lid-document
//   inbox/{uid} (+ berichten) en berichten van uid in andere inboxen
//   mailLog van die plannen, uid uit mailTellers en zoekTellers
//   tot slot de Auth-gebruiker.
// Twee zoekopdrachten lopen over alle collecties met dezelfde naam
// (collectionGroup 'lijst' op uid, 'berichten' op van): daarvoor staan
// indexen in firestore.indexes.json.

import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { amsterdamDatum } from './mail.js';

export const VERWIJDER_LIMIET = 5; // pogingen per gebruiker per (Amsterdamse) dag
export const RECENT_INGELOGD_S = 10 * 60; // auth_time hooguit zo lang geleden

/** Alle documenten van een query weghalen (met subcollecties); geeft het aantal. */
async function weg(db, snaps) {
  let n = 0;
  for (const d of snaps.docs) {
    await db.recursiveDelete(d.ref);
    n++;
  }
  return n;
}

/**
 * Telt een poging mee voor de daglimiet. Geeft false als de limiet bereikt is.
 * De teller (verwijderTellers/{dag}) verliest de uid weer bij succes.
 */
export async function telPoging({ db, uid, nu = Date.now() }) {
  const dag = amsterdamDatum(nu);
  const ref = db.doc(`verwijderTellers/${dag}`);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const per = snap.exists ? snap.data().per ?? {} : {};
    const n = per[uid] ?? 0;
    if (n >= VERWIJDER_LIMIET) return false;
    tx.set(ref, { dag, per: { ...per, [uid]: n + 1 }, bijgewerktOp: Timestamp.fromMillis(nu) });
    return true;
  });
}

/**
 * Verwijdert alles van `uid` (zie boven) en tot slot de Auth-gebruiker.
 * Geeft tellingen terug (geen namen of uid's van anderen).
 */
export async function verwijderAccount({ db, auth, uid, nu = Date.now() }) {
  if (typeof uid !== 'string' || !uid) throw new Error('geen uid');
  const t = { plannenEigen: 0, plannenGast: 0, vrienden: 0, lijstBijAnderen: 0, verzoeken: 0, links: 0, berichtenVanMij: 0, gebruikersnamen: 0, tellers: 0 };

  // Plannen die uid organiseert: weg met alle leden (en hun mailLog).
  const eigen = await db.collection('plannen').where('eigenaar', '==', uid).get();
  for (const p of eigen.docs) {
    for (const g of p.data().genodigden ?? []) await db.doc(`mailLog/${p.id}_${g}`).delete();
    await db.recursiveDelete(p.ref);
    t.plannenEigen++;
  }
  // Plannen van anderen: uid eruit (genodigden en lid-document).
  const gast = await db.collection('plannen').where('genodigden', 'array-contains', uid).get();
  for (const p of gast.docs) {
    await db.doc(`plannen/${p.id}/leden/${uid}`).delete();
    await p.ref.update({ genodigden: FieldValue.arrayRemove(uid), gewijzigdOp: Timestamp.fromMillis(nu) });
    await db.doc(`mailLog/${p.id}_${uid}`).delete();
    t.plannenGast++;
  }

  // Vriendschappen en blokkades: de eigen lijsten, en uid in de lijsten van
  // anderen (vrienden/{x}/lijst/{uid}, blokkades/{x}/lijst/{uid}).
  t.vrienden = (await db.collection(`vrienden/${uid}/lijst`).get()).size;
  await db.recursiveDelete(db.doc(`vrienden/${uid}`));
  await db.recursiveDelete(db.doc(`blokkades/${uid}`));
  t.lijstBijAnderen = await weg(db, await db.collectionGroup('lijst').where('uid', '==', uid).get());

  t.verzoeken += await weg(db, await db.collection('vriendverzoeken').where('van', '==', uid).get());
  t.verzoeken += await weg(db, await db.collection('vriendverzoeken').where('naar', '==', uid).get());
  t.links = await weg(db, await db.collection('uitnodigingslinks').where('uid', '==', uid).get());

  // Berichten: de eigen inbox, en wat uid aan anderen stuurde.
  await db.recursiveDelete(db.doc(`inbox/${uid}`));
  t.berichtenVanMij = await weg(db, await db.collectionGroup('berichten').where('van', '==', uid).get());

  await db.recursiveDelete(db.doc(`gedeeld/${uid}`));

  // Zoekindex en voorkeuren.
  const lid = await db.doc(`naamIndexLid/${uid}`).get();
  if (lid.exists && lid.data().sleutel) await db.doc(`naamIndex/${lid.data().sleutel}/vermeldingen/${uid}`).delete();
  await db.doc(`naamIndexLid/${uid}`).delete();
  await db.doc(`naamvoorkeur/${uid}`).delete();
  await db.doc(`mailvoorkeur/${uid}`).delete();

  // Gebruikersnaam (alle die naar uid wijzen) en profiel.
  t.gebruikersnamen = await weg(db, await db.collection('usernames').where('uid', '==', uid).get());
  await db.doc(`profielen/${uid}`).delete();
  await db.recursiveDelete(db.doc(`users/${uid}`));

  // Tellers (uid als sleutel, geen naam): mail, zoeken, deze functie.
  for (const [col, velden] of [['mailTellers', ['afzender', 'ontvanger']], ['zoekTellers', ['per']], ['verwijderTellers', ['per']]]) {
    for (const d of (await db.collection(col).get()).docs) {
      const data = d.data();
      // Oude pogingentellers (ouder dan een week) gaan helemaal weg.
      if (col === 'verwijderTellers' && data.dag < amsterdamDatum(nu - 7 * 24 * 3600 * 1000)) {
        await d.ref.delete();
        continue;
      }
      const raak = velden.filter((v) => data[v] && uid in data[v]);
      if (!raak.length) continue;
      await d.ref.update(Object.fromEntries(raak.map((v) => [`${v}.${uid}`, FieldValue.delete()])));
      t.tellers++;
    }
  }

  // Tot slot de inlog.
  try {
    await auth.deleteUser(uid);
  } catch (err) {
    if (err?.code !== 'auth/user-not-found') throw err;
  }
  return t;
}
