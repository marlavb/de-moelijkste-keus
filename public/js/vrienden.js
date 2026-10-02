// Vriendschappen (vrienden, stap 2, okt 2026): verzoeken, accepteren,
// verbreken, blokkeren en persoonlijke uitnodigingslinks. Zonder imports: de
// Firestore-functies komen als argument `fs` binnen, zodat de app (CDN) en de
// rules-tests (npm, emulator) dezelfde code gebruiken. firestore.rules
// dwingt alles hieronder ook af; de controles hier geven alleen nette
// meldingen.
//
// Datamodel:
//   vriendverzoeken/{van}_{naar}:  { van, naar, vanGebruikersnaam, vanNaam,
//                                    naarGebruikersnaam, naarNaam, aangemaaktOp }
//     (namen als momentopname: de ontvanger is nog geen vriend en kan het
//     profiel van de afzender niet lezen)
//   vrienden/{eigenaar}/lijst/{vriend}: { uid, sinds, via: 'verzoek'|'link', token? }
//     (één document per richting, altijd samen; de actuele naam komt uit
//     profielen/{vriend})
//   uitnodigingslinks/{token}:     { uid, gebruikersnaam, naam, aangemaaktOp }
//     (eenmalig; 7 dagen geldig vanaf aangemaaktOp, de servertijd)
//   blokkades/{uid}/lijst/{ander}: { uid, gebruikersnaam, naam, sinds }
//
// `fs` = { doc, getDoc, getDocs, setDoc, deleteDoc, writeBatch, collection,
//          query, where, serverTimestamp, getCountFromServer }.

import { controleerGebruikersnaam } from './profiel.js';

export const LINK_GELDIG_DAGEN = 7;
const LINK_GELDIG_MS = LINK_GELDIG_DAGEN * 24 * 60 * 60 * 1000;
const TOKEN_BYTES = 24; // 192 bits, base64url = 32 tekens

export class VriendFout extends Error {
  constructor(code, bericht) {
    super(bericht);
    this.code = code;
  }
}

// Eén tekst voor alles wat de rules weigeren bij een verzoek of link
// (o.a. een blokkade door de ander): niet af te leiden waarom.
export const NIET_MOGELIJK = 'Verzoek kan niet worden verstuurd.';

export const verzoekId = (van, naar) => `${van}_${naar}`;

/** Onvoorspelbaar token: TOKEN_BYTES uit crypto.getRandomValues, base64url. */
export function maakToken(crypto = globalThis.crypto) {
  const bytes = new Uint8Array(TOKEN_BYTES);
  crypto.getRandomValues(bytes);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export const isGeldigToken = (token) => typeof token === 'string' && /^[A-Za-z0-9_-]{32}$/.test(token);

/** Link naar `#/vriend-link/<token>` op dezelfde plek als de app. */
export function linkUrl(token, plek = globalThis.location) {
  return `${plek.origin}${plek.pathname}#/vriend-link/${token}`;
}

const millis = (t) => (typeof t?.toMillis === 'function' ? t.toMillis() : t instanceof Date ? t.getTime() : Number(t));

/** Tot wanneer een link geldig is (ms), uit aangemaaktOp. */
export const linkVerlooptOp = (link) => millis(link.aangemaaktOp) + LINK_GELDIG_MS;
export const isLinkVerlopen = (link, nu = Date.now()) => nu >= linkVerlooptOp(link);

const isGeweigerd = (err) => err?.code === 'permission-denied' || err?.code === 'firestore/permission-denied';

const vriendRef = (fs, db, eigenaar, vriend) => fs.doc(db, 'vrienden', eigenaar, 'lijst', vriend);
const verzoekRef = (fs, db, van, naar) => fs.doc(db, 'vriendverzoeken', verzoekId(van, naar));

// ---------- Zoeken ----------

/**
 * Zoekt een gebruiker op de exacte gebruikersnaam (hoofdletterongevoelig).
 * Geeft { uid, gebruikersnaam, naam } of null; ongeldige invoer → VriendFout('ongeldig').
 */
export async function zoekGebruiker({ db, fs, invoer }) {
  const g = controleerGebruikersnaam(invoer);
  if (!g.ok) throw new VriendFout('ongeldig', 'Vul een volledige gebruikersnaam in.');
  const snap = await fs.getDoc(fs.doc(db, 'usernames', g.laag));
  return snap.exists() ? { uid: snap.data().uid, gebruikersnaam: snap.data().gebruikersnaam, naam: snap.data().naam } : null;
}

// ---------- Verzoeken ----------

/**
 * Stuurt een verzoek aan `ander` ({ uid, gebruikersnaam, naam } uit
 * zoekGebruiker). Heeft de ander jou al een verzoek gestuurd, dan worden jullie
 * meteen vrienden. Geeft 'verstuurd' of 'vrienden'. Fouten: VriendFout met
 * code 'zelf', 'al-vrienden', 'al-verstuurd', 'jij-blokkeert' of
 * 'niet-mogelijk' (geweigerd door de rules, bv. een blokkade door de ander).
 */
export async function stuurVerzoek({ db, fs, ik, mijnProfiel, ander }) {
  if (ander.uid === ik) throw new VriendFout('zelf', 'Dat ben je zelf.');
  const [vriend, terug, heen, blok] = await Promise.all([
    fs.getDoc(vriendRef(fs, db, ik, ander.uid)),
    fs.getDoc(verzoekRef(fs, db, ander.uid, ik)),
    fs.getDoc(verzoekRef(fs, db, ik, ander.uid)),
    fs.getDoc(fs.doc(db, 'blokkades', ik, 'lijst', ander.uid)),
  ]);
  if (vriend.exists()) throw new VriendFout('al-vrienden', `Jullie zijn al vrienden.`);
  if (blok.exists()) throw new VriendFout('jij-blokkeert', `Je hebt @${ander.gebruikersnaam} geblokkeerd. Deblokkeer eerst onder Geblokkeerd.`);
  if (terug.exists()) {
    await accepteer({ db, fs, ik, van: ander.uid });
    return 'vrienden';
  }
  if (heen.exists()) throw new VriendFout('al-verstuurd', 'Je hebt al een verzoek gestuurd.');
  try {
    await fs.setDoc(verzoekRef(fs, db, ik, ander.uid), {
      van: ik,
      naar: ander.uid,
      vanGebruikersnaam: mijnProfiel.gebruikersnaam,
      vanNaam: mijnProfiel.naam,
      naarGebruikersnaam: ander.gebruikersnaam,
      naarNaam: ander.naam,
      aangemaaktOp: fs.serverTimestamp(),
    });
  } catch (err) {
    if (isGeweigerd(err)) throw new VriendFout('niet-mogelijk', NIET_MOGELIJK);
    throw err;
  }
  return 'verstuurd';
}

/** Accepteert het verzoek van `van` aan `ik`: beide richtingen + verzoek weg, in één batch. */
export async function accepteer({ db, fs, ik, van }) {
  const b = fs.writeBatch(db);
  const nu = fs.serverTimestamp();
  b.set(vriendRef(fs, db, ik, van), { uid: van, sinds: nu, via: 'verzoek' });
  b.set(vriendRef(fs, db, van, ik), { uid: ik, sinds: nu, via: 'verzoek' });
  b.delete(verzoekRef(fs, db, van, ik));
  // Ook een eventueel verzoek de andere kant op opruimen.
  b.delete(verzoekRef(fs, db, ik, van));
  try {
    await b.commit();
  } catch (err) {
    if (isGeweigerd(err)) throw new VriendFout('niet-mogelijk', 'Dit verzoek kan niet meer worden geaccepteerd.');
    throw err;
  }
}

/** Weigeren (inkomend) of intrekken (uitgaand). */
export function haalVerzoekWeg({ db, fs, van, naar }) {
  return fs.deleteDoc(verzoekRef(fs, db, van, naar));
}

// ---------- Vriendschap en blokkade ----------

export function verbreek({ db, fs, ik, ander }) {
  const b = fs.writeBatch(db);
  b.delete(vriendRef(fs, db, ik, ander));
  b.delete(vriendRef(fs, db, ander, ik));
  return b.commit();
}

/**
 * Blokkeert `ander` ({ uid, gebruikersnaam, naam }): blokkade vastleggen,
 * vriendschap verbreken en verzoeken in beide richtingen weghalen, in één
 * batch. De ander krijgt geen melding.
 */
export function blokkeer({ db, fs, ik, ander }) {
  const b = fs.writeBatch(db);
  b.set(fs.doc(db, 'blokkades', ik, 'lijst', ander.uid), {
    uid: ander.uid,
    gebruikersnaam: ander.gebruikersnaam,
    naam: ander.naam,
    sinds: fs.serverTimestamp(),
  });
  b.delete(vriendRef(fs, db, ik, ander.uid));
  b.delete(vriendRef(fs, db, ander.uid, ik));
  b.delete(verzoekRef(fs, db, ik, ander.uid));
  b.delete(verzoekRef(fs, db, ander.uid, ik));
  return b.commit();
}

export function deblokkeer({ db, fs, ik, ander }) {
  return fs.deleteDoc(fs.doc(db, 'blokkades', ik, 'lijst', ander));
}

// ---------- Uitnodigingslinks ----------

/** Maakt een nieuwe eenmalige link; geeft { token, url }. */
export async function maakLink({ db, fs, ik, mijnProfiel, crypto, plek }) {
  const token = maakToken(crypto);
  await fs.setDoc(fs.doc(db, 'uitnodigingslinks', token), {
    uid: ik,
    gebruikersnaam: mijnProfiel.gebruikersnaam,
    naam: mijnProfiel.naam,
    aangemaaktOp: fs.serverTimestamp(),
  });
  return { token, url: linkUrl(token, plek) };
}

export function trekLinkIn({ db, fs, token }) {
  return fs.deleteDoc(fs.doc(db, 'uitnodigingslinks', token));
}

/**
 * Wat er met een geopende link kan. Geeft { status, link? }:
 *   'ongeldig'   — onbekend, al gebruikt of ingetrokken (niet te onderscheiden);
 *   'verlopen'   — ouder dan 7 dagen;
 *   'eigen'      — je eigen link;
 *   'vrienden'   — jullie zijn al vrienden;
 *   'jij-blokkeert' — jij hebt de eigenaar geblokkeerd;
 *   'ok'         — "Word vrienden met @Naam?".
 * Een blokkade door de eigenaar zie je hier niet; die geeft bij gebruikLink
 * dezelfde neutrale melding als een ongeldige link.
 */
export async function bekijkLink({ db, fs, ik, token, nu = Date.now() }) {
  if (!isGeldigToken(token)) return { status: 'ongeldig' };
  const snap = await fs.getDoc(fs.doc(db, 'uitnodigingslinks', token));
  if (!snap.exists()) return { status: 'ongeldig' };
  const link = { token, ...snap.data() };
  if (link.uid === ik) return { status: 'eigen', link };
  if (isLinkVerlopen(link, nu)) return { status: 'verlopen', link };
  const [vriend, blok] = await Promise.all([
    fs.getDoc(vriendRef(fs, db, ik, link.uid)),
    fs.getDoc(fs.doc(db, 'blokkades', ik, 'lijst', link.uid)),
  ]);
  if (vriend.exists()) return { status: 'vrienden', link };
  if (blok.exists()) return { status: 'jij-blokkeert', link };
  return { status: 'ok', link };
}

/** Gebruikt de link: beide richtingen + token weg, in één batch. */
export async function gebruikLink({ db, fs, ik, link }) {
  const b = fs.writeBatch(db);
  const nu = fs.serverTimestamp();
  b.set(vriendRef(fs, db, ik, link.uid), { uid: link.uid, sinds: nu, via: 'link', token: link.token });
  b.set(vriendRef(fs, db, link.uid, ik), { uid: ik, sinds: nu, via: 'link', token: link.token });
  b.delete(fs.doc(db, 'uitnodigingslinks', link.token));
  // Openstaande verzoeken tussen jullie zijn dan overbodig.
  b.delete(verzoekRef(fs, db, ik, link.uid));
  b.delete(verzoekRef(fs, db, link.uid, ik));
  try {
    await b.commit();
  } catch (err) {
    if (isGeweigerd(err)) throw new VriendFout('niet-mogelijk', 'Deze link kan niet (meer) worden gebruikt.');
    throw err;
  }
}

// ---------- Laden (bij het openen van het scherm, niet live) ----------

const docsVan = (snap) => snap.docs.map((d) => ({ id: d.id, ...d.data() }));
const opNaam = (a, b) => String(a.gebruikersnaam ?? '').localeCompare(String(b.gebruikersnaam ?? ''), 'nl', { sensitivity: 'base' });

/**
 * Alles voor het Vrienden-scherm. Reads: 5 queries (elk minstens 1 read,
 * anders 1 per document) + 1 per vriend voor het actuele profiel.
 * Geeft { vrienden, inkomend, uitgaand, geblokkeerd, links }.
 */
export async function laadVriendenScherm({ db, fs, ik, nu = Date.now() }) {
  const [lijst, inkomend, uitgaand, geblokkeerd, links] = await Promise.all([
    fs.getDocs(fs.collection(db, 'vrienden', ik, 'lijst')),
    fs.getDocs(fs.query(fs.collection(db, 'vriendverzoeken'), fs.where('naar', '==', ik))),
    fs.getDocs(fs.query(fs.collection(db, 'vriendverzoeken'), fs.where('van', '==', ik))),
    fs.getDocs(fs.collection(db, 'blokkades', ik, 'lijst')),
    fs.getDocs(fs.query(fs.collection(db, 'uitnodigingslinks'), fs.where('uid', '==', ik))),
  ]);
  const vrienden = await Promise.all(
    docsVan(lijst).map(async (v) => {
      try {
        const p = await fs.getDoc(fs.doc(db, 'profielen', v.uid));
        return p.exists() ? { uid: v.uid, gebruikersnaam: p.data().gebruikersnaam, naam: p.data().naam } : { uid: v.uid, onbekend: true };
      } catch {
        return { uid: v.uid, onbekend: true };
      }
    })
  );
  const alleLinks = docsVan(links).map((l) => ({ ...l, token: l.id }));
  return {
    vrienden: vrienden.sort(opNaam),
    inkomend: docsVan(inkomend).map((v) => ({ uid: v.van, gebruikersnaam: v.vanGebruikersnaam, naam: v.vanNaam })).sort(opNaam),
    uitgaand: docsVan(uitgaand).map((v) => ({ uid: v.naar, gebruikersnaam: v.naarGebruikersnaam, naam: v.naarNaam })).sort(opNaam),
    geblokkeerd: docsVan(geblokkeerd).map((g) => ({ uid: g.uid, gebruikersnaam: g.gebruikersnaam, naam: g.naam })).sort(opNaam),
    links: alleLinks.filter((l) => !isLinkVerlopen(l, nu)).sort((a, b) => linkVerlooptOp(a) - linkVerlooptOp(b)),
    verlopenLinks: alleLinks.filter((l) => isLinkVerlopen(l, nu)).map((l) => l.token),
  };
}

/** Aantal openstaande inkomende verzoeken (voor de tegel); 1 read per 1000. */
export async function telInkomend({ db, fs, ik }) {
  const snap = await fs.getCountFromServer(fs.query(fs.collection(db, 'vriendverzoeken'), fs.where('naar', '==', ik)));
  return snap.data().count;
}
