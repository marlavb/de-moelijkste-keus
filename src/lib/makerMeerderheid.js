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
//   (hoofdletters, leestekens, "&" = "en"): "Nina van Tongeren / Theater
//   Bellevue" = "Nina van Tongeren / theater bellevue";
// - stemmen tellen per kern: het deel vóór " / ", maar alleen als wat erna
//   staat een gezelschap of producent is en de kern zelf niet (kernMag).
//   Verschillen de varianten van de winnende kern alleen ná " / ", dan wordt
//   de maker de kern: "Nina van Tongeren / Theater Bellevue" en "Nina van
//   Tongeren / Bellevue Producties" → "Nina van Tongeren". Zo lost de kern
//   ook een gelijke stand op. Niet ingekort: een coproductie (een ander deel
//   vóór " / "), "Theater Rotterdam / Glen Faria" (de kern is zelf een
//   gezelschap, en Glen Faria niet), en een winnende kern met maar één
//   variant;
// - de schrijfwijze die de meeste theaters gebruiken (gelijk: hoofdletter
//   vooraan, minste hoofdletters, dan tekenvolgorde, zodat hij niet van
//   nacht tot nacht wisselt);
// - gelijke stand tussen kernen → niets wijzigen (`conflicten`);
// - komt de winnende maker van maar één theater, dan alleen als hij niet
//   verdacht is (verdachtReden: geen cijfers, geen (onder)titel van een
//   andere productie, geen kleine letter vooraan, niet op de nooit-maker-
//   lijst) én bekend is: dezelfde naam is elders in de data ook maker, bij
//   een andere productie. Anders niets wijzigen (`verdacht`).
// Nooit een maker verzinnen of van een andere sleutel overnemen.
// Theatergebonden titels (uitsluitlijst) doen niet mee. De oorspronkelijke
// maker blijft als `makerBron` (alleen als hij anders is, ook als dat null
// was). scrapeRun zet vóór elke run maker terug op makerBron, dus dit is
// idempotent.

import { watchlistSleutel, ruimeTitel, SCHEIDING } from '../../public/js/watchlist.js';
import { normalizeTitle } from '../../public/js/productions.js';
import { isGeenMaker } from './titels.js';

/** Maker zonder schrijfwijze: hoofdletters, leestekens, "&" = "en". */
export function makerSleutel(maker) {
  return normalizeTitle(String(maker ?? '').replace(/\s*&\s*/g, ' en '));
}

// " / " tussen maker en gezelschap; ook zonder spaties ("Thorn de
// Vries/Roeland Fernhout"), maar niet in een afkorting als "a/d".
const KERN_SCHEIDING = /(?<=\S\S)\s*\/\s*(?=\S\S)/;

/** Het deel vóór de eerste " / " (de hele maker als die er niet in staat). */
export function makerKern(maker) {
  return String(maker ?? '').split(KERN_SCHEIDING)[0].trim();
}

// Gelijke telling: zoals de weergavetitel (weergaveMeerderheid.js) eerst
// een hoofdletter vooraan, dan de minste hoofdletters ("Collectief
// Blauwdruk" boven "Collectief BLAUWDRUK"), dan de laagste in tekenvolgorde.
const hoofdletters = (w) => (w.match(/\p{Lu}/gu) ?? []).length;
const beter = (a, b) => {
  const ha = /^\P{Ll}/u.test(a);
  const hb = /^\P{Ll}/u.test(b);
  if (ha !== hb) return ha;
  if (hoofdletters(a) !== hoofdletters(b)) return hoofdletters(a) < hoofdletters(b);
  return a < b;
};

const meesteMetLaagste = (tellingen) => {
  let beste = null;
  for (const [w, n] of tellingen) {
    if (!beste || n > beste.n || (n === beste.n && beter(w, beste.w))) beste = { w, n };
  }
  return beste?.w ?? null;
};

const tel = (map, k) => map.set(k, (map.get(k) ?? 0) + 1);

// Woorden waaraan je een gezelschap of producent herkent (ook midden in een
// woord: "Toneelschuur", "Dansgezelschap", "Productiehuis").
const GEZELSCHAP = /theat|produc|gezelschap|company|compagn|kompagn|toneel|dans|huis\b|stichting|collect|ensemble|orkest|orchestr|opera|ballet|studio|festival/i;

/** Lijkt deze tekst op een gezelschap of producent (alleen aan de woorden)? */
export function lijktOpGezelschap(tekst) {
  return GEZELSCHAP.test(String(tekst ?? ''));
}

/**
 * Mag deze maker tot zijn kern worden ingekort? Alleen als elk deel ná
 * " / " een gezelschap is en de kern zelf niet op een gezelschap lijkt
 * (aan de woorden). `isGezelschap` (voor de delen erna) kan meer weten dan
 * de woorden (zie pasMakerMeerderheidToe).
 */
export function kernMag(maker, isGezelschap = lijktOpGezelschap) {
  const delen = String(maker ?? '').split(KERN_SCHEIDING).map((d) => d.trim());
  if (delen.length < 2) return false;
  return delen.slice(1).every((d) => isGezelschap(d)) && !lijktOpGezelschap(delen[0]);
}

/**
 * Kiest de maker uit de stemmen ([{ theaterId, maker }], één per theater).
 * Geeft { maker, reden, theaters } (theaters = de theaters achter de
 * winnaar), { maker: null, gelijk: true } bij gelijke stand, of null.
 */
export function kiesMaker(stemmen, { isGezelschap = lijktOpGezelschap } = {}) {
  if (stemmen.length === 0) return null;
  // De kern van elke maker die ingekort mag worden. Een variant zonder " / "
  // die na normalisatie gelijk is ("Nina van Tongeren – Theater Bellevue" en
  // "Nina van Tongeren / Theater Bellevue") hoort bij dezelfde kern.
  const kernVan = new Map(); // makerSleutel(maker) → kern
  for (const { maker } of stemmen) {
    if (kernMag(maker, isGezelschap)) kernVan.set(makerSleutel(maker), makerKern(maker));
  }
  const perKern = new Map(); // makerSleutel(kern) → { theaters, volledig: Map(makerSleutel → Map(tekst → n)), kern: Map(tekst → n) }
  for (const { theaterId, maker } of stemmen) {
    const kern = kernVan.get(makerSleutel(maker)) ?? maker.trim();
    const k = makerSleutel(kern);
    if (!perKern.has(k)) perKern.set(k, { theaters: [], volledig: new Map(), kern: new Map() });
    const g = perKern.get(k);
    g.theaters.push(theaterId);
    const v = makerSleutel(maker);
    if (!g.volledig.has(v)) g.volledig.set(v, new Map());
    tel(g.volledig.get(v), maker);
    tel(g.kern, kern);
  }
  const max = Math.max(...[...perKern.values()].map((g) => g.theaters.length));
  const top = [...perKern.values()].filter((g) => g.theaters.length === max);
  if (top.length > 1) return { maker: null, gelijk: true };
  const [g] = top;
  if (g.volledig.size === 1) {
    const [schrijfwijzen] = g.volledig.values();
    return { maker: meesteMetLaagste(schrijfwijzen), reden: perKern.size === 1 ? 'één maker' : 'meerderheid', theaters: g.theaters };
  }
  return { maker: meesteMetLaagste(g.kern), reden: 'kern', theaters: g.theaters };
}

/**
 * (Onder)titels van alle producties: ruime titel → sleutels waar hij titel
 * is. Telt de hele titel en elk deel behalve het laatste (bij "Voorstelling
 * – Artiest" is het laatste deel de artiest, en die mag gewoon maker zijn).
 * Ruim (watchlist.js): zonder "(try-out)", "(reprise)", leeftijd; "&" = "en".
 */
export function titelIndex(shows) {
  const index = new Map();
  const voeg = (tekst, sleutel) => {
    const k = ruimeTitel(tekst);
    if (!k) return;
    if (!index.has(k)) index.set(k, new Set());
    index.get(k).add(sleutel);
  };
  for (const s of shows) {
    const sleutel = watchlistSleutel(s.titel, s.theaterId);
    voeg(s.titel, sleutel);
    const delen = String(s.titel ?? '').split(SCHEIDING);
    for (const d of delen.slice(0, -1)) voeg(d, sleutel);
  }
  return index;
}

/**
 * Waarom een maker van maar één theater verdacht is, of null. `index`:
 * titelIndex(shows); `sleutel`: de productie zelf (haar eigen titel telt niet).
 */
export function verdachtReden(maker, { sleutel = null, index = new Map() } = {}) {
  const m = String(maker ?? '').trim();
  if (/\d/.test(m)) return 'cijfers';
  if (/^\p{Ll}/u.test(m)) return 'kleine letter';
  if (isGeenMaker(m)) return 'nooit-maker-lijst';
  const titelVan = [...(index.get(ruimeTitel(m)) ?? [])].filter((k) => k !== sleutel);
  if (titelVan.length) return `titel van ${titelVan.slice(0, 2).map((k) => `"${k}"`).join(', ')}`;
  return null;
}

/**
 * Past de maker op productieniveau toe. De makers moeten de bronmakers zijn
 * (zonder makerBron). Geeft { shows, gewijzigd } terug. Optioneel (arrays):
 * `beslissingen` per sleutel met een keuze, `conflicten` per sleutel met
 * gelijke stand, `verdacht` per sleutel met een verdachte maker van één
 * theater (die niet is overgenomen).
 */
export function pasMakerMeerderheidToe(shows, { beslissingen = null, conflicten = null, verdacht = null } = {}) {
  const groepen = new Map(); // sleutel → Map(theaterId → Map(maker → aantal))
  const aantal = new Map(); // sleutel → aantal speeldata
  for (const s of shows) {
    const sleutel = watchlistSleutel(s.titel, s.theaterId);
    if (sleutel.includes('::')) continue;
    if (!groepen.has(sleutel)) groepen.set(sleutel, new Map());
    tel(aantal, sleutel);
    const maker = typeof s.maker === 'string' ? s.maker.trim() : '';
    if (!maker) continue;
    const perTheater = groepen.get(sleutel);
    if (!perTheater.has(s.theaterId)) perTheater.set(s.theaterId, new Map());
    tel(perTheater.get(s.theaterId), maker);
  }

  // Bekende makers: elke maker per productie en theater. Een deel ná " / "
  // dat elders in z'n geheel de maker van een andere productie is
  // ("Lloydscompany"), telt ook als gezelschap.
  const makerBij = new Map(); // makerSleutel(maker) → Set(sleutel|theaterId)
  for (const [sleutel, perTheater] of groepen) {
    for (const [theaterId, t] of perTheater) {
      for (const maker of t.keys()) {
        const m = makerSleutel(maker);
        if (!makerBij.has(m)) makerBij.set(m, new Set());
        makerBij.get(m).add(`${sleutel}|${theaterId}`);
      }
    }
  }

  let index = null;
  const gekozen = new Map(); // sleutel → maker
  for (const [sleutel, perTheater] of groepen) {
    const stemmen = [...perTheater].map(([theaterId, t]) => ({ theaterId, maker: meesteMetLaagste(t) }));
    const isGezelschap = (d) => lijktOpGezelschap(d) || [...(makerBij.get(makerSleutel(d)) ?? [])].some((k) => !k.startsWith(`${sleutel}|`));
    const keuze = kiesMaker(stemmen, { isGezelschap });
    if (!keuze) continue;
    if (keuze.gelijk) {
      conflicten?.push({ sleutel, theaters: stemmen });
      continue;
    }
    // Speeldata die al precies deze maker hebben: zijn dat ze allemaal, dan verandert er niets.
    const alGoed = [...perTheater.values()].reduce((n, t) => n + (t.get(keuze.maker) ?? 0), 0);
    if (alGoed === aantal.get(sleutel)) continue;
    if (keuze.theaters.length === 1) {
      index ??= titelIndex(shows);
      const bron = `${sleutel}|${keuze.theaters[0]}`;
      const bekend = [...(makerBij.get(makerSleutel(keuze.maker)) ?? [])].some((k) => k !== bron);
      const reden = verdachtReden(keuze.maker, { sleutel, index }) ?? (bekend ? null : 'onbekend (nergens anders maker)');
      if (reden) {
        verdacht?.push({ sleutel, maker: keuze.maker, theaterId: keuze.theaters[0], reden });
        continue;
      }
    }
    gekozen.set(sleutel, keuze.maker);
    beslissingen?.push({ sleutel, maker: keuze.maker, reden: keuze.reden, bronnen: keuze.theaters, theaters: stemmen });
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
