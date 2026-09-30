// Weergavetitel op meerderheid (aliasronde stap C, 30 sep 2026).
//
// Dezelfde voorstelling heet bij het ene theater "Prikkelarme kermis – Sara
// Kroos", bij het andere "Sara Kroos – Prikkelarme kermis" of "Prikkelarme
// Kermis – Sara Kroos". De watchlist-sleutel is al gelijk; hier krijgen ze
// ook dezelfde weergave: die van de meeste theaters.
//
// - Alleen vormen met precies dezelfde delen tellen als "dezelfde weergave"
//   (volgorde, hoofdletters en scheidingsteken mogen verschillen). Een
//   toevoeging als "(reprise)" of "(try-out)" wordt dus nooit weggestemd.
// - Stemmen: eerst alleen theaters waar de volgorde "Voorstelling – Maker"
//   zeker is (de titelconventie heeft de titel zelf samengesteld, veld
//   volgordeZeker). Geen eenduidige winnaar? Dan alle theaters, en bij gelijke
//   stand: de vorm met de meeste zekere stemmen, dan een vorm die met een
//   hoofdletter begint ("Begrijpt steeds minder" boven "begrijpt steeds
//   minder"), dan de minste hoofdletters (Nederlandse zinsopbouw; "GELUKKIG
//   MAAR" verliest van "Gelukkig maar"), dan de laagste in tekenvolgorde. Zo wisselt een titel niet van nacht
//   tot nacht.
// - Eén theater: niets. Theatergebonden titels (uitsluitlijst) doen niet mee.
// - De oorspronkelijke titel blijft staan als `titelBron` (alleen als hij
//   anders is). Sleutels, ontdubbeling en planning veranderen niet: die zijn
//   volgorde-onafhankelijk (watchlist.js), en scrapeRun zet vóór de
//   ontdubbeling elke titel terug op zijn bron.

import { watchlistSleutel, SCHEIDING } from '../../public/js/watchlist.js';

/** Delen van de titel, zonder volgorde, hoofdletters of scheidingsteken. */
export function vormSleutel(titel) {
  return String(titel ?? '')
    .split(SCHEIDING)
    .map((d) => d.trim().replace(/\s+/g, ' ').toLowerCase())
    .filter(Boolean)
    .sort()
    .join('\u0000');
}

const laagste = (a, b) => (a < b ? a : b);

/** Meest gebruikte titel binnen één theater (gelijke stand: laagste). */
function vormVanTheater(tellingen) {
  let beste = null;
  for (const [titel, n] of tellingen) {
    if (!beste || n > beste.n || (n === beste.n && titel < beste.titel)) beste = { titel, n };
  }
  return beste.titel;
}

function uniekeWinnaar(stemmen) {
  const telling = new Map();
  for (const t of stemmen) telling.set(t, (telling.get(t) ?? 0) + 1);
  const max = Math.max(...telling.values());
  const top = [...telling].filter(([, n]) => n === max).map(([t]) => t);
  return { winnaar: top.length === 1 ? top[0] : null, top, telling };
}

/**
 * Kiest de weergave voor één groep. `theaters`: [{ vorm, zeker }], één per
 * theater. Geeft { titel, reden } terug; reden zegt welke regel besliste
 * (voor het overzicht in debug/).
 */
export function kiesMetReden(theaters) {
  const zeker = theaters.filter((t) => t.zeker).map((t) => t.vorm);
  if (zeker.length > 0) {
    const { winnaar } = uniekeWinnaar(zeker);
    if (winnaar) return { titel: winnaar, reden: 'zekere stemmen' };
  }
  const { winnaar, top } = uniekeWinnaar(theaters.map((t) => t.vorm));
  if (winnaar) return { titel: winnaar, reden: 'meerderheid' };
  const zekerePerVorm = (v) => zeker.filter((z) => z === v).length;
  const hoofdletters = (v) => (v.match(/\p{Lu}/gu) ?? []).length;
  // Eerste teken een hoofdletter? (Begint de titel met een cijfer of
  // leesteken, dan zegt deze regel niets.)
  const begintHoofd = (v) => /^\p{Lu}/u.test(v);
  let reden = 'gelijk: tekenvolgorde';
  const titel = top.reduce((a, b) => {
    const za = zekerePerVorm(a);
    const zb = zekerePerVorm(b);
    if (za !== zb) {
      reden = 'gelijk: meeste zekere stemmen';
      return za > zb ? a : b;
    }
    const ba = begintHoofd(a);
    const bb = begintHoofd(b);
    if (ba !== bb) {
      if (reden === 'gelijk: tekenvolgorde') reden = 'gelijk: begint met hoofdletter';
      return ba ? a : b;
    }
    const ha = hoofdletters(a);
    const hb = hoofdletters(b);
    if (ha !== hb) {
      if (reden === 'gelijk: tekenvolgorde') reden = 'gelijk: minste hoofdletters';
      return ha < hb ? a : b;
    }
    return laagste(a, b);
  });
  return { titel, reden };
}

export function kiesWeergave(theaters) {
  return kiesMetReden(theaters).titel;
}

/**
 * Past de meerderheid toe op alle voorstellingen. De titels moeten de
 * brontitels zijn (zonder titelBron). Geeft { shows, gewijzigd } terug;
 * `gewijzigd` = aantal voorstellingen met een andere titel.
 */
export function pasMeerderheidToe(shows, { beslissingen = null } = {}) {
  const groepen = new Map();
  for (const s of shows) {
    const sleutel = watchlistSleutel(s.titel, s.theaterId);
    if (sleutel.includes('::')) continue;
    const vorm = vormSleutel(s.titel);
    if (!vorm) continue;
    const g = `${sleutel}\u0001${vorm}`;
    if (!groepen.has(g)) groepen.set(g, new Map());
    const perTheater = groepen.get(g);
    if (!perTheater.has(s.theaterId)) perTheater.set(s.theaterId, { tellingen: new Map(), zeker: new Set() });
    const t = perTheater.get(s.theaterId);
    t.tellingen.set(s.titel, (t.tellingen.get(s.titel) ?? 0) + 1);
    if (s.volgordeZeker) t.zeker.add(s.titel);
  }

  const gekozen = new Map(); // groep → titel
  for (const [g, perTheater] of groepen) {
    if (perTheater.size < 2) continue;
    const theaters = [...perTheater].map(([theaterId, t]) => {
      const vorm = vormVanTheater(t.tellingen);
      return { theaterId, vorm, zeker: t.zeker.has(vorm) };
    });
    const { titel, reden } = kiesMetReden(theaters);
    gekozen.set(g, titel);
    beslissingen?.push({ titel, reden, theaters });
  }

  let gewijzigd = 0;
  const uit = shows.map((s) => {
    const sleutel = watchlistSleutel(s.titel, s.theaterId);
    const titel = gekozen.get(`${sleutel}\u0001${vormSleutel(s.titel)}`);
    if (!titel || titel === s.titel) return s;
    gewijzigd++;
    return { ...s, titel, titelBron: s.titel };
  });
  return { shows: uit, gewijzigd };
}
