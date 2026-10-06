// Weergavetitel van een voorstelling: "Voorstelling – Maker", één keer.
// Gedeeld door de agendaregels, de watchlist en de planning, zodat die
// overal hetzelfde tonen. De maker komt er alleen bij als hij nog niet in de
// titel staat (bv. "Jenny Arean Zingt" met maker "Jenny Arean"), en altijd
// met een en-dash.

import { normalizeTitle } from './productions.js';

/** Staat `maker` (als hele woorden) al in `titel`? */
export function makerStaatInTitel(titel, maker) {
  const t = normalizeTitle(titel ?? '');
  const m = normalizeTitle(maker ?? '');
  return Boolean(m) && ` ${t} `.includes(` ${m} `);
}

export function weergaveTitel(show) {
  const titel = String(show?.titel ?? '');
  const maker = String(show?.maker ?? '').trim();
  if (!maker || makerStaatInTitel(titel, maker)) return titel;
  return `${titel} – ${maker}`;
}

// Een voorstelling die op deze datum niet doorgaat (zie
// src/lib/beschikbaarheid.js): wel tonen, met label, niet boekbaar.
export const VERVALLEN = ['afgelast', 'verplaatst'];
export const VERVALLEN_LABELS = { afgelast: 'Afgelast', verplaatst: 'Verplaatst' };

export function isVervallen(showOfStatus) {
  const b = typeof showOfStatus === 'string' ? showOfStatus : showOfStatus?.beschikbaarheid;
  return VERVALLEN.includes(b);
}

// Vol: uitverkocht of alleen een wachtlijst. In de agenda verborgen met
// "Verberg volle voorstellingen"; in het detailscherm altijd een grijs,
// doorgestreept datumblokje (okt 2026). Een eigen plan of een directe link
// (watchlist) blijft gewoon werken.
export const VOL = ['uitverkocht', 'wachtlijst'];

export function isVol(showOfStatus) {
  const b = typeof showOfStatus === 'string' ? showOfStatus : showOfStatus?.beschikbaarheid;
  return VOL.includes(b);
}

/**
 * Stand van een watchlist-item uit zijn speeldata (alle theaters, zelfde
 * sleutel). Alleen data vanaf `vandaag` tellen. Geeft:
 * - soort 'komend': er is een datum die doorgaat (soonest = de eerste);
 *   label null, of "2 van 5 data afgelast" als een deel niet doorgaat;
 * - soort 'vervallen': alle komende data afgelast/verplaatst; label
 *   "Afgelast" (of "Verplaatst"), eerste = de eerste vervallen datum;
 * - soort 'weg': niet meer in de agenda; label "Niet meer in de agenda".
 * Tolerant voor oude data zonder beschikbaarheid (telt als gewoon).
 */
export function watchlistStand(shows, vandaag) {
  const sorteer = (a, b) => `${a.datum}T${a.tijd ?? '99:99'}`.localeCompare(`${b.datum}T${b.tijd ?? '99:99'}`);
  const komend = (shows ?? []).filter((s) => typeof s?.datum === 'string' && s.datum >= vandaag).sort(sorteer);
  if (komend.length === 0) return { soort: 'weg', label: 'Niet meer in de agenda', soonest: null, eerste: null, vervallen: 0, totaal: 0 };
  const vervallen = komend.filter(isVervallen);
  const gaatDoor = komend.filter((s) => !isVervallen(s));
  const woord = vervallen.every((s) => s.beschikbaarheid === 'verplaatst')
    ? 'verplaatst'
    : vervallen.every((s) => s.beschikbaarheid === 'afgelast')
      ? 'afgelast'
      : 'afgelast of verplaatst';
  const basis = { vervallen: vervallen.length, totaal: komend.length };
  if (gaatDoor.length === 0) {
    const label = woord === 'verplaatst' ? 'Verplaatst' : 'Afgelast';
    return { ...basis, soort: 'vervallen', label, soonest: null, eerste: vervallen[0] };
  }
  const label = vervallen.length ? `${vervallen.length} van ${komend.length} data ${woord}` : null;
  return { ...basis, soort: 'komend', label, soonest: gaatDoor[0], eerste: gaatDoor[0] };
}
