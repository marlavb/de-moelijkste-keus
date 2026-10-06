// Maker op productieniveau (okt 2026), naast de weergavetitel
// (weergaveMeerderheid.js) en het genre (genreMeerderheid.js).
//
// Dezelfde voorstelling (zelfde watchlist-sleutel) heeft bij het ene theater
// een maker en bij het andere niet, bv. Teckel: Bellevue, Mozaïek, Zaal 3 en
// Bijlmer Parktheater noemen Nina van Tongeren, Stadsschouwburg Utrecht,
// Schuur en Kunstlinie niemand. Per sleutel:
// - een lege maker stemt niet mee;
// - per theater één stem: zijn meest gebruikte maker voor die sleutel;
// - makers tellen als dezelfde als ze na normalisatie gelijk zijn
//   (hoofdletters, leestekens, "/" of "–", "&" = "en"): "Nina van Tongeren /
//   Theater Bellevue" = "Nina van Tongeren – Theater Bellevue";
// - één maker, of een duidelijke meerderheid → iedereen krijgt die (de
//   schrijfwijze die de meeste theaters gebruiken; gelijk: de laagste in
//   tekenvolgorde, zodat hij niet van nacht tot nacht wisselt);
// - gelijke stand tussen verschillende makers → niets wijzigen (met
//   `conflicten` komt hij in het overzicht).
// Nooit een maker verzinnen of van een andere sleutel overnemen.
// Theatergebonden titels (uitsluitlijst) doen niet mee. De oorspronkelijke
// maker blijft als `makerBron` (alleen als hij anders is, ook als dat null
// was). scrapeRun zet vóór elke run maker terug op makerBron, dus dit is
// idempotent.

import { watchlistSleutel } from '../../public/js/watchlist.js';
import { normalizeTitle } from '../../public/js/productions.js';

/** Maker zonder schrijfwijze: hoofdletters, leestekens, "&" = "en". */
export function makerSleutel(maker) {
  return normalizeTitle(String(maker ?? '').replace(/\s*&\s*/g, ' en '));
}

const meesteMetLaagste = (tellingen) => {
  let beste = null;
  for (const [w, n] of tellingen) {
    if (!beste || n > beste.n || (n === beste.n && w < beste.w)) beste = { w, n };
  }
  return beste?.w ?? null;
};

/**
 * Kiest de maker uit de stemmen ([{ theaterId, maker }], één per theater).
 * Geeft { maker, reden } of null (geen stemmen of gelijke stand; bij gelijke
 * stand met `gelijk: true`).
 */
export function kiesMaker(stemmen) {
  if (stemmen.length === 0) return null;
  const perSleutel = new Map(); // makerSleutel → Map(schrijfwijze → aantal)
  for (const { maker } of stemmen) {
    const k = makerSleutel(maker);
    if (!perSleutel.has(k)) perSleutel.set(k, new Map());
    const t = perSleutel.get(k);
    t.set(maker, (t.get(maker) ?? 0) + 1);
  }
  const aantal = (t) => [...t.values()].reduce((a, b) => a + b, 0);
  const max = Math.max(...[...perSleutel.values()].map(aantal));
  const top = [...perSleutel.values()].filter((t) => aantal(t) === max);
  if (top.length > 1) return { maker: null, gelijk: true };
  return { maker: meesteMetLaagste(top[0]), reden: perSleutel.size === 1 ? 'één maker' : 'meerderheid' };
}

/**
 * Past de maker op productieniveau toe. De makers moeten de bronmakers zijn
 * (zonder makerBron). Geeft { shows, gewijzigd } terug. Met `beslissingen`
 * (array) komt per sleutel met een wijziging de keuze erin, met `conflicten`
 * (array) elke sleutel met gelijke stand.
 */
export function pasMakerMeerderheidToe(shows, { beslissingen = null, conflicten = null } = {}) {
  const groepen = new Map(); // sleutel → Map(theaterId → Map(maker → aantal))
  for (const s of shows) {
    const sleutel = watchlistSleutel(s.titel, s.theaterId);
    if (sleutel.includes('::')) continue;
    if (!groepen.has(sleutel)) groepen.set(sleutel, new Map());
    const maker = typeof s.maker === 'string' ? s.maker.trim() : '';
    if (!maker) continue;
    const perTheater = groepen.get(sleutel);
    if (!perTheater.has(s.theaterId)) perTheater.set(s.theaterId, new Map());
    const t = perTheater.get(s.theaterId);
    t.set(maker, (t.get(maker) ?? 0) + 1);
  }

  const gekozen = new Map(); // sleutel → maker
  for (const [sleutel, perTheater] of groepen) {
    const stemmen = [...perTheater].map(([theaterId, t]) => ({ theaterId, maker: meesteMetLaagste(t) }));
    const keuze = kiesMaker(stemmen);
    if (!keuze) continue;
    if (keuze.gelijk) {
      conflicten?.push({ sleutel, theaters: stemmen });
      continue;
    }
    gekozen.set(sleutel, keuze.maker);
    beslissingen?.push({ sleutel, maker: keuze.maker, reden: keuze.reden, theaters: stemmen });
  }

  let gewijzigd = 0;
  const uit = shows.map((s) => {
    const maker = gekozen.get(watchlistSleutel(s.titel, s.theaterId));
    if (!maker || maker === s.maker) return s;
    gewijzigd++;
    return { ...s, maker, makerBron: s.maker ?? null };
  });
  return { shows: uit, gewijzigd };
}
