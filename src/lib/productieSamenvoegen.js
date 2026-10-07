// Productie samenvoegen (okt 2026): dezelfde voorstelling met een langere of
// kortere titel bij verschillende theaters wordt één productie, met één
// watchlist-sleutel. Draait in scrapeRun vóór de weergave op meerderheid;
// de oorspronkelijke titel blijft als `titelBron`. Voorbeeld Greg Shapiro:
//   Stadsgehoorzaal "Greg Shapiro" (beschrijving "KING ME | 250 years of
//   Donald Trump"), Cpunt "KING ME – 250 years of Donald Trump – Greg
//   Shapiro", De Stoep "KING ME – Greg Shapiro" → overal "KING ME – Greg
//   Shapiro".
//
// 1. Titel = artiest (titelUitBeschrijving): de titel is alleen de artiest en
//    de beschrijving begint met "NAAM | ondertitel". Alleen als de artiest
//    elders maker is, NAAM elders een voorstelling van díe artiest is, en de
//    titel elders zelf geen voorstelling is; anders blijft alles staan
//    (niet gokken).
// 2. Samenvoegen binnen dezelfde maker (samenvoegen): de maker is het
//    makerveld, of anders het laatste titeldeel, maar alleen als de volgorde
//    "Voorstelling – Artiest" zeker is (veld volgordeZeker, gezet door de
//    titelconventie). Zonder dat veld doet de titel niet mee: bij Flint staat
//    "Toneelgroep Maastricht – Stichting NOX" juist andersom. Is de voorstelling van de ene productie het
//    begin van die van de andere, gescheiden door " – " of " | " (niet ":"),
//    dan wordt de langere de kortere: titel = het gemeenschappelijke begin
//    (plus de artiest als die in de titel stond). De weggelaten ondertitel
//    gaat naar de beschrijving als die leeg is. Niet bij een generiek begin
//    (GENERIEK) of een begin korter dan 4 tekens; die gevallen komen in
//    `overgeslagen`.
// Vergelijken gebeurt zoals de watchlist-sleutel: zonder hoofdletters,
// leestekens, "(6+)", "reprise", "try-out" (zonderRuis per deel).
// Theatergebonden titels (uitsluitlijst) doen niet mee. Idempotent: na de
// eerste keer zijn de titels gelijk en valt er niets meer samen te voegen.
// Een gewijzigde beschrijving bewaart de oude als `beschrijvingBron`, zodat
// scrapeRun bij teruggevallen data alles terug kan zetten (net als titelBron).

import { watchlistSleutel, zonderRuis } from '../../public/js/watchlist.js';
import { normalizeTitle } from '../../public/js/productions.js';

// Alleen " – " (ook "-" en "—") en " | " met spaties eromheen; geen ":".
const DEEL = /\s+[–—-]\s+|\s+\|\s+/;
const SCHEIDER = ' – ';

// Een begin dat niets zegt over de voorstelling: niet samenvoegen.
export const GENERIEK = /^(?:oudejaars\S*(?: \d{4})?|best of|live|concert|try ?out|premiere|reprise|\d{4}|\d{4} \d{4})$/;

// Zoals de watchlist-sleutel per deel (watchlist.js): ook een deel dat
// alleen "reprise", "try-out" of een leeftijd ("4+") is, valt weg.
const zonderEindRuis = (d) => d.replace(/(?:^|[\s–-]+)(?:reprise|try-?out)\s*$/i, ' ').replace(/(?:^|\s)\d+\s*\+\s*$/, ' ');
const norm = (t) => normalizeTitle(zonderEindRuis(zonderRuis(String(t ?? '').replace(/\s*&\s*/g, ' en '))));

/** Ruwe delen van een titel (alleen " – " en " | "). */
export function titelDelenRuw(titel) {
  return String(titel ?? '').split(DEEL).map((d) => d.trim()).filter(Boolean);
}

/**
 * Voorstelling en maker van een voorstelling: { ruw: [delen], v: [genormaliseerd],
 * maker, makerInTitel }. Maker: het makerveld, of anders het laatste deel van
 * een titel met 2+ delen als de volgorde zeker is (volgordeZeker). Lege genormaliseerde delen ("4+", "reprise") tellen niet.
 */
export function voorstellingEnMaker(show) {
  const delen = titelDelenRuw(show.titel);
  const veld = typeof show.maker === 'string' && show.maker.trim() ? show.maker.trim() : null;
  const makerInTitel = !veld && delen.length >= 2 && show.volgordeZeker === true;
  const ruw = makerInTitel ? delen.slice(0, -1) : delen;
  const maker = veld ?? (makerInTitel ? delen.at(-1) : null);
  return { ruw, v: ruw.map(norm).filter(Boolean), maker, makerInTitel };
}

const sleutelVan = (s) => watchlistSleutel(s.titel, s.theaterId);
const metBron = (s, titel) => ({ ...s, titel, titelBron: s.titelBron ?? s.titel });

/**
 * Punt 1: titel = artiest, voorstelling in de beschrijving ("NAAM | ondertitel").
 * Geeft { shows, gewijzigd: [{ theaterId, voor, na }] }.
 */
export function titelUitBeschrijving(shows) {
  // Per artiest (genormaliseerd): de theaters waar hij maker is en de eerste
  // voorstellingsdelen die hij daar speelt.
  const artiesten = new Map();
  // Titels die elders een voorstelling zijn (eerste deel): die zijn geen artiest.
  const voorstellingBij = new Map();
  for (const s of shows) {
    const { v, maker } = voorstellingEnMaker(s);
    if (v.length) {
      if (!voorstellingBij.has(v[0])) voorstellingBij.set(v[0], new Set());
      voorstellingBij.get(v[0]).add(s.theaterId);
    }
    if (!maker || !v.length) continue;
    const k = norm(maker);
    if (!artiesten.has(k)) artiesten.set(k, { theaters: new Set(), begin: new Set() });
    const a = artiesten.get(k);
    a.theaters.add(s.theaterId);
    a.begin.add(v[0]);
  }
  const gewijzigd = [];
  const uit = shows.map((s) => {
    if (s.maker || titelDelenRuw(s.titel).length !== 1 || sleutelVan(s).includes('::')) return s;
    const m = String(s.beschrijving ?? '').match(/^(.+?)\s+\|\s+(.+)$/);
    if (!m) return s;
    const a = artiesten.get(norm(s.titel));
    const naam = norm(m[1]);
    if (!a || ![...a.theaters].some((t) => t !== s.theaterId) || !a.begin.has(naam)) return s;
    // "The Nether" (DeLaMar) is elders de voorstelling, niet de artiest.
    if ([...(voorstellingBij.get(norm(s.titel)) ?? [])].some((t) => t !== s.theaterId)) return s;
    const titel = `${m[1].trim()}${SCHEIDER}${m[2].trim()}${SCHEIDER}${s.titel.trim()}`;
    gewijzigd.push({ theaterId: s.theaterId, datum: s.datum, voor: s.titel, na: titel });
    // De artiest staat nu zeker achteraan (zoals bij de titelconventie).
    return { ...metBron(s, titel), beschrijving: null, beschrijvingBron: s.beschrijvingBron ?? s.beschrijving ?? null, volgordeZeker: true };
  });
  return { shows: uit, gewijzigd };
}

/**
 * Punt 2: samenvoegen binnen dezelfde maker. Geeft { shows, samengevoegd:
 * [{ maker, naar, van: [{ theaterId, titel }] }], overgeslagen: [{ maker,
 * begin, titels }] }.
 */
export function samenvoegen(shows) {
  // Per maker: de producties (genormaliseerde voorstellingsdelen).
  const perMaker = new Map();
  for (const s of shows) {
    if (sleutelVan(s).includes('::')) continue;
    const { v, maker } = voorstellingEnMaker(s);
    if (!maker || !v.length) continue;
    const mk = norm(maker);
    if (!perMaker.has(mk)) perMaker.set(mk, new Map());
    perMaker.get(mk).set(v.join('\u0000'), v);
  }
  // Per maker en productie: het kortste bestaande begin (als dat mag).
  const doel = new Map(); // `${maker}\u0001${productie}` → lengte van het begin
  const overgeslagen = new Map();
  for (const [mk, producties] of perMaker) {
    const lijst = [...producties.values()];
    for (const b of lijst) {
      const korter = lijst
        .filter((a) => a.length < b.length && a.every((d, i) => d === b[i]))
        .sort((x, y) => x.length - y.length);
      if (!korter.length) continue;
      const a = korter[0];
      const begin = a.join(' ');
      if (GENERIEK.test(begin) || begin.replace(/\s/g, '').length < 4) {
        const k = `${mk}\u0001${begin}`;
        if (!overgeslagen.has(k)) overgeslagen.set(k, { maker: mk, begin, producties: new Set() });
        overgeslagen.get(k).producties.add(b.join(' | '));
        continue;
      }
      doel.set(`${mk}\u0001${b.join('\u0000')}`, a.length);
    }
  }

  const perDoel = new Map();
  const uit = shows.map((s) => {
    if (sleutelVan(s).includes('::')) return s;
    const { ruw, v, maker, makerInTitel } = voorstellingEnMaker(s);
    if (!maker) return s;
    const lengte = doel.get(`${norm(maker)}\u0001${v.join('\u0000')}`);
    if (!lengte) return s;
    // Ruwe delen tot en met het lengte-ste deel dat iets betekent.
    let tel = 0;
    let tot = 0;
    while (tot < ruw.length && tel < lengte) {
      if (norm(ruw[tot])) tel++;
      tot++;
    }
    const houden = ruw.slice(0, tot);
    const weg = ruw.slice(tot).join(SCHEIDER);
    const titel = [...houden, ...(makerInTitel ? [maker] : [])].join(SCHEIDER);
    const k = `${norm(maker)}\u0001${houden.map(norm).filter(Boolean).join(' ')}`;
    if (!perDoel.has(k)) perDoel.set(k, { maker, naar: titel, van: [] });
    perDoel.get(k).van.push({ theaterId: s.theaterId, titel: s.titel });
    const nieuw = metBron(s, titel);
    if (weg && !s.beschrijving) {
      nieuw.beschrijving = weg;
      nieuw.beschrijvingBron = s.beschrijvingBron ?? s.beschrijving ?? null;
    }
    return nieuw;
  });
  // Niet samenvoegen als de speeldatum dan dubbel wordt (zelfde theater, datum,
  // tijd en titel): "Herfstklanken Concert" en "… – Balkon 2" (Aan de Slinger)
  // zijn aparte kaarten op hetzelfde moment. Dan de oorspronkelijke titel.
  const plek = (x) => [x.theaterId, x.datum, x.tijd ?? '', normalizeTitle(x.titel ?? '')].join('|');
  const telling = new Map();
  for (const x of uit) telling.set(plek(x), (telling.get(plek(x)) ?? 0) + 1);
  const botsingen = [];
  const veilig = uit.map((x, i) => {
    if (x === shows[i] || telling.get(plek(x)) < 2) return x;
    botsingen.push({ theaterId: x.theaterId, datum: x.datum, titel: shows[i].titel, naar: x.titel });
    return shows[i];
  });
  for (const d of perDoel.values()) d.van = d.van.filter((v) => !botsingen.some((b) => b.theaterId === v.theaterId && b.titel === v.titel));
  const lijst = [...overgeslagen.values()].map((o) => ({ ...o, producties: [...o.producties] }));
  for (const b of botsingen) lijst.push({ maker: '', begin: b.naar, producties: [`${b.theaterId} ${b.datum}: ${b.titel} (zelfde speeldatum als "${b.naar}")`] });
  return {
    shows: veilig,
    samengevoegd: [...perDoel.values()].filter((d) => d.van.length),
    overgeslagen: lijst,
  };
}

/** Beide stappen achter elkaar (zoals scrapeRun ze draait). */
export function pasProductieSamenvoegingToe(shows) {
  const een = titelUitBeschrijving(shows);
  const twee = samenvoegen(een.shows);
  return { shows: twee.shows, titelUitBeschrijving: een.gewijzigd, samengevoegd: twee.samengevoegd, overgeslagen: twee.overgeslagen };
}
