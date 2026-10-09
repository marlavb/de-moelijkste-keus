// Een export van de afvinkpagina (alias-keuzes-<datum>.json) samenvoegen met
// de aliaslijst (config/aliassen.json, zie aliassen.js). Per beoordeelde
// groep vervangt de nieuwe keuze de oude: eerdere aliassen van die groep
// gaan eruit, de nieuwe komen erin. Een keuze wint van een R2/R3-alias op
// dezelfde bron. Geeft { lijst, overzicht }.
//
// - Een bron die in twee groepen naar een ander doel wijst ("Theater
//   Oostpool" als losse titel, naar "The Nether" én "Millennial II") is niet
//   eenduidig: die bron komt niet in de lijst (conflict in het overzicht).
// - Een keten (doel is zelf een bron met een ander doel) wordt opgelost naar
//   het laatste doel.

import { doelSleutel, makerInTitel } from './aliassen.js';

/**
 * De titel die een keuze oplevert: de weergave ("Titel – Maker" of "Titel").
 * Bij "samenvoegen" met een maker buiten de titel kwam die maker uit het
 * voorstel (de meeste theaters); die laat de alias aan de makermeerderheid
 * over ("CATS" kreeg anders "Het meesterwerk"). Een maker die bij "andere
 * naam" is ingevuld, telt wel.
 */
function doelVan(a) {
  const c = a.canoniek;
  const titel = c.weergave ?? (c.maker ? `${c.titel} – ${c.maker}` : c.titel);
  const maker = c.maker && (a.keuze === 'andere naam' || makerInTitel(titel, c.maker)) ? c.maker : null;
  return { titel, maker };
}

export function voegExportSamen(bestaand, exp) {
  const lijst = {
    ...bestaand,
    aliassen: { ...(bestaand?.aliassen ?? {}) },
    nietSamenvoegen: [...(bestaand?.nietSamenvoegen ?? [])],
  };
  const overzicht = { nieuw: [], gewijzigd: [], verwijderd: [], gelijk: 0, conflicten: [], ketens: [] };
  const oud = structuredClone(lijst.aliassen);

  // Groepen in deze export: hun oude keuzes en niet-samenvoegen eruit.
  const groepen = new Set([...(exp.aliassen ?? []).map((a) => a.groep), ...(exp.nietSamenvoegen ?? []).map((g) => g.groep)]);
  for (const [bron, a] of Object.entries(lijst.aliassen)) if (a.regel === 'keuze' && groepen.has(a.groep)) delete lijst.aliassen[bron];
  lijst.nietSamenvoegen = lijst.nietSamenvoegen.filter((g) => !groepen.has(g.groep));
  for (const g of exp.nietSamenvoegen ?? []) lijst.nietSamenvoegen.push({ groep: g.groep, sleutels: g.sleutels });

  const keuzes = (exp.aliassen ?? []).map((a) => ({ ...a, doel: doelVan(a) }));

  // Per bron: alle doelen gelijk, anders conflict.
  const perBron = new Map();
  for (const k of keuzes) {
    if (!perBron.has(k.bron)) perBron.set(k.bron, []);
    perBron.get(k.bron).push(k);
  }
  for (const [bron, ks] of perBron) {
    const doelen = new Set(ks.map((k) => k.doel.titel));
    if (doelen.size > 1) {
      overzicht.conflicten.push(`${bron}: ${ks.map((k) => `${k.groep} → "${k.doel.titel}"`).join(' / ')}`);
      delete lijst.aliassen[bron];
      continue;
    }
    lijst.aliassen[bron] = { titel: ks[0].doel.titel, maker: ks[0].doel.maker, groep: ks[0].groep, regel: 'keuze' };
  }

  // Een nietSamenvoegen-groep: geen R2/R3-alias op zijn sleutels.
  const verboden = new Set(lijst.nietSamenvoegen.flatMap((g) => g.sleutels));
  for (const [bron, a] of Object.entries(lijst.aliassen)) if (a.regel !== 'keuze' && verboden.has(bron)) delete lijst.aliassen[bron];

  losKettingenOp(lijst, overzicht);
  // Een alias naar zichzelf met dezelfde titel verandert niets, maar blijft:
  // hij zet afwijkende schrijfwijzen van de doelsleutel gelijk.

  for (const [bron, a] of Object.entries(lijst.aliassen)) {
    const o = oud[bron];
    if (!o) overzicht.nieuw.push(`${bron} → "${a.titel}"`);
    else if (o.titel !== a.titel || o.maker !== a.maker) overzicht.gewijzigd.push(`${bron}: "${o.titel}" → "${a.titel}"`);
    else overzicht.gelijk++;
  }
  for (const bron of Object.keys(oud)) if (!lijst.aliassen[bron]) overzicht.verwijderd.push(`${bron} (was "${oud[bron].titel}")`);
  lijst.aliassen = Object.fromEntries(Object.entries(lijst.aliassen).sort(([a], [b]) => a.localeCompare(b)));
  return { lijst, overzicht };
}

/** Ketens oplossen: elk doel naar het laatste doel (ook als dat een andere maker heeft). */
export function losKettingenOp(lijst, overzicht = { ketens: [] }) {
  const aliassen = lijst.aliassen;
  for (const [bron, a] of Object.entries(aliassen)) {
    let doel = a;
    const gezien = new Set([bron]);
    for (;;) {
      const sleutel = doelSleutel(doel);
      const verder = aliassen[sleutel];
      if (!verder || gezien.has(sleutel) || verder.titel === doel.titel) break;
      gezien.add(sleutel);
      doel = verder;
    }
    if (doel !== a) {
      overzicht.ketens.push(`${bron}: "${a.titel}" → "${doel.titel}"`);
      aliassen[bron] = { ...a, titel: doel.titel, maker: doel.maker };
    }
  }
  return lijst;
}

export { makerInTitel };
