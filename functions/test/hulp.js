// Hulp voor de functions-tests: Admin SDK tegen de emulators (project
// demo-podiumagenda), leegmaken en een kleine wereld klaarzetten.

import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { amsterdamDatum } from '../mail.js';

export const PROJECT = 'demo-podiumagenda';
export const APP_URL = 'https://marlavb.github.io/de-moelijkste-keus/';

export function admin() {
  if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST) {
    throw new Error('Geen emulators: draai deze tests via `npm run test:functions` in de root.');
  }
  if (!getApps().length) initializeApp({ projectId: PROJECT });
  return { db: getFirestore(), auth: getAuth() };
}

export async function wis() {
  const fs = process.env.FIRESTORE_EMULATOR_HOST;
  const au = process.env.FIREBASE_AUTH_EMULATOR_HOST;
  await fetch(`http://${fs}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
  await fetch(`http://${au}/emulator/v1/projects/${PROJECT}/accounts`, { method: 'DELETE' });
}

export const DAG = 24 * 3600 * 1000;
export const toekomst = (dagen = 7) => amsterdamDatum(Date.now() + dagen * DAG);

/** Een gebruiker met profiel en (geverifieerd) adres <uid>@mail.test. */
export async function gebruiker(uid, { geverifieerd = true } = {}) {
  const { db, auth } = admin();
  await auth.createUser({ uid, email: `${uid}@mail.test`, emailVerified: geverifieerd, displayName: uid });
  await db.doc(`profielen/${uid}`).set({ gebruikersnaam: uid, gebruikersnaamLaag: uid, naam: `Naam ${uid}`, aangemaaktOp: Timestamp.now(), gewijzigdOp: Timestamp.now(), v: 1 });
}

export async function vrienden(a, b) {
  const { db } = admin();
  await db.doc(`vrienden/${a}/lijst/${b}`).set({ uid: b, sinds: Timestamp.now(), via: 'verzoek' });
  await db.doc(`vrienden/${b}/lijst/${a}`).set({ uid: a, sinds: Timestamp.now(), via: 'verzoek' });
}

/** Een plan van `eigenaar` met `gast` als uitgenodigd lid. */
export async function plan(planId, eigenaar, gast, { datum = toekomst(), opgeheven = false, voorstelling = {} } = {}) {
  const { db } = admin();
  await db.doc(`plannen/${planId}`).set({
    eigenaar,
    sleutel: `delamar|${datum}|20:15|grip`,
    sleutelV: 4,
    voorstelling: { titel: 'Grip – Rayen Panday', theaterId: 'delamar', theaterNaam: 'DeLaMar', stad: 'Amsterdam', datum, tijd: '20:15', ...voorstelling },
    speeldag: Timestamp.fromMillis(Date.parse(`${datum}T00:00:00Z`)),
    genodigden: [gast],
    opgeheven,
    aangemaaktOp: Timestamp.now(),
    gewijzigdOp: Timestamp.now(),
  });
  await db.doc(`plannen/${planId}/leden/${eigenaar}`).set({ uid: eigenaar, planId, rol: 'organisator', status: 'gaat', uitgenodigdDoor: eigenaar, uitgenodigdOp: Timestamp.now(), kaarten: false });
  await db.doc(`plannen/${planId}/leden/${gast}`).set({ uid: gast, planId, rol: 'gast', status: 'uitgenodigd', uitgenodigdDoor: eigenaar, uitgenodigdOp: Timestamp.now(), kaarten: false });
}

/** Alle documenten (ook in subcollecties) als één lijst [{ pad, data }]. */
export async function alleDocumenten() {
  const { db } = admin();
  const uit = [];
  async function loop(cols) {
    for (const c of cols) {
      const snap = await c.get();
      for (const d of snap.docs) {
        uit.push({ pad: d.ref.path, data: d.data() });
        await loop(await d.ref.listCollections());
      }
    }
  }
  await loop(await db.listCollections());
  return uit;
}
