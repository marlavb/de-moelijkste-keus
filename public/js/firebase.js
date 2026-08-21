// Firebase via CDN (geen build-stap, zelfde aanpak als de rest van de app).
// We gebruiken alleen Auth + Firestore — bewust geen Analytics SDK.
import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.17.1/firebase-app.js';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
} from 'https://www.gstatic.com/firebasejs/12.17.1/firebase-auth.js';
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/12.17.1/firebase-firestore.js';

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

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
export const googleProvider = new GoogleAuthProvider();

export { signInWithPopup, signOut, onAuthStateChanged, doc, getDoc, setDoc, serverTimestamp };
