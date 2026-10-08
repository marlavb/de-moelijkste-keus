// Gezien: de voorstellingen waar je geweest bent (bezoekgeschiedenis). Pure
// functies, gedeeld door de app en de tests.
//
// Datamodel (localStorage en Firestore users/{uid}, zelfde vorm):
//   gezien:           [{ sleutel, titel, sleutelTitel, theaterId, bron,
//                         toegevoegdOp, gewijzigdOp, v,
//                         bezoeken: [{ datum, tijd, theaterId, ...extra }] }]
//   gezienVerwijderd: [{ sleutel, verwijderdOp }]          (tombstones)
// - sleutel: dezelfde als de watchlist (watchlistSleutel, normalisatie v4,
//   met de uitsluitlijst). `titel` is de weergavetitel op dat moment;
//   `sleutelTitel` de titel waar de sleutel van komt, voor een toekomstige
//   her-normalisatie (zoals renormaliseer() in watchlist.js).
// - bron: 'planning' (automatisch na de speeldag) of 'handmatig'. Items uit
//   de oude vraag "Ben je geweest?" (tot okt 2026) hebben ook 'planning'.
//   Een tweede bezoek aan dezelfde voorstelling komt bij `bezoeken`, geen
//   tweede item.
// - Samenvoegen: per sleutel wint de laatste actie (toevoegen of weghalen).
//   Bezoeken van alle kopieën die ná de laatste verwijdering zijn gemaakt,
//   tellen samen (per datum|tijd|theater één keer), zodat twee apparaten die
//   hetzelfde plan verwerken nooit een dubbel bezoek geven.
// - Een bezoek bewaart (sinds 1 okt 2026) alles wat er bekend is, zodat het
//   ook zichtbaar blijft als de voorstelling uit de agenda is: theaterNaam
//   (alleen als terugval; de app toont de actuele naam via theaterId), stad,
//   locatie (externe plek), zaal, titel (weergavetitel), maker, genre,
//   status van het plan (kaarten/gepland) en url. Alleen velden die er
//   zijn; oudere bezoeken hebben alleen datum, tijd en theaterId. Twee
//   kopieën van hetzelfde bezoek vullen elkaar aan.
// - beoordeling (sinds 1 okt 2026): 1 t/m 5 sterren in stappen van 0,5, per
//   voorstelling (niet per bezoek), met beoordeeldOp. Bij samenvoegen wint de
//   kopie met de nieuwste beoordeeldOp; wissen = het veld weg met een nieuwe
//   beoordeeldOp, zodat ook het wissen naar andere apparaten gaat. Wordt het
//   item weggehaald, dan gaat de beoordeling mee.
// - maker en genre op het item (sinds okt 2026): voor items zonder bezoek
//   ("Zelf als gezien aangevinkt …") of met bezoeken zonder maker/genre.
//   Bij het aanvinken meteen, daarna aangevuld zodra de productie in de
//   agenda staat (vulGezienAan). Nooit overschreven: een item of bezoek dat
//   al een maker/genre heeft, houdt die. Geen handeling: tijdstempels blijven
//   gelijk en bij samenvoegen vult een kopie die ze heeft de andere aan.

import { watchlistSleutel, NORMALISATIE_VERSIE, verwijder as verwijderVanWatchlist, infoPerSleutel, eindeVanDag } from './watchlist.js';
import { GEZIEN_MAPPING } from './titelMapping.js';

// infoPerSleutel staat in watchlist.js (ook de watchlist vult ermee aan).
export { infoPerSleutel };
import { koppel, haalUitPlanning } from './gepland.js';
import { isVervallen, weergaveTitel } from './weergave.js';
import { amsterdamDatum } from './plannen.js';

export const legeGezien = () => ({ gezien: [], gezienVerwijderd: [] });

const bezoekSleutel = (b) => `${b.datum}|${b.tijd ?? ''}|${b.theaterId ?? ''}`;

// metWie (stap 4 van vrienden): ['@a', '@b'] uit het gedeelde plan, alleen
// voor jezelf; niet in de kopie voor vrienden (gedeeld.js neemt het niet over).
export const BEZOEK_EXTRA = ['theaterNaam', 'stad', 'locatie', 'zaal', 'titel', 'maker', 'genre', 'status', 'url', 'podiumpas', 'metWie'];

/** Een bezoek met alleen de velden die er zijn (datum, tijd en theaterId altijd). */
function schoonBezoek(b) {
  const uit = { datum: b.datum, tijd: b.tijd ?? null, theaterId: b.theaterId ?? null };
  for (const v of BEZOEK_EXTRA) if (b[v] != null && b[v] !== '') uit[v] = b[v];
  return uit;
}

/** Twee kopieën van hetzelfde bezoek: de velden van de eerste, aangevuld met de tweede. */
function vulAan(a, b) {
  const uit = { ...a };
  for (const v of BEZOEK_EXTRA) if (uit[v] == null && b[v] != null) uit[v] = b[v];
  return uit;
}
// Velden op het item zelf die bij samenvoegen worden aangevuld (geen handeling).
const ITEM_INFO = ['maker', 'genre'];

const laatsteActie = (i) => Math.max(i.toegevoegdOp ?? 0, i.gewijzigdOp ?? 0);

export function voegGezienSamen(...bronnen) {
  const kopieen = new Map();
  const verwijderd = new Map();
  for (const b of bronnen) {
    for (const item of b?.gezien ?? []) {
      if (!kopieen.has(item.sleutel)) kopieen.set(item.sleutel, []);
      kopieen.get(item.sleutel).push(item);
    }
    for (const t of b?.gezienVerwijderd ?? []) {
      if ((t.verwijderdOp ?? 0) > (verwijderd.get(t.sleutel) ?? -1)) verwijderd.set(t.sleutel, t.verwijderdOp ?? 0);
    }
  }
  const gezien = [];
  const gezienVerwijderd = [];
  for (const [sleutel, lijst] of kopieen) {
    const weg = verwijderd.get(sleutel) ?? -1;
    const levend = lijst.filter((i) => (i.toegevoegdOp ?? 0) > weg);
    if (levend.length === 0) continue;
    const basis = levend.reduce((a, b) => (laatsteActie(b) > laatsteActie(a) ? b : a));
    const bezoeken = new Map();
    for (const i of levend) {
      for (const b of i.bezoeken ?? []) {
        const k = bezoekSleutel(b);
        const schoon = schoonBezoek(b);
        bezoeken.set(k, bezoeken.has(k) ? vulAan(bezoeken.get(k), schoon) : schoon);
      }
    }
    // Beoordeling: de kopie met de nieuwste beoordeeldOp (los van de rest).
    const beoordeeld = levend.filter((i) => i.beoordeeldOp != null).reduce((a, b) => (!a || b.beoordeeldOp > a.beoordeeldOp ? b : a), null);
    const { beoordeling: _b, beoordeeldOp: _o, ...rest } = basis;
    for (const v of ITEM_INFO) {
      if (rest[v] == null) {
        const andere = levend.find((i) => i[v] != null);
        if (andere) rest[v] = andere[v];
      }
    }
    gezien.push({
      ...rest,
      toegevoegdOp: Math.max(...levend.map((i) => i.toegevoegdOp ?? 0)),
      bezoeken: [...bezoeken.values()].sort((a, b) => bezoekSleutel(a).localeCompare(bezoekSleutel(b))),
      ...(beoordeeld ? { beoordeeldOp: beoordeeld.beoordeeldOp } : {}),
      ...(beoordeeld && isGeldigeBeoordeling(beoordeeld.beoordeling) ? { beoordeling: beoordeeld.beoordeling } : {}),
    });
  }
  for (const [sleutel, verwijderdOp] of verwijderd) {
    const item = gezien.find((i) => i.sleutel === sleutel);
    if (!item) gezienVerwijderd.push({ sleutel, verwijderdOp });
  }
  gezien.sort((a, b) => a.sleutel.localeCompare(b.sleutel));
  gezienVerwijderd.sort((a, b) => a.sleutel.localeCompare(b.sleutel));
  return { gezien, gezienVerwijderd };
}

/**
 * Zet een voorstelling op Gezien, of voegt een bezoek toe als hij er al op
 * staat. `show`: de voorstelling uit de agenda (of een plan-momentopname met
 * titel en theaterId). `bezoek`: { datum, tijd, theaterId } of null.
 */
export function zetGezien(profiel, { show, bron, bezoek = null }, now = Date.now()) {
  const sleutel = watchlistSleutel(show.titel, show.theaterId);
  const bestaand = (profiel?.gezien ?? []).find((i) => i.sleutel === sleutel);
  const item = bestaand
    ? { ...bestaand, bezoeken: [...(bestaand.bezoeken ?? []), ...(bezoek ? [bezoek] : [])], gewijzigdOp: now }
    : {
        sleutel,
        titel: weergaveTitel(show),
        sleutelTitel: show.titel,
        theaterId: show.theaterId ?? null,
        bron,
        toegevoegdOp: now,
        gewijzigdOp: now,
        v: NORMALISATIE_VERSIE,
        ...(show.maker ? { maker: show.maker } : {}),
        ...(show.genre ? { genre: show.genre } : {}),
        bezoeken: bezoek ? [bezoek] : [],
      };
  return voegGezienSamen(profiel, { gezien: [item], gezienVerwijderd: [] });
}

/** 1 t/m 5 in stappen van 0,5. */
export function isGeldigeBeoordeling(waarde) {
  return typeof waarde === 'number' && Number.isFinite(waarde) && waarde >= 1 && waarde <= 5 && Number.isInteger(waarde * 2);
}

/**
 * Beoordeling zetten (waarde) of wissen (null). Gooit bij een ongeldige
 * waarde (0,5, 5,5, 3,3, …). Alleen voor een item dat op Gezien staat.
 */
export function zetBeoordeling(profiel, sleutel, waarde, now = Date.now()) {
  if (waarde !== null && !isGeldigeBeoordeling(waarde)) throw new Error(`Ongeldige beoordeling: ${waarde}`);
  const item = (profiel?.gezien ?? []).find((i) => i.sleutel === sleutel);
  if (!item) return profiel;
  const { beoordeling: _b, ...zonder } = item;
  const nieuw = waarde === null ? { ...zonder, beoordeeldOp: now } : { ...zonder, beoordeling: waarde, beoordeeldOp: now };
  return voegGezienSamen(profiel, { gezien: [nieuw], gezienVerwijderd: [] });
}

/** "4,5" (met komma), of null. */
export function beoordelingTekst(waarde) {
  return isGeldigeBeoordeling(waarde) ? String(waarde).replace('.', ',') : null;
}

export function haalUitGezien(profiel, sleutel, now = Date.now()) {
  return voegGezienSamen(profiel, { gezien: [], gezienVerwijderd: [{ sleutel, verwijderdOp: now }] });
}

export function gezienSleutels(profiel) {
  return new Set((profiel?.gezien ?? []).map((i) => i.sleutel));
}

/** Filter "Verberg gezien": laat alleen voorstellingen door die niet op Gezien staan. */
export function zonderGezien(shows, sleutels) {
  return shows.filter((s) => !sleutels.has(watchlistSleutel(s.titel, s.theaterId)));
}

/**
 * Is de speeldag voorbij? Vanaf 00:00 in Amsterdam op de dag erna, zodat
 * het ook werkt zonder aanvangstijd, bij avondvoorstellingen en op een
 * toestel in een andere tijdzone.
 */
export function isVoorbij(datum, nu = new Date()) {
  return typeof datum === 'string' && datum < amsterdamDatum(nu);
}

/**
 * Vast moment net na de speeldag (22:00 UTC op de speeldag, dus nooit later
 * dan middernacht in Amsterdam). Een plan dat automatisch naar Gezien gaat,
 * krijgt dit als toegevoegdOp, op elk apparaat hetzelfde. Haal je het item
 * daarna weg, dan is die tombstone altijd nieuwer: een apparaat dat het plan
 * later (met oude gegevens) nog eens verwerkt, zet het niet terug.
 */
export function naSpeeldag(datum) {
  const [j, m, d] = datum.split('-').map(Number);
  return Date.UTC(j, m - 1, d, 22, 0);
}

/** 'afgelast', 'verplaatst' of null: uit het plan zelf, anders uit de agenda. */
function vervallenReden(item, show) {
  if (item.vervallen) return item.vervallen;
  return show != null && isVervallen(show) ? show.beschikbaarheid : null;
}

/**
 * Het bezoek uit de momentopname van het plan, aangevuld met de live
 * voorstelling als die er nog is (die gaat voor bij titel, maker, genre,
 * locatie en zaal; datum, tijd en theater komen altijd uit het plan).
 */
export function bezoekVan(item, show = null) {
  return schoonBezoek({
    datum: item.datum,
    tijd: item.tijd ?? null,
    theaterId: item.theaterId,
    theaterNaam: item.theaterNaam,
    stad: show?.stad ?? item.stad,
    locatie: show?.locatie ?? item.locatie,
    zaal: show?.zaal ?? item.zaal,
    titel: weergaveTitel(show ?? { titel: item.titel, maker: item.maker }),
    maker: show?.maker ?? item.maker,
    genre: show?.genre ?? item.genre,
    status: item.status,
    url: show?.reserverenUrl ?? item.reserverenUrl,
    podiumpas: show ? show.podiumpas === true : item.podiumpas,
    metWie: item.metWie?.length ? [...item.metWie] : null,
  });
}

/** Een bezoek rechtstreeks uit een voorstelling (handmatig, voorbije speeldatum). */
export function bezoekUitShow(show) {
  return schoonBezoek({
    datum: show.datum,
    tijd: show.tijd ?? null,
    theaterId: show.theaterId,
    theaterNaam: show.theaterNaam,
    stad: show.stad,
    locatie: show.locatie,
    zaal: show.zaal,
    titel: weergaveTitel(show),
    maker: show.maker,
    genre: show.genre,
    url: show.reserverenUrl,
    podiumpas: show.podiumpas === true,
  });
}

/**
 * Eén voorbij plan naar Gezien: bezoek erbij, uit de planning en (als hij
 * erop staat) van de watchlist. `show`: de gekoppelde voorstelling, of null.
 * Een nieuw Gezien-item krijgt toegevoegdOp = naSpeeldag (zie daar).
 */
export function planNaarGezien({ gepland, gezien, watchlist }, item, show, now = Date.now()) {
  const bron = show ?? { titel: item.titel, theaterId: item.theaterId };
  const sleutel = watchlistSleutel(bron.titel, bron.theaterId);
  const bestaat = (gezien?.gezien ?? []).some((i) => i.sleutel === sleutel);
  const toegevoegd = bestaat ? now : Math.min(now, naSpeeldag(item.datum));
  const nieuwGezien = zetGezien(gezien, { show: bron, bron: 'planning', bezoek: bezoekVan(item, show) }, toegevoegd);
  const opWatchlist = (watchlist?.watchlist ?? []).some((i) => i.sleutel === sleutel);
  return {
    gepland: haalUitPlanning(gepland, item.sleutel, now),
    gezien: nieuwGezien,
    watchlist: opWatchlist ? verwijderVanWatchlist(watchlist, sleutel, now) : watchlist,
  };
}

/**
 * Handmatig op Gezien zetten (detailscherm, watchlist in Profiel): bezoek
 * erbij als de speeldatum voorbij is, en van de watchlist af als hij erop
 * staat (tombstone; via de gewone opslag ook in Firestore en in de kopie
 * voor vrienden). Geeft { gezien, watchlist, watchItem } terug; watchItem is
 * het weggehaalde item (voor "Ongedaan maken") of null.
 * Alleen bij deze overgang: zet je de voorstelling daarna opnieuw op de
 * watchlist, dan blijft hij staan (zie ruimWatchlistOp).
 */
export function markeerHandmatig({ gezien, watchlist }, show, bezoek = null, now = Date.now()) {
  const sleutel = watchlistSleutel(show.titel, show.theaterId);
  const watchItem = (watchlist?.watchlist ?? []).find((i) => i.sleutel === sleutel) ?? null;
  return {
    gezien: zetGezien(gezien, { show, bron: 'handmatig', bezoek }, now),
    watchlist: watchItem ? verwijderVanWatchlist(watchlist, sleutel, now) : watchlist,
    watchItem,
  };
}

/** Het laatste moment waarop een item op Gezien kwam of een bezoek kreeg. */
export const laatsteGezienMoment = (item) => laatsteActie(item);

/**
 * Opruiming (okt 2026, idempotent, bij elke laadronde): een voorstelling die
 * op Gezien staat, hoort niet ook op de watchlist, tenzij je hem daarna
 * opnieuw op de watchlist hebt gezet (toegevoegdOp later dan het laatste
 * Gezien-moment, om nog eens te gaan). Werkt op de sleutels na het laden,
 * dus ook voor samengevoegde producties (samenvoegMapping, waaronder een
 * titel die alleen de artiest was). Weghalen gaat met een tombstone, zodat
 * het over apparaten heen klopt. Bij elke laadronde in plaats van eenmalig
 * met een vlag: het resultaat is hetzelfde als bij de overgang zelf, en een
 * ander apparaat met een oude watchlist wordt ook rechtgezet.
 * Geeft { watchlist, weg: [sleutels], gewijzigd }.
 */
export function ruimWatchlistOp({ watchlist, gezien }, now = Date.now()) {
  const moment = new Map((gezien?.gezien ?? []).map((i) => [i.sleutel, laatsteGezienMoment(i)]));
  const weg = (watchlist?.watchlist ?? [])
    .filter((i) => moment.has(i.sleutel) && (i.toegevoegdOp ?? 0) <= moment.get(i.sleutel))
    .map((i) => i.sleutel);
  if (weg.length === 0) return { watchlist, weg, gewijzigd: false };
  let uit = watchlist;
  for (const k of weg) uit = verwijderVanWatchlist(uit, k, now);
  return { watchlist: uit, weg, gewijzigd: true };
}

/**
 * Verwerkt voorbije plannen (bij het openen van de app en na een sync), na
 * de speeldag in Amsterdam:
 * - afgelast of verplaatst → stil uit de planning, niet naar Gezien (op die
 *   datum is hij niet gespeeld);
 * - al het andere → naar Gezien en uit de planning: met of zonder kaarten,
 *   gedeeld of niet, ook als het plan "Niet meer in de agenda" of "Tijd
 *   gewijzigd" was. Ook plannen die vroeger op "Ben je geweest?" wachtten.
 * Idempotent: een verwerkt plan staat daarna niet meer in de planning.
 * Geeft { gepland, gezien, watchlist, gewijzigd } terug.
 */
export function verwerkVoorbijePlannen({ gepland, gezien, watchlist }, { index = null, nu = new Date(), now = Date.now() } = {}) {
  let stand = { gepland, gezien, watchlist };
  let gewijzigd = false;
  for (const item of gepland?.gepland ?? []) {
    if (!isVoorbij(item.datum, nu)) continue;
    const { show } = index ? koppel(item, index) : { show: null };
    stand = vervallenReden(item, show)
      ? { ...stand, gepland: haalUitPlanning(stand.gepland, item.sleutel, now) }
      : planNaarGezien(stand, item, show, now);
    gewijzigd = true;
  }
  return { ...stand, gewijzigd };
}

/** Laatste bezoek (datum, tijd), of null. */
export function laatsteBezoek(item) {
  const b = [...(item.bezoeken ?? [])].sort((x, y) => bezoekSleutel(y).localeCompare(bezoekSleutel(x)));
  return b[0] ?? null;
}

/** Nieuwste eerst: op laatste bezoekdatum; zonder bezoek op toegevoegdOp. */
export function sorteerGezien(items) {
  const moment = (i) => {
    const b = laatsteBezoek(i);
    if (!b) return i.toegevoegdOp ?? 0;
    const [j, m, d] = b.datum.split('-').map(Number);
    const [u, min] = (b.tijd ?? '00:00').split(':').map(Number);
    return new Date(j, m - 1, d, u, min).getTime();
  };
  return [...items].sort((a, b) => moment(b) - moment(a));
}

/** Heeft het item (of een van zijn bezoeken) dit veld al? */
const heeft = (item, v) => item[v] != null || (item.bezoeken ?? []).some((b) => b[v] != null);

/**
 * Items zonder maker of genre aanvullen uit de agenda (`info`: Map sleutel →
 * { maker?, genre? }, zie infoPerSleutel). Nooit overschrijven; tijdstempels
 * blijven gelijk; idempotent. Geeft { profiel, gewijzigd }.
 */
export function vulGezienAan(profiel, info) {
  let gewijzigd = false;
  const gezien = (profiel?.gezien ?? []).map((item) => {
    const live = info?.get(item.sleutel);
    if (!live) return item;
    const extra = {};
    for (const v of ITEM_INFO) if (live[v] && !heeft(item, v)) extra[v] = live[v];
    if (Object.keys(extra).length === 0) return item;
    gewijzigd = true;
    return { ...item, ...extra };
  });
  if (!gewijzigd) return { profiel, gewijzigd };
  return { profiel: { ...profiel, gezien }, gewijzigd };
}

/** Maker of genre van een item: het nieuwste bezoek dat hem weet, anders het item zelf. */
export function gezienVeld(item, veld) {
  const nieuwste = [...(item?.bezoeken ?? [])].sort((a, b) => `${b.datum} ${b.tijd ?? ''}`.localeCompare(`${a.datum} ${a.tijd ?? ''}`));
  return nieuwste.find((b) => b[veld])?.[veld] ?? item?.[veld] ?? null;
}

/**
 * Gezien-items naar een nieuwe sleutel als de titel bij de bron veranderd is
 * (GEZIEN_MAPPING in titelMapping.js: alleen eenduidige, gedateerde regels).
 * Alleen als de oude sleutel niet meer in de agenda staat (`bekend`) en het
 * item van vóór de einddatum is (laatste bezoek, anders toegevoegdOp). Het
 * item houdt zijn tijdstempels, bezoeken en beoordeling; staat de nieuwe
 * sleutel er al, dan voegen ze samen. Idempotent.
 */
export function pasGezienMappingToe(profiel, bekend = new Map(), mapping = GEZIEN_MAPPING) {
  let gewijzigd = false;
  const gezien = (profiel?.gezien ?? []).map((item) => {
    const doelen = mapping.get(item.sleutel);
    if (!doelen || doelen.length !== 1 || bekend.has(item.sleutel)) return item;
    const [doel] = doelen;
    const laatste = laatsteBezoek(item)?.datum;
    const vanVoor = laatste ? laatste <= doel.tot : (item.toegevoegdOp ?? 0) <= eindeVanDag(doel.tot);
    if (doel.tot && !vanVoor) return item;
    gewijzigd = true;
    return { ...item, sleutel: doel.sleutel, sleutelTitel: doel.titel, titel: doel.weergave ?? doel.titel };
  });
  if (!gewijzigd) return { profiel, gewijzigd };
  return { profiel: voegGezienSamen({ gezien, gezienVerwijderd: profiel?.gezienVerwijderd ?? [] }), gewijzigd };
}

/**
 * Gezien-items en tombstones met een oude productiesleutel naar de
 * samengevoegde sleutel (samenvoegMapping in watchlist.js). Bezoeken en
 * sterren gaan mee; staat de nieuwe sleutel er al, dan voegen ze samen.
 * Idempotent. Geeft { profiel, gewijzigd }.
 */
export function pasGezienSamenvoegingToe(profiel, mapping) {
  if (!mapping?.size) return { profiel, gewijzigd: false };
  let gewijzigd = false;
  const gezien = (profiel?.gezien ?? []).map((i) => {
    const naar = mapping.get(i.sleutel);
    if (!naar) return i;
    gewijzigd = true;
    return { ...i, sleutel: naar };
  });
  const gezienVerwijderd = (profiel?.gezienVerwijderd ?? []).map((t) => {
    const naar = mapping.get(t.sleutel);
    if (!naar) return t;
    gewijzigd = true;
    return { ...t, sleutel: naar };
  });
  if (!gewijzigd) return { profiel, gewijzigd };
  return { profiel: voegGezienSamen({ gezien, gezienVerwijderd }), gewijzigd };
}

/**
 * Eén laadronde (localStorage of Firestore, eventueel met de lokale lijst
 * erbij). Met `info` (infoPerSleutel) worden items aangevuld met maker en
 * genre; met `bekend` (bekendeSleutels) gaan items via GEZIEN_MAPPING naar
 * een nieuwe sleutel.
 */
export function laadGezien({ opgeslagen, extra = null, info = null, bekend = null, mapping = GEZIEN_MAPPING, samenvoeging = null }) {
  const basis = { gezien: opgeslagen?.gezien ?? [], gezienVerwijderd: opgeslagen?.gezienVerwijderd ?? [] };
  const samengevoegd = voegGezienSamen(basis, extra ?? legeGezien());
  const gemapt = bekend ? pasGezienMappingToe(samengevoegd, bekend, mapping).profiel : samengevoegd;
  const samen = pasGezienSamenvoegingToe(gemapt, samenvoeging).profiel;
  const profiel = info ? vulGezienAan(samen, info).profiel : samen;
  return { profiel, gewijzigd: JSON.stringify(profiel) !== JSON.stringify(basis) };
}
