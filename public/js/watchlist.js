// Watchlist (vervangt de favorieten): je volgt een *voorstelling*, los van
// theater en speeldatum. Pure functies, gedeeld door de app en de tests.
//
// Datamodel (localStorage en Firestore, zelfde vorm):
//   watchlist:           [{ sleutel, titel, theaterId, toegevoegdOp, v }]
// theaterId is het theater waar het item vandaan komt; nodig om bij een
// nieuwe NORMALISATIE_VERSIE een theatergebonden sleutel te kunnen maken.
//   watchlistVerwijderd: [{ sleutel, verwijderdOp }]      (tombstones)
// Samenvoegen (migratie, inloggen, tweede apparaat): de laatste actie wint.
// Een item staat op de watchlist als toegevoegdOp later is dan verwijderdOp
// (bij gelijke tijd wint de verwijdering).
// Oude favorieten tellen als toegevoegdOp = 0, zodat een bewuste verwijdering
// altijd wint. Het oude `favorites`-veld blijft onaangeroerd (back-up).

import { normalizeTitle, EXCLUDED_NORMALIZED_TITLES } from './productions.js';
import { RENAMED_FAVORITE_KEYS } from './favorites.js';
import { TITEL_MAPPING } from './titelMapping.js';

// Verhoog dit bij ELKE wijziging aan watchlistSleutel/ruimeTitel of de
// uitsluitlijst in productions.js, en laat renormaliseer() de opgeslagen
// items omzetten (zie CLAUDE.md). Items onthouden met welke versie hun
// sleutel is gemaakt.
//   1 (28 sep 2026): eerste versie.
//   2 (28 sep 2026): "blind date" op de uitsluitlijst; items onthouden
//     voortaan altijd het theater waar ze vandaan komen (theaterId).
//   3 (29 sep 2026): titels van cabaretiers worden "Artiest – Voorstelling";
//     de sleutel bestaat uit de delen rond het scheidingsteken, gesorteerd
//     ("sara kroos | prikkelarme kermis"), zodat de volgorde niet uitmaakt;
//     "&" telt als "en".
export const NORMALISATIE_VERSIE = 3;

// Scheidingstekens tussen delen van een titel ("Artiest – Voorstelling"):
// een streepje of pijp mét spaties eromheen, of een dubbele punt met een
// spatie erna. Streepjes in een woord ("Try-(H)outen") splitsen niet.
const SCHEIDING = /\s+[–—-]\s+|\s+\|\s+|:\s+/;

/**
 * Titel zonder de varianten die per theater verschillen: leeftijd ("(6+)",
 * "(3-7 jaar)", "/ 8+", "12+" aan het eind), "(try-out)", "(reprise)", "(première)",
 * "– de musical". Dit gaat over de hele titel, vóór het splitsen, zodat
 * "Juf Braaksel – De Musical (6+)" gewoon "juf braaksel" blijft.
 */
export function zonderRuis(titel) {
  return String(titel ?? '')
    // "Maartje & Kine" = "Maartje en Kine" (v3; normalizeTitle gooit & weg).
    .replace(/\s*&\s*/g, ' en ')
    .replace(/\((\s*\d+(?:[.,]\d+)?\s*\+|\s*\d+\s*(?:-|t\/m|tot)\s*\d+\s*(?:jaar|maanden)?|\s*try-?out|\s*reprise|\s*premi[eè]re|\s*nieuw)\s*\)/gi, ' ')
    .replace(/\/\s*\d+\s*\+/g, ' ')
    .replace(/\s\d+\s*\+\s*$/, ' ')
    .replace(/[\s,:–-]+(?:de|the)\s+musical\b/gi, ' ')
    .replace(/[\s–-]+(?:reprise|try-?out)\s*$/gi, ' ');
}

/** De genormaliseerde delen van een titel, zonder dubbele, gesorteerd. */
export function titelDelen(titel) {
  const delen = zonderRuis(titel).split(SCHEIDING).map(normalizeTitle).filter(Boolean);
  return [...new Set(delen)].sort();
}

/**
 * Ruim genormaliseerde titel: de delen gesorteerd en met " | " verbonden.
 * Een titel uit één deel geeft gewoon de genormaliseerde titel ("sara kroos");
 * "Sara Kroos – Prikkelarme kermis" en "Prikkelarme kermis - Sara Kroos"
 * geven allebei "prikkelarme kermis | sara kroos".
 */
export function ruimeTitel(titel) {
  return titelDelen(titel).join(' | ');
}

/** De watchlist-sleutel; theatergebonden voor titels op de uitsluitlijst. */
export function watchlistSleutel(titel, theaterId) {
  const t = ruimeTitel(titel);
  return EXCLUDED_NORMALIZED_TITLES.has(t) && theaterId ? `${theaterId}::${t}` : t;
}

const leeg = () => ({ watchlist: [], watchlistVerwijderd: [] });

/**
 * Voegt meerdere bronnen samen (elk { watchlist, watchlistVerwijderd }).
 * Per sleutel wint de laatste toevoeging en de laatste verwijdering; het
 * item blijft alleen als de toevoeging later is. Een tombstone blijft alleen
 * bestaan zolang hij wint. Resultaat is gesorteerd, zodat vergelijken werkt.
 */
export function voegSamen(...bronnen) {
  const toegevoegd = new Map();
  const verwijderd = new Map();
  for (const b of bronnen) {
    for (const item of b?.watchlist ?? []) {
      const huidig = toegevoegd.get(item.sleutel);
      const nieuwer = !huidig || (item.toegevoegdOp ?? 0) > (huidig.toegevoegdOp ?? 0);
      // Bij gelijke tijd: liever het item dat zijn theater kent (v1 kende dat nog niet altijd).
      const beter = huidig && (item.toegevoegdOp ?? 0) === (huidig.toegevoegdOp ?? 0) && !huidig.theaterId && item.theaterId;
      if (nieuwer || beter) toegevoegd.set(item.sleutel, { ...item });
    }
    for (const t of b?.watchlistVerwijderd ?? []) {
      if ((t.verwijderdOp ?? 0) > (verwijderd.get(t.sleutel) ?? -1)) verwijderd.set(t.sleutel, t.verwijderdOp ?? 0);
    }
  }
  const watchlist = [];
  const watchlistVerwijderd = [];
  for (const [sleutel, item] of toegevoegd) {
    const weg = verwijderd.get(sleutel);
    if (weg === undefined || (item.toegevoegdOp ?? 0) > weg) watchlist.push(item);
  }
  for (const [sleutel, verwijderdOp] of verwijderd) {
    const item = toegevoegd.get(sleutel);
    if (!item || (item.toegevoegdOp ?? 0) <= verwijderdOp) watchlistVerwijderd.push({ sleutel, verwijderdOp });
  }
  watchlist.sort((a, b) => a.sleutel.localeCompare(b.sleutel));
  watchlistVerwijderd.sort((a, b) => a.sleutel.localeCompare(b.sleutel));
  return { watchlist, watchlistVerwijderd };
}

export function isGelijk(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function voegToe(profiel, { titel, theaterId }, now = Date.now()) {
  const sleutel = watchlistSleutel(titel, theaterId);
  const item = { sleutel, titel, theaterId, toegevoegdOp: now, v: NORMALISATIE_VERSIE };
  return voegSamen(profiel, { watchlist: [item], watchlistVerwijderd: [] });
}

export function verwijder(profiel, sleutel, now = Date.now()) {
  return voegSamen(profiel, { watchlist: [], watchlistVerwijderd: [{ sleutel, verwijderdOp: now }] });
}

/**
 * Zet items met een oudere NORMALISATIE_VERSIE om naar de huidige sleutel,
 * op basis van de opgeslagen weergavetitel en het theater. Idempotent,
 * zonder vlag. Tombstones op een oude sleutel blijven staan (ze raken dan
 * niets meer); een verwijderd item blijft dus verwijderd.
 *
 * Versie 1 → 2: items zonder theaterId konden alleen uit de migratie van
 * favorieten komen (toegevoegdOp 0; in v1 bestond nog geen knop). Wordt hun
 * titel theatergebonden, dan laten we ze vallen: de migratie, die bij elk
 * laden draait, maakt ze opnieuw aan mét theater. Een item zonder theaterId
 * met toegevoegdOp > 0 houdt zijn sleutel (theater onbekend).
 */
export function renormaliseer(profiel) {
  const watchlist = [];
  for (const item of profiel?.watchlist ?? []) {
    if ((item.v ?? 1) >= NORMALISATIE_VERSIE) {
      watchlist.push(item);
      continue;
    }
    const zonderTheater = watchlistSleutel(item.titel);
    const theatergebonden = EXCLUDED_NORMALIZED_TITLES.has(zonderTheater);
    if (theatergebonden && !item.theaterId) {
      if ((item.toegevoegdOp ?? 0) === 0) continue;
      watchlist.push({ ...item, v: NORMALISATIE_VERSIE });
      continue;
    }
    watchlist.push({ ...item, sleutel: watchlistSleutel(item.titel, item.theaterId), v: NORMALISATIE_VERSIE });
  }
  return voegSamen({ watchlist, watchlistVerwijderd: profiel?.watchlistVerwijderd ?? [] });
}

/**
 * Titelconventie cabaretiers (sep 2026, NORMALISATIE_VERSIE 3): titels
 * werden "Artiest – Voorstelling". TITEL_MAPPING (titelMapping.js) zet de
 * oude sleutel om naar de nieuwe, afgeleid uit de data van vóór en na de
 * omzetting. Een oude sleutel met meerdere nieuwe (een artiest met twee
 * voorstellingen) levert ze allemaal op: een bladwijzer te veel is beter dan
 * een stil verdwenen favoriet. Het nieuwe item erft toegevoegdOp, dus een
 * latere verwijdering (tombstone) blijft winnen. Bestaat de oude sleutel nog
 * in de data (een theater zonder voorstellingsnaam), dan blijft het oude item
 * ook staan. Idempotent, zonder vlag.
 */
export function pasTitelMappingToe(profiel, bekend = new Map(), mapping = TITEL_MAPPING) {
  const houden = [];
  const nieuw = [];
  for (const item of profiel?.watchlist ?? []) {
    const doelen = mapping.get(item.sleutel);
    if (!doelen) {
      houden.push(item);
      continue;
    }
    for (const doel of doelen) {
      nieuw.push({
        sleutel: doel.sleutel,
        titel: doel.titel,
        theaterId: doel.theaterId ?? item.theaterId,
        toegevoegdOp: item.toegevoegdOp,
        v: NORMALISATIE_VERSIE,
      });
    }
    if (bekend.has(item.sleutel)) houden.push(item);
  }
  return voegSamen(
    { watchlist: houden, watchlistVerwijderd: profiel?.watchlistVerwijderd ?? [] },
    { watchlist: nieuw, watchlistVerwijderd: [] }
  );
}

// Oude show.id's van vóór 23 aug 2026: theaterId-titelslug-JJJJ-MM-DD-UUMM
// (of -tbd), soms met -2 erachter. Theater-id's bevatten geen streepjes.
const OUDE_SHOW_ID = /^([a-z0-9]+)-(.+)-(\d{4}-\d{2}-\d{2})-(\d{4}|tbd)(?:-\d+)?$/;

/**
 * Zet één oude favoriet om naar een watchlist-item (toegevoegdOp = 0), of
 * null als het formaat onbekend is. `bekend` = Map van sleutel → titel uit
 * de huidige data, om bij een oude slug de juiste variant te kiezen.
 */
export function favorietNaarItem(waarde, bekend = new Map()) {
  const hernoemd = RENAMED_FAVORITE_KEYS.get(waarde) ?? waarde;
  const i = hernoemd.indexOf('::');
  if (i > 0) {
    const theaterId = hernoemd.slice(0, i);
    const titel = hernoemd.slice(i + 2);
    const sleutel = watchlistSleutel(titel, theaterId);
    return { item: { sleutel, titel, theaterId, toegevoegdOp: 0, v: NORMALISATIE_VERSIE }, bron: 'favoriet' };
  }
  const m = hernoemd.match(OUDE_SHOW_ID);
  if (!m) return null;
  const theaterId = m[1];
  const letterlijk = m[2].replace(/-/g, ' ');
  const zonderGetal = letterlijk.replace(/\s+\d+$/, '');
  // Eerst letterlijk, dan zonder achterliggend getal ("-2" bij dubbele
  // slugs) en/of "de musical". De variant die in de data bestaat wint.
  const varianten = [...new Set([
    letterlijk,
    zonderGetal,
    letterlijk.replace(/\s+de musical$/, ''),
    zonderGetal.replace(/\s+de musical$/, ''),
  ])];
  const sleutels = varianten.map((v) => watchlistSleutel(v, theaterId));
  const i2 = sleutels.findIndex((k) => bekend.has(k));
  const sleutel = sleutels[Math.max(i2, 0)];
  const item = { sleutel, titel: bekend.get(sleutel) ?? letterlijk, theaterId, toegevoegdOp: 0, v: NORMALISATIE_VERSIE };
  return { item, bron: 'oude-slug', variant: i2 <= 0 ? 'letterlijk' : varianten[i2] };
}

/** Alle oude favorieten → { profiel, log } (log telt oude slugs voor de console). */
export function migreerFavorieten(favorieten, bekend = new Map()) {
  const watchlist = [];
  const log = { favorieten: 0, oudeSlugs: [], onbekend: [] };
  for (const waarde of favorieten ?? []) {
    const r = favorietNaarItem(waarde, bekend);
    if (!r) {
      log.onbekend.push(waarde);
      continue;
    }
    watchlist.push(r.item);
    if (r.bron === 'oude-slug') log.oudeSlugs.push({ van: waarde, naar: r.item.sleutel, variant: r.variant, inData: bekend.has(r.item.sleutel) });
    else log.favorieten++;
  }
  return { profiel: voegSamen({ watchlist, watchlistVerwijderd: [] }), log };
}

/** Map sleutel → weergavetitel voor alle voorstellingen in de data. */
export function bekendeSleutels(shows) {
  const bekend = new Map();
  for (const s of shows ?? []) {
    const k = watchlistSleutel(s.titel, s.theaterId);
    if (!bekend.has(k)) bekend.set(k, s.titel);
  }
  return bekend;
}

/**
 * Eén laadronde, voor localStorage én Firestore: oude favorieten omzetten,
 * samenvoegen met wat er al stond (en eventueel een tweede bron, bv. de
 * lokale watchlist bij inloggen), her-normaliseren. `gewijzigd` zegt of het
 * resultaat afwijkt van `opgeslagen`; alleen dan hoeft er geschreven.
 * Idempotent en zonder vlag: een tweede keer laden levert niets nieuws op.
 */
export function laadWatchlist({ opgeslagen, favorieten = [], extra = null, bekend = new Map(), mapping = TITEL_MAPPING }) {
  const basis = { watchlist: opgeslagen?.watchlist ?? [], watchlistVerwijderd: opgeslagen?.watchlistVerwijderd ?? [] };
  const { profiel: uitFavorieten, log } = migreerFavorieten(favorieten, bekend);
  // Eerst de titelmapping (die werkt op de oude, v2-sleutels), dan de
  // her-normalisatie van wat overblijft.
  const profiel = renormaliseer(pasTitelMappingToe(voegSamen(basis, uitFavorieten, extra ?? leeg()), bekend, mapping));
  return { profiel, log, gewijzigd: !isGelijk(profiel, basis) };
}

export { leeg as legeWatchlist };
