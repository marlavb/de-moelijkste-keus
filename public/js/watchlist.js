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
// maker en genre (optioneel, sinds okt 2026): voor het eenvoudige scherm van
// een item dat niet meer in de agenda staat. Bij het toevoegen meteen,
// daarna aangevuld zolang de voorstelling in de agenda staat
// (vulWatchlistAan). Geen handeling: tijdstempels blijven gelijk, en bij
// samenvoegen vult een kopie die ze heeft de andere aan. Ze tellen niet mee
// voor de sleutel.

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
//   4 (30 sep 2026): titels werden "Voorstelling – Artiest". De ruisregels
//     die alleen aan het eind van de titel werkten ("- reprise", "try-out",
//     een losse leeftijd "12+") werken nu per deel, zodat "Lemming - reprise
//     – Merijn Scholten" dezelfde sleutel heeft als "Merijn Scholten –
//     Lemming - reprise". Voor alle toenmalige titels veranderde de sleutel
//     niet; wel voor titels met zo'n toevoeging midden in de titel.
export const NORMALISATIE_VERSIE = 4;

// Scheidingstekens tussen delen van een titel ("Artiest – Voorstelling"):
// een streepje of pijp mét spaties eromheen, of een dubbele punt met een
// spatie erna. Streepjes in een woord ("Try-(H)outen") splitsen niet.
export const SCHEIDING = /\s+[–—-]\s+|\s+\|\s+|:\s+/;

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

// Ruis over de hele titel, vóór het splitsen ("– De Musical", leeftijden
// tussen haakjes, "&" = "en").
function zonderRuisHeleTitel(titel) {
  return String(titel ?? '')
    .replace(/\s*&\s*/g, ' en ')
    .replace(/\((\s*\d+(?:[.,]\d+)?\s*\+|\s*\d+\s*(?:-|t\/m|tot)\s*\d+\s*(?:jaar|maanden)?|\s*try-?out|\s*reprise|\s*premi[eè]re|\s*nieuw)\s*\)/gi, ' ')
    .replace(/\/\s*\d+\s*\+/g, ' ')
    .replace(/[\s,:–-]+(?:de|the)\s+musical\b/gi, ' ');
}

// Ruis aan het eind van een deel (v4: per deel, niet alleen aan het eind van
// de hele titel): "Keanu Reprise", "Lemming - reprise", "CONTROLE 12+". Een
// deel dat alleen uit zo'n toevoeging bestaat, valt helemaal weg.
function zonderEindRuis(deel) {
  return deel.replace(/(?:^|[\s–-]+)(?:reprise|try-?out)\s*$/i, ' ').replace(/(?:^|\s)\d+\s*\+\s*$/, ' ');
}

/** De genormaliseerde delen van een titel, zonder dubbele, gesorteerd. */
export function titelDelen(titel) {
  const delen = zonderRuisHeleTitel(titel).split(SCHEIDING).map(zonderEindRuis).map(normalizeTitle).filter(Boolean);
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

// Velden op het item die bij samenvoegen worden aangevuld (geen handeling).
const ITEM_INFO = ['maker', 'genre'];

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
  // Maker/genre: een andere kopie van hetzelfde item vult aan.
  for (const b of bronnen) {
    for (const item of b?.watchlist ?? []) {
      const winnaar = toegevoegd.get(item.sleutel);
      for (const v of ITEM_INFO) if (winnaar[v] == null && item[v] != null) winnaar[v] = item[v];
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

export function voegToe(profiel, { titel, theaterId, maker = null, genre = null }, now = Date.now()) {
  const sleutel = watchlistSleutel(titel, theaterId);
  const item = { sleutel, titel, theaterId, toegevoegdOp: now, v: NORMALISATIE_VERSIE };
  if (maker) item.maker = maker;
  if (genre) item.genre = genre;
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
/** Laatste milliseconde van een datum (JJJJ-MM-DD) in UTC+0; ruim genoeg voor een einddatum. */
export const eindeVanDag = (datum) => Date.parse(`${datum}T23:59:59.999Z`);

export function pasTitelMappingToe(profiel, bekend = new Map(), mapping = TITEL_MAPPING) {
  const houden = [];
  const nieuw = [];
  for (const item of profiel?.watchlist ?? []) {
    // Een doel met `tot` geldt alleen voor items die vóór het eind van die dag zijn toegevoegd.
    const doelen = mapping.get(item.sleutel)?.filter((d) => !d.tot || (item.toegevoegdOp ?? 0) <= eindeVanDag(d.tot));
    if (!doelen?.length) {
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
 * Maker en genre per sleutel uit de agenda, voor vulGezienAan (gezien.js) en
 * vulWatchlistAan. Alleen als
 * alle speeldata met een maker (genre) het eens zijn: de nachtelijke run
 * trekt de maker per productie gelijk (makerMeerderheid.js); bij een
 * gelijke stand blijven ze verschillen en vullen we niets aan.
 */
export function infoPerSleutel(shows) {
  const per = new Map();
  for (const s of shows ?? []) {
    const k = watchlistSleutel(s.titel, s.theaterId);
    if (!per.has(k)) per.set(k, { maker: new Set(), genre: new Set() });
    const p = per.get(k);
    if (typeof s.maker === 'string' && s.maker.trim()) p.maker.add(s.maker.trim());
    if (typeof s.genre === 'string' && s.genre.trim()) p.genre.add(s.genre.trim());
  }
  const uit = new Map();
  for (const [k, p] of per) {
    const info = {};
    if (p.maker.size === 1) info.maker = [...p.maker][0];
    if (p.genre.size === 1) info.genre = [...p.genre][0];
    if (info.maker || info.genre) uit.set(k, info);
  }
  return uit;
}

/**
 * Watchlist-items die bij elkaar horen, voor één regel in Profiel. De oude
 * TITEL_MAPPING maakte van één item soms meerdere (bv. "Greg Shapiro" →
 * "Greg Shapiro – King Me" én "… – 250 years of Donald Trump"); die hebben
 * dezelfde toegevoegdOp en hetzelfde theater. Oude favorieten
 * (toegevoegdOp 0) en items zonder theater blijven los. Geeft een lijst
 * groepen (arrays van items), in de volgorde van de eerste.
 */
export function groepeerWatchlist(items) {
  const groepen = new Map();
  for (const item of items ?? []) {
    const k = (item.toegevoegdOp ?? 0) > 0 && item.theaterId ? `${item.toegevoegdOp}|${item.theaterId}` : `s|${item.sleutel}`;
    if (!groepen.has(k)) groepen.set(k, []);
    groepen.get(k).push(item);
  }
  return [...groepen.values()];
}

/**
 * Oude sleutel → nieuwe sleutel uit de data: een voorstelling waarvan de
 * titel is samengevoegd tot één productie (productieSamenvoegen.js) heeft
 * zijn oude titel als titelBron (en een titel uit de aliaslijst zijn titel van
 * daarvoor als titelVoorAlias). Alleen eenduidige doelen, en alleen als de
 * oude sleutel zelf niet meer in de data staat. Geldt ook voor sleutels uit
 * de oude TITEL_MAPPING (die "Greg Shapiro" naar twee sleutels liet gaan).
 */
export function samenvoegMapping(shows) {
  const huidig = new Set();
  const doelen = new Map();
  for (const s of shows ?? []) {
    const nieuw = watchlistSleutel(s.titel, s.theaterId);
    huidig.add(nieuw);
    // titelVoorAlias: de titel vóór de aliaslijst (titels-ronde-2), voor
    // sleutels die al naar de titel van na ronde 1 waren omgezet.
    for (const bron of [s.titelBron, s.titelVoorAlias]) {
      if (!bron) continue;
      const oud = watchlistSleutel(bron, s.theaterId);
      if (oud === nieuw) continue;
      if (!doelen.has(oud)) doelen.set(oud, new Set());
      doelen.get(oud).add(nieuw);
    }
  }
  const mapping = new Map();
  for (const [oud, nieuw] of doelen) if (nieuw.size === 1 && !huidig.has(oud)) mapping.set(oud, [...nieuw][0]);
  return mapping;
}

/**
 * Watchlist-items en tombstones met een oude sleutel naar de samengevoegde
 * sleutel (samenvoegMapping). Zonder dubbelen (voegSamen: de laatste actie
 * wint, ook een verwijdering). Idempotent. Geeft { profiel, gewijzigd }.
 */
export function pasSamenvoegingToe(profiel, mapping) {
  if (!mapping?.size) return { profiel, gewijzigd: false };
  let gewijzigd = false;
  const watchlist = (profiel?.watchlist ?? []).map((i) => {
    const naar = mapping.get(i.sleutel);
    if (!naar) return i;
    gewijzigd = true;
    return { ...i, sleutel: naar };
  });
  const watchlistVerwijderd = (profiel?.watchlistVerwijderd ?? []).map((t) => {
    const naar = mapping.get(t.sleutel);
    if (!naar) return t;
    gewijzigd = true;
    return { ...t, sleutel: naar };
  });
  if (!gewijzigd) return { profiel, gewijzigd };
  return { profiel: voegSamen({ watchlist, watchlistVerwijderd }), gewijzigd };
}

/**
 * Items zonder maker of genre aanvullen uit de agenda (`info`, zie
 * infoPerSleutel). Nooit overschrijven; tijdstempels blijven gelijk;
 * idempotent. Geeft { profiel, gewijzigd }.
 */
export function vulWatchlistAan(profiel, info) {
  let gewijzigd = false;
  const watchlist = (profiel?.watchlist ?? []).map((item) => {
    const live = info?.get(item.sleutel);
    if (!live) return item;
    const extra = {};
    for (const v of ITEM_INFO) if (live[v] && item[v] == null) extra[v] = live[v];
    if (Object.keys(extra).length === 0) return item;
    gewijzigd = true;
    return { ...item, ...extra };
  });
  if (!gewijzigd) return { profiel, gewijzigd };
  return { profiel: { ...profiel, watchlist }, gewijzigd };
}

/**
 * Eén laadronde, voor localStorage én Firestore: oude favorieten omzetten,
 * samenvoegen met wat er al stond (en eventueel een tweede bron, bv. de
 * lokale watchlist bij inloggen), her-normaliseren. `gewijzigd` zegt of het
 * resultaat afwijkt van `opgeslagen`; alleen dan hoeft er geschreven.
 * Idempotent en zonder vlag: een tweede keer laden levert niets nieuws op.
 */
export function laadWatchlist({ opgeslagen, favorieten = [], extra = null, bekend = new Map(), mapping = TITEL_MAPPING, info = null, samenvoeging = null }) {
  const basis = { watchlist: opgeslagen?.watchlist ?? [], watchlistVerwijderd: opgeslagen?.watchlistVerwijderd ?? [] };
  const { profiel: uitFavorieten, log } = migreerFavorieten(favorieten, bekend);
  // Eerst de titelmapping (die werkt op de oude, v2-sleutels), dan de
  // her-normalisatie van wat overblijft.
  const genormaliseerd = pasSamenvoegingToe(
    renormaliseer(pasTitelMappingToe(voegSamen(basis, uitFavorieten, extra ?? leeg()), bekend, mapping)),
    samenvoeging
  ).profiel;
  // Met de agenda erbij: maker en genre aanvullen (voor het eenvoudige scherm).
  const profiel = info ? vulWatchlistAan(genormaliseerd, info).profiel : genormaliseerd;
  return { profiel, log, gewijzigd: !isGelijk(profiel, basis) };
}

export { leeg as legeWatchlist };
