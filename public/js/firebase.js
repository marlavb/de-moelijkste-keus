// Firebase via CDN (geen build-stap, zelfde aanpak als de rest van de app).
// We gebruiken alleen Auth + Firestore — bewust geen Analytics SDK.
import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.17.1/firebase-app.js';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  connectAuthEmulator,
  signInWithEmailAndPassword,
} from 'https://www.gstatic.com/firebasejs/12.17.1/firebase-auth.js';
import {
  getFirestore,
  doc,
  getDoc,
  getDocs,
  setDoc,
  deleteDoc,
  writeBatch,
  collection,
  query,
  where,
  orderBy,
  onSnapshot,
  getCountFromServer,
  runTransaction,
  serverTimestamp,
  connectFirestoreEmulator,
} from 'https://www.gstatic.com/firebasejs/12.17.1/firebase-firestore.js';
import { gebruikEmulator, EMULATOR_PROJECT, EMULATOR_AUTH, EMULATOR_FIRESTORE } from './emulator.js';

// Deze config-waarden zijn bewust publiek zichtbaar in de broncode — dat is
// normaal voor Firebase-webapps (ze identificeren het project, ze zijn geen
// geheim). De echte toegangscontrole zit in firestore.rules, niet in het
// verbergen van deze waarden.
const firebaseConfig = {
  apiKey: 'AIzaSyCq3xH_WD9qFRsdNsPgwAqBlpVGC1RLKGs',
  authDomain: 'de-moeilijkste-keus.firebaseapp.com',
  projectId: 'de-moeilijkste-keus',
  storageBucket: 'de-moeilijkste-keus.firebasestorage.app',
  messagingSenderId: '836341833360',
  appId: '1:836341833360:web:ac32a365813c316a7d0215',
};

// End-to-end-tests (zie emulator.js): alleen op localhost met ?emulator=1,
// dan het demo-project en de emulators, nooit het echte project.
let sessie = null;
try {
  sessie = window.sessionStorage;
} catch {
  // geen opslag: alleen de URL telt
}
const EMULATOR = gebruikEmulator(window.location, sessie);

const app = initializeApp(
  EMULATOR ? { apiKey: 'demo-sleutel', authDomain: 'localhost', projectId: EMULATOR_PROJECT, appId: 'demo-app' } : firebaseConfig
);

export const auth = getAuth(app);
export const db = getFirestore(app);
export const googleProvider = new GoogleAuthProvider();

if (EMULATOR) {
  connectAuthEmulator(auth, EMULATOR_AUTH, { disableWarnings: true });
  connectFirestoreEmulator(db, EMULATOR_FIRESTORE.host, EMULATOR_FIRESTORE.port);
  // Inloggen zonder Google-popup, alleen voor de tests.
  window.__e2eLogin = (email, wachtwoord) => signInWithEmailAndPassword(auth, email, wachtwoord);
}

export {
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  doc,
  getDoc,
  getDocs,
  setDoc,
  deleteDoc,
  writeBatch,
  collection,
  query,
  where,
  orderBy,
  onSnapshot,
  getCountFromServer,
  runTransaction,
  serverTimestamp,
};
