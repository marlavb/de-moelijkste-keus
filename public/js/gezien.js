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
// - bron: 'planning' (automatisch of via "Ben je geweest?") of 'handmatig'.
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

import { watchlistSleutel, NORMALISATIE_VERSIE, verwijder as verwijderVanWatchlist } from './watchlist.js';
import { koppel, haalUitPlanning } from './gepland.js';
import { isVervallen, weergaveTitel } from './weergave.js';

export const legeGezien = () => ({ gezien: [], gezienVerwijderd: [] });

const bezoekSleutel = (b) => `${b.datum}|${b.tijd ?? ''}|${b.theaterId ?? ''}`;

export const BEZOEK_EXTRA = ['theaterNaam', 'stad', 'locatie', 'zaal', 'titel', 'maker', 'genre', 'status', 'url'];

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
 * Is de speeldatum voorbij? Vanaf 00:00 lokale tijd op de dag erna, zodat
 * het ook werkt zonder aanvangstijd en bij avondvoorstellingen.
 */
export function isVoorbij(datum, nu = new Date()) {
  const [j, m, d] = datum.split('-').map(Number);
  return new Date(nu).getTime() >= new Date(j, m - 1, d + 1).getTime();
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
  });
}

/**
 * Eén voorbij plan naar Gezien: bezoek erbij, uit de planning en (als hij
 * erop staat) van de watchlist. `show`: de gekoppelde voorstelling, of null.
 */
export function planNaarGezien({ gepland, gezien, watchlist }, item, show, now = Date.now()) {
  const bron = show ?? { titel: item.titel, theaterId: item.theaterId };
  const nieuwGezien = zetGezien(gezien, { show: bron, bron: 'planning', bezoek: bezoekVan(item, show) }, now);
  const sleutel = watchlistSleutel(bron.titel, bron.theaterId);
  const opWatchlist = (watchlist?.watchlist ?? []).some((i) => i.sleutel === sleutel);
  return {
    gepland: haalUitPlanning(gepland, item.sleutel, now),
    gezien: nieuwGezien,
    watchlist: opWatchlist ? verwijderVanWatchlist(watchlist, sleutel, now) : watchlist,
  };
}

/**
 * Verwerkt voorbije plannen (bij het openen van de app en na een sync):
 * - afgelast → stil uit de planning, nooit naar Gezien;
 * - verplaatst → niets, ook met kaarten: die blijven vaak geldig voor de
 *   nieuwe datum, dus we vragen het (zie vragenOver);
 * - "Kaarten geregeld" → naar Gezien en uit de planning (ook als het plan
 *   "Niet meer in de agenda" of "Tijd gewijzigd" was);
 * - "Gepland" → niets; die komen in "Ben je geweest?" (zie vragenOver).
 * Idempotent: een verwerkt plan staat daarna niet meer in de planning.
 * Geeft { gepland, gezien, watchlist, gewijzigd } terug.
 */
export function verwerkVoorbijePlannen({ gepland, gezien, watchlist }, { index = null, nu = new Date(), now = Date.now() } = {}) {
  let stand = { gepland, gezien, watchlist };
  let gewijzigd = false;
  for (const item of gepland?.gepland ?? []) {
    if (!isVoorbij(item.datum, nu)) continue;
    const { show } = index ? koppel(item, index) : { show: null };
    const reden = vervallenReden(item, show);
    if (reden === 'verplaatst') continue;
    if (reden) {
      stand = { ...stand, gepland: haalUitPlanning(stand.gepland, item.sleutel, now) };
      gewijzigd = true;
    } else if (item.status === 'kaarten') {
      stand = planNaarGezien(stand, item, show, now);
      gewijzigd = true;
    }
  }
  return { ...stand, gewijzigd };
}

/**
 * De vraag "Ben je geweest?": voorbije plannen met status "Gepland", en
 * verplaatste plannen (ook met kaarten), niet afgelaste. Een verplaatst plan
 * krijgt `verplaatst: true` mee, voor het regeltje in Profiel.
 */
export function vragenOver(gepland, { index = null, nu = new Date() } = {}) {
  const uit = [];
  for (const item of gepland?.gepland ?? []) {
    if (!isVoorbij(item.datum, nu)) continue;
    const reden = vervallenReden(item, index ? koppel(item, index).show : null);
    if (reden === 'verplaatst') uit.push({ ...item, verplaatst: true });
    else if (!reden && item.status !== 'kaarten') uit.push(item);
  }
  return uit.sort((a, b) => `${a.datum} ${a.tijd ?? ''}`.localeCompare(`${b.datum} ${b.tijd ?? ''}`));
}

/** Antwoord op "Ben je geweest?": ja → Gezien en uit de planning; nee → alleen uit de planning. */
export function beantwoord(stand, item, ja, { index = null, now = Date.now() } = {}) {
  if (!ja) return { ...stand, gepland: haalUitPlanning(stand.gepland, item.sleutel, now) };
  const { show } = index ? koppel(item, index) : { show: null };
  return planNaarGezien(stand, item, show, now);
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

/** Eén laadronde (localStorage of Firestore, eventueel met de lokale lijst erbij). */
export function laadGezien({ opgeslagen, extra = null }) {
  const basis = { gezien: opgeslagen?.gezien ?? [], gezienVerwijderd: opgeslagen?.gezienVerwijderd ?? [] };
  const profiel = voegGezienSamen(basis, extra ?? legeGezien());
  return { profiel, gewijzigd: JSON.stringify(profiel) !== JSON.stringify(basis) };
}
