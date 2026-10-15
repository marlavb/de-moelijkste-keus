// Aliaslijst (titels-ronde-2, okt 2026): dezelfde productie onder
// verschillende titels krijgt bij elk theater één titel. De lijst staat in
// config/aliassen.json en komt uit de afvinkpagina (debug/alias-afvinken.html,
// `npm run alias-importeren -- <export>`) en uit de voorstellen zonder twijfel
// (R2/R3, `npm run alias-voorstel`).
//
// Vorm: { aliassen: { <bron-sleutel>: { titel, maker, groep, regel } },
// nietSamenvoegen: [{ groep, sleutels }] }. De bron-sleutel is de
// watchlist-sleutel van de titel zoals de nabewerking die maakt (na labels,
// R1, R4 en R5). `titel` is de hele titel die de voorstelling krijgt, dus met
// de maker erin als die er hoort ("Dekpunt – Jan Beuving"); `maker` is de
// maker van de productie: staat hij als laatste titeldeel, dan gaat een
// gelijke maker uit het makerveld (niet dubbel); staat hij er niet in, dan
// vult hij een leeg makerveld. `makerVast` (bij "andere naam"): het
// makerveld wordt precies `maker` (leeg als die in de titel staat).
// `regel`: 'keuze' (afgevinkt), 'R2' (ontbrekende maker) of 'R3' (maker in de
// titel), voor de voorstellen zonder twijfel.

import { readFileSync } from 'node:fs';
import { watchlistSleutel, zonderRuis } from '../../public/js/watchlist.js';

export const ALIASSEN_PAD = new URL('../../config/aliassen.json', import.meta.url);

export function leesAliassen(pad = ALIASSEN_PAD) {
  try {
    return JSON.parse(readFileSync(pad, 'utf-8'));
  } catch {
    return { aliassen: {}, nietSamenvoegen: [] };
  }
}

const kaal = (t) => String(t ?? '').replace(/\s*&\s*/g, ' en ').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/** Staat de maker als laatste titeldeel in de titel? */
export function makerInTitel(titel, maker) {
  if (!maker) return false;
  const delen = String(titel).split(' – ');
  return delen.length > 1 && kaal(zonderRuis(delen.at(-1))) === kaal(zonderRuis(maker));
}

/** De doelsleutel van een alias (de watchlist-sleutel van de nieuwe titel). */
export const doelSleutel = (alias) => watchlistSleutel(alias.titel);

/**
 * Past de alias toe op een titel en maker (na labels, R1, R4, R5). Geeft
 * { titel, maker, alias } (alias null als er geen is).
 */
export function pasAliasToe({ titel, maker, theaterId }, lijst) {
  const alias = lijst?.aliassen?.[watchlistSleutel(titel, theaterId)];
  if (!alias) return { titel, maker, alias: null };
  // Een maker die al in de nieuwe titel staat, gaat uit het makerveld: de
  // maker van de alias, of de voorstellingsnaam bij een omgedraaide variant
  // ("Maarten Heijmans & Xander Vrienten" / "Wachtend op de dood"). Zonder
  // label of leeftijd: "Femme Vitaal (reprise)" staat in "Femme Vitaal –
  // Tineke Schouten", "Voor Haar" in "Voor Haar, de Frans Halsema Musical".
  // "Andere naam": de maker is wat er is ingevuld (ook leeg); staat hij in de
  // titel, dan blijft het makerveld leeg ("Darkride" zonder maker).
  if (alias.makerVast) return { titel: alias.titel, maker: makerInTitel(alias.titel, alias.maker) ? null : alias.maker ?? null, alias };
  const m = kaal(zonderRuis(maker ?? ''));
  const inTitel = maker && m.length >= 4 && ` ${kaal(alias.titel)} `.includes(` ${m} `);
  let nieuweMaker = inTitel ? null : maker;
  // Een maker buiten de titel (bij "andere naam" ingevuld) vult een leeg veld.
  if (!nieuweMaker && alias.maker && !makerInTitel(alias.titel, alias.maker)) nieuweMaker = alias.maker;
  // Omgedraaid (de maker was de voorstellingsnaam, Cpunt "Firma Mes" /
  // "Wapens"): dan is de oude titel de maker, als die niet in de nieuwe titel
  // staat. Zonder leeftijdsdelen ("Joes – 3 t/m 8 jaar" → "Joes").
  if (inTitel && !nieuweMaker && !makerInTitel(alias.titel, alias.maker)) {
    const rest = String(titel).split(' – ').filter((d) => !/^\(?\d/.test(d.trim()) && !` ${kaal(alias.titel)} `.includes(` ${kaal(zonderRuis(d))} `));
    if (rest.length) nieuweMaker = rest.join(' – ');
  }
  return { titel: alias.titel, maker: nieuweMaker, alias };
}

/**
 * Controleert een aliaslijst. Geeft een lijst meldingen: een doel dat zelf
 * een bron met een ander doel is (keten), of groepen met dezelfde titel maar
 * een andere doelsleutel.
 */
export function controleer(lijst) {
  const meldingen = [];
  const aliassen = lijst.aliassen ?? {};
  for (const [bron, a] of Object.entries(aliassen)) {
    const doel = doelSleutel(a);
    const verder = aliassen[doel];
    if (doel !== bron && verder && verder.titel !== a.titel) meldingen.push(`keten: ${bron} → ${a.titel} → ${verder.titel}`);
  }
  const verboden = new Set((lijst.nietSamenvoegen ?? []).flatMap((g) => g.sleutels));
  for (const bron of Object.keys(aliassen)) {
    if (verboden.has(bron) && aliassen[bron].regel !== 'keuze') meldingen.push(`R2/R3 op een groep in nietSamenvoegen: ${bron}`);
  }
  return meldingen;
}

/**
 * Tweede ronde na productie-samenvoeging en weergave op meerderheid (15 okt
 * 2026): wordt een titel pas dan een bron uit de lijst, dan alsnog de alias.
 * Stadsschouwburg Utrecht "Baby Reindeer – Kobra theaterproducties – Thijs
 * van de Meeberg" werd door het samenvoegen "Baby Reindeer – Thijs van de
 * Meeberg" (een bron) en bleef zo los naast "Baby Reindeer". De titel van
 * vóór deze ronde blijft als titelVoorAlias (samenvoegMapping, gepland.js);
 * titelBron blijft de brontitel. Geeft { shows, gewijzigd }.
 */
export function pasAliasNaSamenvoegenToe(shows, lijst) {
  let gewijzigd = 0;
  const uit = shows.map((s) => {
    const a = pasAliasToe(s, lijst);
    if (!a.alias || (a.titel === s.titel && a.maker === (s.maker ?? null))) return s;
    gewijzigd++;
    const bron = s.titelBron ?? s.titel;
    return {
      ...s,
      titel: a.titel,
      maker: a.maker,
      ...(a.titel !== bron ? { titelBron: bron } : {}),
      ...(s.titel !== a.titel && s.titel !== bron ? { titelVoorAlias: s.titelVoorAlias ?? s.titel } : {}),
      ...(a.maker !== (s.maker ?? null) && s.makerBron === undefined ? { makerBron: s.maker ?? null } : {}),
    };
  });
  return { shows: uit, gewijzigd };
}

/**
 * Bronnen uit de lijst die na de nabewerking nog als eigen productiesleutel
 * in de data staan (doel: geen). Geeft [{ sleutel, titel, theaters }].
 */
export function losseBronnen(shows, lijst) {
  const per = new Map();
  for (const s of shows) {
    const k = watchlistSleutel(s.titel, s.theaterId);
    const a = lijst?.aliassen?.[k];
    if (!a || doelSleutel(a) === k) continue;
    const e = per.get(k) ?? { sleutel: k, titel: s.titel, theaters: new Set() };
    e.theaters.add(s.theaterId);
    per.set(k, e);
  }
  return [...per.values()].map((e) => ({ ...e, theaters: [...e.theaters].sort() }));
}

/**
 * Oude sleutels (titelBron, titelVoorAlias) die naar meer dan één huidige
 * sleutel gaan. samenvoegMapping (watchlist.js) zet die niet om, dus een
 * watchlist-, Gezien- of planitem met zo'n sleutel blijft hangen ("ndt 2":
 * via de alias "Blast a universe", via PLT/De Spiegel "A poem for the world –
 * NDT 2"; 15 okt 2026). Een oude sleutel die zelf nog een huidige sleutel
 * is, telt niet (die wordt niet omgezet). Geeft [{ sleutel, doelen }].
 */
export function sleutelsMetMeerDoelen(shows) {
  const huidig = new Set();
  const doelen = new Map();
  for (const s of shows ?? []) {
    const nieuw = watchlistSleutel(s.titel, s.theaterId);
    huidig.add(nieuw);
    for (const bron of [s.titelBron, s.titelVoorAlias]) {
      if (!bron) continue;
      const oud = watchlistSleutel(bron, s.theaterId);
      if (oud === nieuw) continue;
      if (!doelen.has(oud)) doelen.set(oud, new Set());
      doelen.get(oud).add(nieuw);
    }
  }
  return [...doelen]
    .filter(([oud, d]) => d.size > 1 && !huidig.has(oud))
    .map(([sleutel, d]) => ({ sleutel, doelen: [...d].sort() }))
    .sort((x, y) => x.sleutel.localeCompare(y.sleutel));
}

/**
 * Staat het aliasdoel als geheel titeldeel in de titel (zoals de watchlist-
 * sleutel: zonder leeftijd, hoofdletters en leestekens)? "Kleuren moeten ook
 * slapen (6+)" in "Kleuren moeten ook slapen 6+ – Janne Schra & De Vogels":
 * ja; "Blast a universe" in "A poem for the world – NDT 2": nee.
 */
export function doelInTitel(doel, titel) {
  const delen = new Set(watchlistSleutel(titel).split(' | '));
  return watchlistSleutel(doel).split(' | ').every((d) => delen.has(d));
}
