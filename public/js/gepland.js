// Gepland: één specifieke speeldatum die je wilt bezoeken (of waarvoor je
// al kaarten hebt). Pure functies, gedeeld door de app en de tests.
//
// Datamodel (localStorage en Firestore, zelfde vorm):
//   gepland:           [{ sleutel, titel, theaterId, theaterNaam, stad, datum,
//                         tijd, reserverenUrl, status, toegevoegdOp, gewijzigdOp }]
//   geplandVerwijderd: [{ sleutel, verwijderdOp }]      (tombstones)
// Het item is een momentopname: verdwijnt of verschuift de voorstelling in
// de agenda, dan blijft het plan staan zoals je het maakte (zie koppel()).
// Samenvoegen: per sleutel wint de laatste actie (plannen, status wisselen
// of uit de planning halen). Voorbije plannen worden nooit verwijderd,
// alleen niet getoond.

import { ruimeTitel } from './watchlist.js';

export const STATUSSEN = ['gepland', 'kaarten'];

/** theaterId|datum|tijd|titel — de titel ruim genormaliseerd (zie watchlist.js). */
export function geplandSleutel(show) {
  return [show.theaterId, show.datum, show.tijd ?? '', ruimeTitel(show.titel)].join('|');
}

const leeg = () => ({ gepland: [], geplandVerwijderd: [] });

export function voegGeplandSamen(...bronnen) {
  const items = new Map();
  const verwijderd = new Map();
  for (const b of bronnen) {
    for (const item of b?.gepland ?? []) {
      const huidig = items.get(item.sleutel);
      if (!huidig || (item.gewijzigdOp ?? 0) > (huidig.gewijzigdOp ?? 0)) items.set(item.sleutel, { ...item });
    }
    for (const t of b?.geplandVerwijderd ?? []) {
      if ((t.verwijderdOp ?? 0) > (verwijderd.get(t.sleutel) ?? -1)) verwijderd.set(t.sleutel, t.verwijderdOp ?? 0);
    }
  }
  const gepland = [];
  const geplandVerwijderd = [];
  for (const [sleutel, item] of items) {
    const weg = verwijderd.get(sleutel);
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
  const exact = opDag.find((s) => (s.tijd ?? '') === tijd && ruimeTitel(s.titel) === titel);
  if (exact) return { show: exact, soort: 'exact' };
  const zelfdeTitel = opDag.filter((s) => ruimeTitel(s.titel) === titel);
  if (zelfdeTitel.length === 1) return { show: zelfdeTitel[0], soort: 'tijd' };
  const zelfdeTijd = opDag.filter((s) => (s.tijd ?? '') === tijd);
  if (tijd && zelfdeTijd.length === 1) return { show: zelfdeTijd[0], soort: 'titel' };
  return { show: null, soort: 'weg' };
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
export function laadGepland({ opgeslagen, extra = null }) {
  const basis = { gepland: opgeslagen?.gepland ?? [], geplandVerwijderd: opgeslagen?.geplandVerwijderd ?? [] };
  const profiel = voegGeplandSamen(basis, extra ?? leeg());
  return { profiel, gewijzigd: JSON.stringify(profiel) !== JSON.stringify(basis) };
}

export { leeg as legeGepland };
