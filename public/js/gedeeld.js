// Delen met vrienden (stap 3, okt 2026): een uitgeklede kopie van je Gezien
// en je Watchlist die vrienden kunnen lezen, plus de instelling per
// onderdeel. De Firestore-functies komen als argument `fs` binnen (zoals in
// profiel.js en vrienden.js), zodat app en emulator-tests dezelfde code
// gebruiken.
//
// Datamodel:
//   gedeeld/{uid}:                      { gezien: bool, watchlist: bool, gewijzigdOp }
//     (de instelling; bestaat pas na "Oké" of een keuze bij "Aanpassen")
//   gedeeld/{uid}/onderdelen/gezien:    { items, stand, nv, v, bijgewerktOp }
//     items: [{ sleutel, titel, maker?, genre?, beoordeling?, laatsteBezoek?, aantal }]
//   gedeeld/{uid}/onderdelen/watchlist: { items, stand, nv, v, bijgewerktOp }
//     items: [{ sleutel, titel, maker?, genre? }]
// Niet in de kopie: tombstones, tijdstempels per item, bezoekdetails
// (tijd, zaal, theater), Gepland, theaterkeuze, favorieten.
// - stand: de laatste handeling in het onderdeel (ms; ook verwijderingen).
//   De rules weigeren een kopie met een lagere stand dan de opgeslagen: een
//   apparaat dat nog niet gesynchroniseerd is, kan een nieuwere kopie niet
//   overschrijven.
// - nv: NORMALISATIE_VERSIE van de sleutels; de lezer rekent de sleutel
//   opnieuw uit als die afwijkt.
// - Eén document per onderdeel: een vriendenprofiel kost zo een paar reads,
//   niet één per item. De rules kunnen een lijst niet per item controleren;
//   daarom maakt schoonItems() items schoon bij het schrijven én bij het
//   lezen (een vriend met een aangepaste app kan zo alleen ingekorte tekst en
//   geldige sterren laten zien, en via textContent, nooit als HTML).

import { NORMALISATIE_VERSIE } from './watchlist.js';
import { isGeldigeBeoordeling, laatsteBezoek } from './gezien.js';

export const ONDERDELEN = ['gezien', 'watchlist'];
export const MAX_ITEMS = 1000;
export const KOPIE_VERSIE = 1;
export const STANDAARD_INSTELLING = { gezien: true, watchlist: true };
const MAX = { sleutel: 200, titel: 200, maker: 120, genre: 40 };
const DATUM = /^\d{4}-\d{2}-\d{2}$/;

const tekst = (w, max) => (typeof w === 'string' && w.trim() ? w.trim().slice(0, max) : null);

/** Eén item met alleen toegestane velden, ingekort; null als het onbruikbaar is. */
export function schoonItem(item, onderdeel) {
  const sleutel = tekst(item?.sleutel, MAX.sleutel);
  const titel = tekst(item?.titel, MAX.titel);
  if (!sleutel || !titel) return null;
  const uit = { sleutel, titel };
  const maker = tekst(item.maker, MAX.maker);
  const genre = tekst(item.genre, MAX.genre);
  if (maker) uit.maker = maker;
  if (genre) uit.genre = genre;
  if (onderdeel === 'gezien') {
    if (isGeldigeBeoordeling(item.beoordeling)) uit.beoordeling = item.beoordeling;
    if (typeof item.laatsteBezoek === 'string' && DATUM.test(item.laatsteBezoek)) uit.laatsteBezoek = item.laatsteBezoek;
    uit.aantal = Number.isInteger(item.aantal) && item.aantal >= 1 ? Math.min(item.aantal, 999) : 1;
  }
  return uit;
}

export function schoonItems(items, onderdeel) {
  return (Array.isArray(items) ? items : []).map((i) => schoonItem(i, onderdeel)).filter(Boolean).slice(0, MAX_ITEMS);
}

const opSleutel = (a, b) => a.sleutel.localeCompare(b.sleutel);

/**
 * De kopie van de watchlist. `info(sleutel)` geeft de actuele gegevens uit de
 * agenda ({ titel, maker, genre }) of null; anders de bewaarde titel.
 */
export function kopieWatchlist(profiel, info = () => null) {
  const items = (profiel?.watchlist ?? []).map((i) => {
    const live = info(i.sleutel) ?? {};
    return schoonItem({ sleutel: i.sleutel, titel: live.titel ?? i.titel, maker: live.maker, genre: live.genre }, 'watchlist');
  });
  return items.filter(Boolean).sort(opSleutel).slice(0, MAX_ITEMS);
}

/** De kopie van Gezien: per voorstelling laatste bezoek, aantal en sterren. */
export function kopieGezien(profiel, info = () => null) {
  const items = (profiel?.gezien ?? []).map((i) => {
    const live = info(i.sleutel) ?? {};
    const bezoeken = i.bezoeken ?? [];
    const nieuwste = [...bezoeken].sort((a, b) => `${b.datum}`.localeCompare(`${a.datum}`));
    const met = (veld) => nieuwste.find((b) => b[veld])?.[veld];
    return schoonItem(
      {
        sleutel: i.sleutel,
        titel: live.titel ?? i.titel,
        maker: live.maker ?? met('maker'),
        genre: live.genre ?? met('genre'),
        beoordeling: i.beoordeling,
        laatsteBezoek: laatsteBezoek(i)?.datum,
        aantal: bezoeken.length || 1,
      },
      'gezien'
    );
  });
  return items.filter(Boolean).sort(opSleutel).slice(0, MAX_ITEMS);
}

/** De laatste handeling in een onderdeel (ms), inclusief verwijderingen. */
export function standVan(profiel, onderdeel) {
  let stand = 0;
  const neem = (w) => {
    if (Number.isFinite(w) && w > stand) stand = Math.floor(w);
  };
  for (const i of profiel?.[onderdeel] ?? []) {
    neem(i.toegevoegdOp);
    neem(i.gewijzigdOp);
    neem(i.beoordeeldOp);
  }
  for (const t of profiel?.[`${onderdeel}Verwijderd`] ?? []) neem(t.verwijderdOp);
  return stand;
}

/** Gezien van een vriend sorteren: nieuwste bezoek eerst, of hoogste beoordeling eerst. */
export function sorteerKopieGezien(items, opBeoordeling = false) {
  const opBezoek = [...items].sort((a, b) => (b.laatsteBezoek ?? '').localeCompare(a.laatsteBezoek ?? '') || a.titel.localeCompare(b.titel, 'nl'));
  if (!opBeoordeling) return opBezoek;
  return opBezoek.map((item, i) => ({ item, i })).sort((a, b) => (b.item.beoordeling ?? 0) - (a.item.beoordeling ?? 0) || a.i - b.i).map((x) => x.item);
}

export const sorteerKopieWatchlist = (items) => [...items].sort((a, b) => a.titel.localeCompare(b.titel, 'nl'));

// ---------- Firestore ----------

const instellingRef = (fs, db, uid) => fs.doc(db, 'gedeeld', uid);
const kopieRef = (fs, db, uid, onderdeel) => fs.doc(db, 'gedeeld', uid, 'onderdelen', onderdeel);

/** Eigen instelling en kopieën (3 reads, bij inloggen). Instelling null = nog niet gekozen. */
export async function laadEigenDelen({ db, fs, uid }) {
  const [instelling, gezien, watchlist] = await Promise.all([
    fs.getDoc(instellingRef(fs, db, uid)),
    fs.getDoc(kopieRef(fs, db, uid, 'gezien')),
    fs.getDoc(kopieRef(fs, db, uid, 'watchlist')),
  ]);
  return {
    instelling: instelling.exists() ? { gezien: instelling.data().gezien === true, watchlist: instelling.data().watchlist === true } : null,
    kopieen: {
      gezien: gezien.exists() ? gezien.data() : null,
      watchlist: watchlist.exists() ? watchlist.data() : null,
    },
  };
}

function kopieDoc(fs, { items, stand }) {
  return { items, stand, nv: NORMALISATIE_VERSIE, v: KOPIE_VERSIE, bijgewerktOp: fs.serverTimestamp() };
}

/**
 * Instelling opslaan, in één batch met de kopieën: uit → kopie weg; aan →
 * kopie schrijven als die meegegeven is ({ items, stand }), anders volgt
 * die later via schrijfKopie.
 */
export function zetInstelling({ db, fs, uid, instelling, kopieen = {} }) {
  const b = fs.writeBatch(db);
  b.set(instellingRef(fs, db, uid), { gezien: instelling.gezien === true, watchlist: instelling.watchlist === true, gewijzigdOp: fs.serverTimestamp() });
  for (const o of ONDERDELEN) {
    if (!instelling[o]) b.delete(kopieRef(fs, db, uid, o));
    else if (kopieen[o]) b.set(kopieRef(fs, db, uid, o), kopieDoc(fs, kopieen[o]));
  }
  return b.commit();
}

export function schrijfKopie({ db, fs, uid, onderdeel, items, stand }) {
  return fs.setDoc(kopieRef(fs, db, uid, onderdeel), kopieDoc(fs, { items, stand }));
}

const isGeweigerd = (err) => err?.code === 'permission-denied' || err?.code === 'firestore/permission-denied';

/**
 * Profiel van een vriend met wat die deelt. Reads: profiel, instelling en
 * per gedeeld onderdeel de kopie (2–4 documenten, plus de controles in de
 * rules). Per onderdeel: een lijst items (geschoond), [] als er nog niets
 * staat, of null als de vriend het niet deelt. Geen vriend (meer): null.
 */
export async function laadVriendDelen({ db, fs, uid }) {
  let profiel;
  let instelling;
  try {
    [profiel, instelling] = await Promise.all([fs.getDoc(fs.doc(db, 'profielen', uid)), fs.getDoc(instellingRef(fs, db, uid))]);
  } catch (err) {
    if (isGeweigerd(err)) return null;
    throw err;
  }
  if (!profiel.exists()) return null;
  const deelt = instelling.exists() ? instelling.data() : {};
  const uit = { uid, gebruikersnaam: profiel.data().gebruikersnaam, naam: profiel.data().naam, nv: NORMALISATIE_VERSIE };
  await Promise.all(
    ONDERDELEN.map(async (o) => {
      if (deelt[o] !== true) {
        uit[o] = null;
        return;
      }
      try {
        const kopie = await fs.getDoc(kopieRef(fs, db, uid, o));
        uit[o] = kopie.exists() ? schoonItems(kopie.data().items, o) : [];
        if (kopie.exists() && Number.isInteger(kopie.data().nv)) uit[`${o}Nv`] = kopie.data().nv;
      } catch (err) {
        if (!isGeweigerd(err)) throw err;
        uit[o] = null;
      }
    })
  );
  return uit;
}
