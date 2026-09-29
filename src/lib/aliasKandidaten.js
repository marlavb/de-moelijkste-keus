// Kandidaat-aliassen: paren watchlist-sleutels die waarschijnlijk dezelfde
// voorstelling zijn, maar door een spellingsverschil niet samenvallen
// ("Ruud Smulders – Rüdsichtlos" / "– Rüdsichtslos"). Er wordt hier niets
// samengevoegd: de gebruiker vinkt de lijst met de hand af (debug/alias-
// kandidaten.md), en alleen goedgekeurde paren komen in de normalisatie.

import { watchlistSleutel } from '../../public/js/watchlist.js';

export function bewerkingsafstand(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return d[a.length][b.length];
}

const JAARTAL_OF_EDITIE = /\b(?:20\d\d(?:\s*2\d{3})?|\d+\s*(?:e|ste|de)\s+editie|editie)\b/g;
const LIDWOORD = /^(?:de|het|the|een|a)\s+/;
// Toevoegingen aan het eind: "en friends", "live", "derniere", "presenteert",
// of een extra naam ("Jan Beuving en Tom Dicke" / "Jan Beuving").
const TOEVOEGING = /\s+(?:en\s+friends|and\s+friends|live|derniere|reprise|premiere|tournee|jubileum|presenteert|en\s+\S+(?:\s+\S+){0,2})$/;

const zonderSpaties = (s) => s.replace(/\s+/g, '');
const alleenCijfersAnders = (a, b) => a.replace(/\d+/g, '#') === b.replace(/\d+/g, '#');

/**
 * Soort verschil tussen twee (genormaliseerde) delen, of null als ze niet
 * op elkaar lijken. Volgorde van de controles: jaartal/editie, lidwoord,
 * toevoeging, spelling.
 */
export function soortVerschil(a, b) {
  if (a === b) return null;
  const zj = (s) => s.replace(JAARTAL_OF_EDITIE, ' ').replace(/\s+/g, ' ').trim();
  if (zj(a) === zj(b) && zj(a)) return 'jaartal';
  // Alleen andere cijfers (afleveringen, tijden): een andere voorstelling.
  if (alleenCijfersAnders(a, b)) return null;
  if (a.replace(LIDWOORD, '') === b.replace(LIDWOORD, '')) return 'lidwoord';
  const [kort, lang] = a.length <= b.length ? [a, b] : [b, a];
  if (lang.startsWith(`${kort} `) && TOEVOEGING.test(lang) && lang.replace(TOEVOEGING, '') === kort) return 'toevoeging';
  const d = Math.min(bewerkingsafstand(a, b), bewerkingsafstand(zonderSpaties(a), zonderSpaties(b)));
  const grens = Math.max(1, Math.floor(Math.min(a.length, b.length) * 0.2));
  if (d <= Math.min(2, grens) && Math.min(a.length, b.length) >= 5) return 'spelling';
  return null;
}

/**
 * Zoekt kandidaat-paren in de voorstellingen. Alleen sleutels met twee of
 * meer delen (artiest – voorstelling) die op precies één deel na gelijk
 * zijn; theatergebonden sleutels (uitsluitlijst) doen niet mee, net als
 * paren die allebei maar bij hetzelfde ene theater staan (bij één theater
 * zijn het meestal verschillende afleveringen van een reeks).
 * `bekendePaar(a, b)` kan paren overslaan die al beoordeeld zijn.
 */
export function vindKandidaten(shows, { bekendePaar = () => false } = {}) {
  const perSleutel = new Map();
  for (const s of shows) {
    const k = watchlistSleutel(s.titel, s.theaterId);
    if (k.includes('::')) continue;
    if (!perSleutel.has(k)) perSleutel.set(k, { sleutel: k, delen: k.split(' | '), shows: [] });
    perSleutel.get(k).shows.push(s);
  }
  const lijst = [...perSleutel.values()].filter((x) => x.delen.length >= 2);
  const paren = [];
  for (let i = 0; i < lijst.length; i++) {
    for (let j = i + 1; j < lijst.length; j++) {
      const a = lijst[i];
      const b = lijst[j];
      if (a.delen.length !== b.delen.length) continue;
      const alleenA = a.delen.filter((d) => !b.delen.includes(d));
      const alleenB = b.delen.filter((d) => !a.delen.includes(d));
      if (alleenA.length !== 1 || alleenB.length !== 1) continue;
      const soort = soortVerschil(alleenA[0], alleenB[0]);
      if (!soort) continue;
      const theatersA = new Set(a.shows.map((s) => s.theaterId));
      const theatersB = new Set(b.shows.map((s) => s.theaterId));
      if (theatersA.size === 1 && theatersB.size === 1 && [...theatersA][0] === [...theatersB][0]) continue;
      if (bekendePaar(a.sleutel, b.sleutel)) continue;
      paren.push({ soort, a, b, deelA: alleenA[0], deelB: alleenB[0], theatersA, theatersB });
    }
  }
  return paren;
}
