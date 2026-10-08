// Eenmalig: alle bestaande profielen in de zoekindex voor "zoeken op naam"
// (okt 2026), los van het openen van de app. Zie vulNaamIndex in
// ../naamzoeken.js. Admin SDK met je eigen Google-login (Application Default
// Credentials). Zonder --echt een proefrun: alleen tellen, niets schrijven.
// Schrijft of logt nooit namen of e-mailadressen, alleen aantallen.
//
//   gcloud auth application-default login
//   node functions/scripts/naamindex-vullen.js          # proef
//   node functions/scripts/naamindex-vullen.js --echt   # schrijven
//
// Tegen de emulator (tests): FIRESTORE_EMULATOR_HOST en GCLOUD_PROJECT zetten.

import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { vulNaamIndex } from '../naamzoeken.js';

const projectId = process.env.FIRESTORE_EMULATOR_HOST ? process.env.GCLOUD_PROJECT ?? 'demo-podiumagenda' : 'de-moeilijkste-keus';
const echt = process.argv.includes('--echt');
initializeApp({ projectId });
const telling = await vulNaamIndex({ db: getFirestore(), proef: !echt });
console.log(`${echt ? 'Klaar' : 'Proef (niets geschreven; draai met --echt)'} — project ${projectId}:`);
console.log(JSON.stringify(telling, null, 2));
