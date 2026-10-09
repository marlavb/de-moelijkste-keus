// R2 en R3 (titels-ronde-2, okt 2026) uit het aliasvoorstel
// (debug/alias-voorstel.json, `npm run alias-voorstel`), alleen voor de
// groepen zonder twijfel en van één soort:
// - R2, ontbrekende maker invullen (soort e): "Nienke Plas" → "Appeltje
//   Eitje – Nienke Plas", "Nazanin Taheri" → "De Surpriseshow" (maker
//   Nazanin Taheri);
// - R3, maker in de titel omzetten (soort f): "Theater Oostpool – The Drama"
//   → "The Drama" (maker Theater Oostpool).
// Gemengde groepen (ook een slogan of extra titeldeel) en groepen met twijfel
// niet. Nooit voor een sleutel in "nietSamenvoegen", en een afgevinkte keuze
// gaat altijd voor. Een bron die in twee groepen naar een ander doel zou
// gaan, blijft eruit. De maker: het laatste titeldeel als de maker in de
// titel staat, anders de maker die de meeste speeldata bij het voorstel
// hebben (geen slogan of cast).

import { isSloganOfCast } from './titels.js';
import { losKettingenOp, makerInTitel } from './aliasImport.js';
import { zonderRuis } from '../../public/js/watchlist.js';
import { APART } from './productieSamenvoegen.js';

// Een maker uit het laatste titeldeel moet op een naam lijken: geen slogan,
// geen apart evenement ("Paas Special"), geen algemeen woord ("SOLO",
// "Presentatie") en niet met een kleine letter ("een helder theatercollege …").
const ALGEMEEN = /^(?:solo|presentatie|live|concert|try-?out|premi[eè]re|reprise|theatertour|tour|nieuw programma)$/i;
export const lijktOpNaam = (m) => /^[\p{Lu}\p{N}]/u.test(m) && !isSloganOfCast(m) && !APART.test(m) && !ALGEMEEN.test(m.trim());

const kaal = (t) => zonderRuis(String(t ?? '')).replace(/\s*&\s*/g, ' en ').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const delenVan = (t) => new Set(String(t).split(/\s+[–—-]\s+|\s+\|\s+/).map(kaal).filter(Boolean));

/**
 * Klopt de variant met het voorstel? Alle delen van de variant staan in het
 * voorstel of zijn de maker, en het voorstel voegt alleen de maker toe (of de
 * variant is alleen de maker). Zo niet ("Adem" → "Het meisje dat de wereld
 * schreef", "SoundLAB workshop" → "… – Paas Special"): overslaan.
 */
export function klopt(variant, canoniek, maker) {
  const v = delenVan(variant);
  const c = delenVan(canoniek);
  const m = kaal(maker ?? '');
  if (![...v].every((d) => c.has(d) || d === m)) return false;
  const extra = [...c].filter((d) => !v.has(d));
  return extra.every((d) => d === m) || (v.size === 1 && v.has(m));
}

const REGEL = { e: 'R2', f: 'R3' };

function makerVan(g) {
  const delen = g.canoniek.split(' – ');
  // "Voorstelling – Maker" (titelconventie): het laatste deel.
  if (delen.length > 1) return lijktOpNaam(delen.at(-1)) ? delen.at(-1) : null;
  const tel = new Map();
  for (const l of g.leden) if (l.sleutel === g.canoniekeSleutel && l.maker && !isSloganOfCast(l.maker)) tel.set(l.maker, (tel.get(l.maker) ?? 0) + l.n);
  return [...tel].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? null;
}

/**
 * `isMaker(maker)`: een bekende maker (van meer producties of een
 * gezelschap). Nodig als de maker uit het makerveld komt: daar staat bij een
 * omgedraaide productie de voorstelling ("Anneke van Giersbergen" / "The Irish
 * Road Trip").
 */
export function voegVoorstelToe(bestaand, voorstel, { isMaker = () => true } = {}) {
  const lijst = { ...bestaand, aliassen: { ...(bestaand.aliassen ?? {}) }, nietSamenvoegen: [...(bestaand.nietSamenvoegen ?? [])] };
  const overzicht = { R2: [], R3: [], overgeslagen: [], conflicten: [], ketens: [] };
  // Oude R2/R3 eruit: opnieuw uit het voorstel.
  for (const [bron, a] of Object.entries(lijst.aliassen)) if (a.regel !== 'keuze') delete lijst.aliassen[bron];
  const verboden = new Set(lijst.nietSamenvoegen.flatMap((g) => g.sleutels));
  const keuzeBronnen = new Set(Object.keys(lijst.aliassen));

  const nieuw = new Map(); // bron → [{ alias }]
  for (const g of voorstel.groepen ?? []) {
    if (g.twijfel?.length || g.soorten.length !== 1 || !REGEL[g.soorten[0]]) continue;
    const regel = REGEL[g.soorten[0]];
    if (g.sleutels.some((k) => verboden.has(k))) {
      overzicht.overgeslagen.push(`${g.canoniek}: niet samenvoegen`);
      continue;
    }
    if (keuzeBronnen.has(g.canoniekeSleutel)) {
      overzicht.overgeslagen.push(`${g.canoniek}: het voorstel zelf staat al in de afgevinkte lijst`);
      continue;
    }
    const maker = makerVan(g);
    if (!maker) {
      overzicht.overgeslagen.push(`${g.canoniek}: geen maker`);
      continue;
    }
    if (!makerInTitel(g.canoniek, maker) && !isMaker(maker)) {
      overzicht.overgeslagen.push(`${g.canoniek}: "${maker}" is geen bekende maker (misschien omgedraaid)`);
      continue;
    }
    const titelVan = new Map(g.leden.map((l) => [l.sleutel, l.titel]));
    for (const bron of new Set(g.leden.map((l) => l.sleutel))) {
      if (bron === g.canoniekeSleutel) continue;
      if (!klopt(titelVan.get(bron), g.canoniek, maker)) {
        overzicht.overgeslagen.push(`${titelVan.get(bron)} → ${g.canoniek}: titeldelen kloppen niet`);
        continue;
      }
      if (keuzeBronnen.has(bron)) {
        overzicht.overgeslagen.push(`${bron}: al afgevinkt`);
        continue;
      }
      if (!nieuw.has(bron)) nieuw.set(bron, []);
      nieuw.get(bron).push({ titel: g.canoniek, maker, groep: g.anker, regel });
    }
  }
  for (const [bron, as] of nieuw) {
    if (new Set(as.map((a) => a.titel)).size > 1) {
      overzicht.conflicten.push(`${bron}: ${as.map((a) => a.titel).join(' / ')}`);
      continue;
    }
    lijst.aliassen[bron] = as[0];
    overzicht[as[0].regel].push(`${bron} → "${as[0].titel}"${as[0].maker && !makerInTitel(as[0].titel, as[0].maker) ? ` (maker ${as[0].maker})` : ''}`);
  }
  losKettingenOp(lijst, overzicht);
  lijst.aliassen = Object.fromEntries(Object.entries(lijst.aliassen).sort(([a], [b]) => a.localeCompare(b)));
  return { lijst, overzicht };
}
