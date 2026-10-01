// Gepland: één specifieke speeldatum die je wilt bezoeken (of waarvoor je
// al kaarten hebt). Pure functies, gedeeld door de app en de tests.
//
// Datamodel (localStorage en Firestore, zelfde vorm):
//   gepland:           [{ sleutel, titel, theaterId, theaterNaam, stad, datum,
//                         tijd, reserverenUrl, status, toegevoegdOp, gewijzigdOp,
//                         vervallen?, maker?, genre?, locatie?, zaal? }]
//   geplandVerwijderd: [{ sleutel, verwijderdOp }]      (tombstones)
// Het item is een momentopname: verdwijnt of verschuift de voorstelling in
// de agenda, dan blijft het plan staan zoals je het maakte (zie koppel()).
// Samenvoegen: per sleutel wint de laatste actie (plannen, status wisselen
// of uit de planning halen). Voorbije plannen gaan naar Gezien of komen in
// "Ben je geweest?" (zie gezien.js).
// `vervallen` ('afgelast'/'verplaatst', sinds 30 sep 2026): gezet zolang de
// voorstelling nog in de agenda staat (markeerVervallen); na de speeldatum
// is hij uit de data verdwenen en weten we het anders niet meer. Het is geen
// handeling van de gebruiker: bij samenvoegen blijft het staan als één
// kopie het heeft, zonder dat de nieuwste status verloren gaat.
// maker, genre, locatie en zaal (sinds 1 okt 2026): extra gegevens voor het
// bezoek in Gezien (na de speeldatum staat de voorstelling niet meer in de
// data). Bij een nieuw plan meteen; bij oudere plannen aangevuld zolang de
// voorstelling in de agenda staat (vulInfoAan). Ook geen handeling: bij
// samenvoegen vult een kopie die ze heeft de andere aan.

import { ruimeTitel, titelDelen } from './watchlist.js';
import { isVervallen } from './weergave.js';

export const STATUSSEN = ['gepland', 'kaarten'];

/** theaterId|datum|tijd|titel — de titel ruim genormaliseerd (zie watchlist.js). */
export function geplandSleutel(show) {
  return [show.theaterId, show.datum, show.tijd ?? '', ruimeTitel(show.titel)].join('|');
}

const leeg = () => ({ gepland: [], geplandVerwijderd: [] });

export const INFO_VELDEN = ['maker', 'genre', 'locatie', 'zaal'];

/** De extra gegevens van een voorstelling die er zijn (geen lege velden). */
function infoVan(show) {
  const info = {};
  for (const v of INFO_VELDEN) if (show?.[v]) info[v] = show[v];
  return info;
}

export function voegGeplandSamen(...bronnen) {
  const items = new Map();
  const verwijderd = new Map();
  const vervallen = new Map();
  const info = new Map();
  for (const b of bronnen) {
    for (const item of b?.gepland ?? []) {
      const huidig = items.get(item.sleutel);
      if (!huidig || (item.gewijzigdOp ?? 0) > (huidig.gewijzigdOp ?? 0)) items.set(item.sleutel, { ...item });
      if (item.vervallen) vervallen.set(item.sleutel, item.vervallen);
      info.set(item.sleutel, { ...infoVan(item), ...(info.get(item.sleutel) ?? {}) });
    }
    for (const t of b?.geplandVerwijderd ?? []) {
      if ((t.verwijderdOp ?? 0) > (verwijderd.get(t.sleutel) ?? -1)) verwijderd.set(t.sleutel, t.verwijderdOp ?? 0);
    }
  }
  const gepland = [];
  const geplandVerwijderd = [];
  for (const [sleutel, item] of items) {
    const weg = verwijderd.get(sleutel);
    if (vervallen.has(sleutel)) item.vervallen = vervallen.get(sleutel);
    for (const [v, w] of Object.entries(info.get(sleutel) ?? {})) if (!item[v]) item[v] = w;
    if (weg === undefined || (item.gewijzigdOp ?? 0) > weg) gepland.push(item);
  }
  for (const [sleutel, verwijderdOp] of verwijderd) {
    const item = items.get(sleutel);
    if (!item || (item.gewijzigdOp ?? 0) <= verwijderdOp) geplandVerwijderd.push({ sleutel, verwijderdOp });
  }
  gepland.sort((a, b) => a.sleutel.localeCompare(b.sleutel));
  geplandVerwijderd.sort((a, b) => a.sleutel.localeCompare(b.sleutel));
  return { gepland, geplandVerwijderd };
}

export function planIn(profiel, show, now = Date.now()) {
  const item = {
    sleutel: geplandSleutel(show),
    titel: show.titel,
    theaterId: show.theaterId,
    theaterNaam: show.theaterNaam,
    stad: show.stad ?? '',
    datum: show.datum,
    tijd: show.tijd ?? null,
    reserverenUrl: show.reserverenUrl ?? '',
    status: 'gepland',
    toegevoegdOp: now,
    gewijzigdOp: now,
    ...infoVan(show),
  };
  return voegGeplandSamen(profiel, { gepland: [item], geplandVerwijderd: [] });
}

export function zetStatus(profiel, sleutel, status, now = Date.now()) {
  if (!STATUSSEN.includes(status)) throw new Error(`Onbekende status: ${status}`);
  const item = profiel.gepland.find((i) => i.sleutel === sleutel);
  if (!item) return profiel;
  return voegGeplandSamen(profiel, { gepland: [{ ...item, status, gewijzigdOp: now }], geplandVerwijderd: [] });
}

export function haalUitPlanning(profiel, sleutel, now = Date.now()) {
  return voegGeplandSamen(profiel, { gepland: [], geplandVerwijderd: [{ sleutel, verwijderdOp: now }] });
}

/**
 * Zoekt de voorstelling in de huidige data bij een plan, in deze volgorde:
 *   exact  — zelfde theater, datum, tijd en titel;
 *   tijd   — zelfde theater, datum en titel, andere tijd (precies één);
 *   titel  — zelfde theater, datum en tijd, andere titel (precies één);
 *   weg    — niets gevonden: "Niet meer in de agenda".
 * `index` komt van indexeerShows(); geeft { show, soort }.
 */
export function koppel(item, index) {
  const opDag = index.get(`${item.theaterId}|${item.datum}`) ?? [];
  const titel = ruimeTitel(item.titel);
  const tijd = item.tijd ?? '';
  // Een afgelaste voorstelling blijft gekoppeld (het plan toont dan
  // "Afgelast"); staat er op hetzelfde tijdstip ook een gewone, dan die.
  const exacten = opDag.filter((s) => (s.tijd ?? '') === tijd && ruimeTitel(s.titel) === titel);
  const exact = exacten.find((s) => !isVervallen(s)) ?? exacten[0];
  if (exact) return { show: exact, soort: 'exact' };
  // Titel uitgebreid (titelconventie sep 2026: "Sara Kroos" werd "Sara Kroos –
  // Prikkelarme kermis"): zelfde tijd en alle oude delen zitten in de nieuwe.
  const oudeDelen = titelDelen(item.titel);
  const uitgebreid = opDag.filter(
    (s) => (s.tijd ?? '') === tijd && oudeDelen.every((d) => titelDelen(s.titel).includes(d))
  );
  if (uitgebreid.length === 1) return { show: uitgebreid[0], soort: 'exact', uitgebreid: true };
  const zelfdeTitel = opDag.filter((s) => ruimeTitel(s.titel) === titel);
  if (zelfdeTitel.length === 1) return { show: zelfdeTitel[0], soort: 'tijd' };
  const zelfdeTijd = opDag.filter((s) => (s.tijd ?? '') === tijd);
  if (tijd && zelfdeTijd.length === 1) return { show: zelfdeTijd[0], soort: 'titel' };
  return { show: null, soort: 'weg' };
}

/**
 * Plannen waarvan de titel alleen is uitgebreid (zie koppel): sleutel en
 * titel in de momentopname bijwerken naar de nieuwe titel, zodat de koppeling
 * vanaf dan gewoon exact is. Tijdstempels blijven gelijk (het is geen
 * handeling van de gebruiker); idempotent. Geeft { profiel, gewijzigd }.
 */
export function werkPlannenBij(profiel, index) {
  let gewijzigd = false;
  const gepland = (profiel?.gepland ?? []).map((item) => {
    const r = koppel(item, index);
    if (!r.uitgebreid) return item;
    gewijzigd = true;
    return { ...item, sleutel: geplandSleutel(r.show), titel: r.show.titel };
  });
  if (!gewijzigd) return { profiel, gewijzigd };
  return { profiel: voegGeplandSamen({ gepland, geplandVerwijderd: profiel.geplandVerwijderd ?? [] }), gewijzigd };
}

/**
 * Plannen waarvan de voorstelling nu als afgelast of verplaatst in de agenda
 * staat: `vervallen` in de momentopname zetten (zie boven). Tijdstempels
 * blijven gelijk; idempotent. Geeft { profiel, gewijzigd }.
 */
export function markeerVervallen(profiel, index) {
  let gewijzigd = false;
  const gepland = (profiel?.gepland ?? []).map((item) => {
    if (item.vervallen) return item;
    const { show } = koppel(item, index);
    if (!show || !isVervallen(show)) return item;
    gewijzigd = true;
    return { ...item, vervallen: show.beschikbaarheid };
  });
  if (!gewijzigd) return { profiel, gewijzigd };
  return { profiel: voegGeplandSamen({ gepland, geplandVerwijderd: profiel.geplandVerwijderd ?? [] }), gewijzigd };
}

/**
 * Oudere plannen aanvullen met maker, genre, locatie en zaal van de
 * voorstelling, zolang die (exact) in de agenda staat. Tijdstempels blijven
 * gelijk; idempotent. Geeft { profiel, gewijzigd }.
 */
export function vulInfoAan(profiel, index) {
  let gewijzigd = false;
  const gepland = (profiel?.gepland ?? []).map((item) => {
    const { show, soort } = koppel(item, index);
    if (!show || soort !== 'exact') return item;
    const extra = Object.fromEntries(Object.entries(infoVan(show)).filter(([v]) => !item[v]));
    if (Object.keys(extra).length === 0) return item;
    gewijzigd = true;
    return { ...item, ...extra };
  });
  if (!gewijzigd) return { profiel, gewijzigd };
  return { profiel: voegGeplandSamen({ gepland, geplandVerwijderd: profiel.geplandVerwijderd ?? [] }), gewijzigd };
}

/** Map theaterId|datum → voorstellingen, voor koppel(). */
export function indexeerShows(shows) {
  const index = new Map();
  for (const s of shows ?? []) {
    const k = `${s.theaterId}|${s.datum}`;
    if (!index.has(k)) index.set(k, []);
    index.get(k).push(s);
  }
  return index;
}

/** Andere plannen op dezelfde dag (informatief, geen blokkade). */
export function zelfdeAvond(item, gepland) {
  return gepland.filter((i) => i.sleutel !== item.sleutel && i.datum === item.datum);
}

/** Komende plannen (vandaag en later), op datum en tijd. Voorbije blijven bewaard. */
export function komendePlannen(gepland, vandaag) {
  return gepland
    .filter((i) => i.datum >= vandaag)
    .sort((a, b) => `${a.datum} ${a.tijd ?? '99:99'}`.localeCompare(`${b.datum} ${b.tijd ?? '99:99'}`));
}

/**
 * Eén laadronde (localStorage of Firestore, eventueel samen met de lokale
 * planning bij inloggen). `gewijzigd` zegt of er geschreven moet worden.
 */
export function laadGepland({ opgeslagen, extra = null, index = null }) {
  const basis = { gepland: opgeslagen?.gepland ?? [], geplandVerwijderd: opgeslagen?.geplandVerwijderd ?? [] };
  const samen = voegGeplandSamen(basis, extra ?? leeg());
  // Met de agenda erbij: plannen met een uitgebreide titel bijwerken.
  const profiel = index ? vulInfoAan(markeerVervallen(werkPlannenBij(samen, index).profiel, index).profiel, index).profiel : samen;
  return { profiel, gewijzigd: JSON.stringify(profiel) !== JSON.stringify(basis) };
}

export { leeg as legeGepland };
