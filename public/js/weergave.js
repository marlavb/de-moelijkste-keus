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
