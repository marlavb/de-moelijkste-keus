// Genre op productieniveau (30 sep 2026), naast de weergavetitel op
// meerderheid (weergaveMeerderheid.js).
//
// Dezelfde voorstelling (zelfde watchlist-sleutel) heeft bij het ene theater
// "Muziektheater" en bij het andere "Overig" of een ander genre, bv. SEXODUS
// bij Kunstlinie en SSU (Muziektheater) en Frascati (Overig). Per sleutel:
// - "Overig" en een leeg genre stemmen niet mee;
// - één echt genre → iedereen krijgt dat;
// - meerdere echte genres → het genre dat de meeste theaters gebruiken (per
//   theater één stem: zijn meest gebruikte echte genre voor die sleutel); bij
//   gelijke stand het specifiekste genre volgens SPECIFIEK_NAAR_BREED;
// - alleen "Overig"/leeg → blijft zo.
// Het oorspronkelijke genre blijft als `genreBron` (alleen als het anders is,
// ook als dat null was). Heeft de sleutel meer dan één echt genre, dan staan
// ze allemaal in `genres`, zodat het filter de voorstelling onder elk genre
// vindt; met één genre valt het filter terug op `genre` (kleiner bestand).
// Theatergebonden titels (uitsluitlijst) doen niet mee. scrapeRun zet vóór
// elke run genre terug op genreBron, dus dit is idempotent.

import { watchlistSleutel } from '../../public/js/watchlist.js';
import { GENRE_CATEGORIES } from './genre.js';

// Tie-break: Familie & Jeugd eerst (het label moet vooral laten zien dat
// iets een kindervoorstelling is; het filter vindt hem toch onder alle
// genres), dan van specifiek naar breed. Toneel en Muziek & Concert zijn de
// brede categorieën waar theaters op terugvallen; Musical is een specifieke
// vorm van muziektheater.
export const SPECIFIEK_NAAR_BREED = ['Familie & Jeugd', 'Musical', 'Cabaret', 'Dans', 'Muziektheater', 'Muziek & Concert', 'Toneel'];

const isEcht = (g) => g != null && g !== 'Overig';
const volgorde = (g) => GENRE_CATEGORIES.indexOf(g);
const specifiek = (g) => {
  const i = SPECIFIEK_NAAR_BREED.indexOf(g);
  return i === -1 ? SPECIFIEK_NAAR_BREED.length : i;
};

/** Meest gebruikte echte genre binnen één theater (gelijk: specifiekste). */
function stemVanTheater(tellingen) {
  let beste = null;
  for (const [g, n] of tellingen) {
    if (!beste || n > beste.n || (n === beste.n && specifiek(g) < specifiek(beste.g))) beste = { g, n };
  }
  return beste?.g ?? null;
}

/**
 * Kiest het weergavegenre uit de stemmen (één echt genre per theater).
 * Geeft { genre, reden } of null (geen echte genres).
 */
export function kiesGenre(stemmen) {
  if (stemmen.length === 0) return null;
  const telling = new Map();
  for (const g of stemmen) telling.set(g, (telling.get(g) ?? 0) + 1);
  if (telling.size === 1) return { genre: stemmen[0], reden: 'één echt genre' };
  const max = Math.max(...telling.values());
  const top = [...telling].filter(([, n]) => n === max).map(([g]) => g);
  if (top.length === 1) return { genre: top[0], reden: 'meerderheid' };
  return { genre: [...top].sort((a, b) => specifiek(a) - specifiek(b))[0], reden: 'gelijk: specifiekste' };
}

/**
 * Past het genre op productieniveau toe. De genres moeten de brongenres zijn
 * (zonder genreBron). Geeft { shows, gewijzigd } terug; met `beslissingen`
 * (array) komt per sleutel met meerdere echte genres de keuze erin.
 */
export function pasGenreMeerderheidToe(shows, { beslissingen = null } = {}) {
  const groepen = new Map();
  for (const s of shows) {
    const sleutel = watchlistSleutel(s.titel, s.theaterId);
    if (sleutel.includes('::')) continue;
    if (!groepen.has(sleutel)) groepen.set(sleutel, new Map());
    if (!isEcht(s.genre)) continue;
    const perTheater = groepen.get(sleutel);
    if (!perTheater.has(s.theaterId)) perTheater.set(s.theaterId, new Map());
    const t = perTheater.get(s.theaterId);
    t.set(s.genre, (t.get(s.genre) ?? 0) + 1);
  }

  const gekozen = new Map(); // sleutel → { genre, genres }
  for (const [sleutel, perTheater] of groepen) {
    const stemmen = [...perTheater.values()].map(stemVanTheater).filter(Boolean);
    const keuze = kiesGenre(stemmen);
    if (!keuze) continue;
    const alle = new Set();
    for (const t of perTheater.values()) for (const g of t.keys()) alle.add(g);
    const genres = [...alle].sort((a, b) => volgorde(a) - volgorde(b));
    gekozen.set(sleutel, { genre: keuze.genre, genres });
    if (beslissingen && alle.size > 1) {
      beslissingen.push({ sleutel, ...keuze, theaters: [...perTheater].map(([theaterId, t]) => ({ theaterId, genre: stemVanTheater(t), genres: [...t.keys()] })) });
    }
  }

  let gewijzigd = 0;
  const uit = shows.map((s) => {
    const keuze = gekozen.get(watchlistSleutel(s.titel, s.theaterId));
    if (!keuze) return s;
    const nieuw = keuze.genres.length > 1 ? { ...s, genres: keuze.genres } : { ...s };
    if (keuze.genre !== s.genre) {
      nieuw.genre = keuze.genre;
      nieuw.genreBron = s.genre ?? null;
      gewijzigd++;
    }
    return nieuw;
  });
  return { shows: uit, gewijzigd };
}
