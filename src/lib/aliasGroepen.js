// Aliasvoorstel (titels-ronde-2, okt 2026): groepen voorstellingen die
// waarschijnlijk dezelfde productie zijn onder verschillende titels, met een
// voorgestelde canonieke titel, de soort(en) en twijfelredenen. Invoer voor de
// afvinkpagina (scripts/alias-afvinkpagina.js) en R2/R3
// (scripts/alias-voorstel.js) via debug/alias-voorstel.json; maken met
// `npm run alias-voorstel-maken`. Voegt zelf niets samen.
//
// Soorten: a slogan/ondertitel, b cast als maker, c extra titeldeel na komma
// of dubbele punt, d makervariant, e maker ontbreekt, f maker in titel vs.
// makerveld / omgedraaid. Twijfel: ander genre, korte titel, uitsluitlijst,
// makernamen, speeldata ver uit elkaar, omgedraaid, verschillende makers,
// generiek titeldeel, statuswoord, conflict met een andere groep.
// Tot 10 okt 2026 stond deze code alleen buiten de repo (twee losse scripts);
// de regels zijn ongewijzigd overgenomen.

import { watchlistSleutel } from '../../public/js/watchlist.js';
import { normalizeTitle, EXCLUDED_NORMALIZED_TITLES } from '../../public/js/productions.js';
import { bewerkingsafstand } from './aliasKandidaten.js';

/**
 * Stap 1: groepen kandidaat-producties per gedeeld titeldeel (anker), alleen
 * voor komende speeldata (datum >= vandaag). Geeft een lijst groepen.
 */
export function maakGroepen(shows, { vandaag }) {
  const prod = new Map();
  for (const s of shows) {
    if (s.datum < vandaag) continue;
    const k = `${s.theaterId}\u0001${s.titel}\u0001${s.maker ?? ''}`;
    if (!prod.has(k)) prod.set(k, { theaterId: s.theaterId, theaterNaam: s.theaterNaam, titel: s.titel, maker: s.maker ?? null, genres: new Set(), n: 0, data: [], sleutel: watchlistSleutel(s.titel, s.theaterId) });
    const p = prod.get(k);
    p.n++; p.data.push(s.datum);
    if (s.genre && s.genre !== 'Overig') p.genres.add(s.genre);
  }
  const P = [...prod.values()];
  const SPLIT = /\s+[–—-]\s+|\s+\|\s+|:\s+|,\s+/;
  const ruwDelen = (t) => String(t ?? '').replace(/\s*\((?:\d+(?:[.,]\d)?\+|\d+\s*-\s*\d+\s*jaar|try-?out|reprise|premi[eè]re)\)/gi, ' ').replace(/\s+\d+\+\s*$/, '').split(SPLIT).map((x) => x.trim()).filter(Boolean);
  for (const p of P) {
    p.titelDelen = ruwDelen(p.titel);
    p.makerDelen = p.maker ? [p.maker.trim()] : [];
    p.alle = [...new Set([...p.titelDelen, ...p.makerDelen].map(normalizeTitle).filter(Boolean))];
  }
  const GENERIEK = /^(oudejaarsconference( \d{4})?|(nieuw|nieuwe) (programma|voorstelling)|kerstconcert|nieuwjaarsconcert|in concert|concert|theaterconcert|de musical|the musical|live|reprise|try ?outs?|premiere|finalistentour(nee)?( \d{4})?|(halve )?finale|jubileumconcert|najaarsconcert|voorjaarsconcert|lunchconcert|matinee|cabaret|muziek|special|open podium|sinterklaas|kerst|best of|tribute|the show|de show|theatertour|tour|koffieconcert|familievoorstelling|voorstelling|theatercollege|lezing|workshop)$/;
  const SLOGAN = /!|officiële|officiele|\bmusical\b|de voorstelling|\btour\b|theatershow|\bshow\b|\bconcert\b|\blive\b|jubileum|afscheid|de enige|het origineel|spektakel|beleving|avond vol|een avond|voor het hele gezin|wereldberoemd|\bhits?\b|succesvol|\bin concert\b|\bthe musical\b/i;
  const CAST = /\be\.\s?a\.?\s*$|\ben anderen\b|\bmet o\.?a\.?\b|\bals\s+\p{Lu}/iu;
  const isNaam = (t) => {
    const x = t.trim();
    return x.split(/\s+/).length <= 5 && /^[\p{Lu}][\p{L}'’.-]*(?:\s+(?:[\p{Lu}][\p{L}'’.-]*|van|de|der|den|la|le|ten|ter|von|di|da|&|en|y))*$/u.test(x) && !SLOGAN.test(x);
  };
  const naamPast = (a, b) => {
    const na = normalizeTitle(a), nb = normalizeTitle(b);
    return na === nb || na.startsWith(nb + ' ') || nb.startsWith(na + ' ') || bewerkingsafstand(na, nb) <= 2;
  };

  // Kandidaten per anker (een deel dat bij ≥ 2 sleutels voorkomt).
  const perDeel = new Map();
  for (const p of P) for (const d of p.alle) { if (!perDeel.has(d)) perDeel.set(d, []); perDeel.get(d).push(p); }
  const groepen = [];
  for (const [anker, lijst] of perDeel) {
    if (new Set(lijst.map((p) => p.sleutel)).size < 2) continue;
    if (GENERIEK.test(anker) || (anker.split(' ').length < 2 && anker.length < 5)) continue;
    // Per productie: wat er naast het anker staat, ingedeeld.
    const info = lijst.map((p) => {
      const rest = [...p.titelDelen, ...p.makerDelen].filter((x) => normalizeTitle(x) !== anker);
      const soort = rest.map((x) => (CAST.test(x) ? 'cast' : SLOGAN.test(x) ? 'slogan' : isNaam(x) ? 'naam' : 'ander'));
      return { p, rest, soort };
    });
    // Ander (geen naam, slogan of cast) = mogelijk een andere voorstelling:
    // alleen goed als het anker zelf bij die productie in de titel staat en
    // het andere deel bij alle varianten met dat deel gelijk is.
    const anders = new Set(info.flatMap((i) => i.rest.filter((x, k) => i.soort[k] === 'ander').map(normalizeTitle)));
    if (anders.size > 1) continue;
    // Namen moeten bij elkaar passen (één maker).
    const namen = [...new Set(info.flatMap((i) => i.rest.filter((x, k) => i.soort[k] === 'naam')))];
    const clusters = [];
    for (const n of namen) { const c = clusters.find((c) => c.some((m) => naamPast(m, n))); if (c) c.push(n); else clusters.push([n]); }
    if (clusters.length > 1) continue;
    groepen.push({ anker, info, namen });
  }
  // Per productie het meest specifieke anker (langste) houden; dan dedupliceren.
  const besteVoor = new Map();
  for (const g of groepen) for (const i of g.info) {
    const k = `${i.p.theaterId}\u0001${i.p.titel}\u0001${i.p.maker ?? ''}`;
    const oud = besteVoor.get(k);
    if (!oud || g.anker.length > oud.anker.length) besteVoor.set(k, g);
  }
  const gezien = new Set();
  const uit = [];
  for (const g of new Set(besteVoor.values())) {
    const leden = g.info.filter((i) => besteVoor.get(`${i.p.theaterId}\u0001${i.p.titel}\u0001${i.p.maker ?? ''}`) === g);
    const sleutels = new Set(leden.map((i) => i.p.sleutel));
    if (sleutels.size < 2) continue;
    const id = [...sleutels].sort().join('|');
    if (gezien.has(id)) continue;
    gezien.add(id);
    const soorten = new Set();
    for (const i of leden) i.soort.forEach((s) => { if (s === 'slogan') soorten.add('a'); if (s === 'cast') soorten.add('b'); });
    if (leden.some((i) => /,\s+|:\s+/.test(i.p.titel))) soorten.add('c');
    if (g.namen.length > 1) soorten.add('d');
    const metNaam = leden.filter((i) => i.soort.includes('naam'));
    if (metNaam.length && leden.some((i) => !i.soort.includes('naam'))) soorten.add('e');
    if (!soorten.size) soorten.add('overig');
    const twijfel = [];
    const genres = new Set(leden.flatMap((i) => [...i.p.genres]));
    if (genres.size > 1 && leden.filter((i) => i.p.genres.size).every((i) => i.p.genres.size === 1)) {
      const per = new Set(leden.filter((i) => i.p.genres.size).map((i) => [...i.p.genres][0]));
      if (per.size > 1) twijfel.push(`ander genre: ${[...per].join(' / ')}`);
    }
    if (g.anker.split(' ').length === 1) twijfel.push(`korte titel "${g.anker}": meer producties met die naam mogelijk`);
    if (EXCLUDED_NORMALIZED_TITLES.has(g.anker) || leden.some((i) => EXCLUDED_NORMALIZED_TITLES.has(i.p.sleutel))) twijfel.push('op de uitsluitlijst (bekend als verschillende producties)');
    if (g.namen.length > 1) twijfel.push(`makernamen: ${g.namen.join(' / ')}`);
    if (soorten.has('e') && !metNaam.length) twijfel.push('maker ontbreekt overal');
    // Datums: overlap van seizoen? (zelfde productie toert in hetzelfde seizoen)
    const eerste = leden.map((i) => i.p.data.slice().sort()[0]).sort();
    if (eerste.length > 1 && (Date.parse(eerste.at(-1)) - Date.parse(eerste[0])) > 400 * 86_400_000) twijfel.push('speeldata ruim een jaar uit elkaar');
    uit.push({ anker: g.anker, soorten: [...soorten], twijfel, namen: g.namen, leden: leden.map((i) => ({ theater: i.p.theaterId, titel: i.p.titel, maker: i.p.maker, n: i.p.n, sleutel: i.p.sleutel, rest: i.rest.map((x, k) => `${x} [${i.soort[k]}]`) })) });
  }
  uit.sort((a, b) => b.leden.reduce((s, l) => s + l.n, 0) - a.leden.reduce((s, l) => s + l.n, 0));
  return uit;
}

/**
 * Stap 2: per groep de canonieke titel, soorten en twijfel; plus de
 * makervarianten binnen één sleutel. Geeft { resultaat, makerGroepen }.
 */
export function maakVoorstel(groepen, shows) {
  const SLOGAN = /!|officiële|officiele|\bde musical\b|\bthe musical\b|-musical\b|de voorstelling|\btheatershow\b|de enige|het origineel|spektakel|beleving|avond vol|een avond|voor het hele gezin|wereldberoemd|succesvol|zes meisjes|naar het boek van|regie:/i;
  const CAST = /\be\.\s?a\.?\s*$|\ben anderen\b|\bmet o\.?a\.?\b|\bals\s+\p{Lu}/iu;
  const n = normalizeTitle;
  const SCHEID = /\s+[–—-]\s+|\s+\|\s+/;
  const naamPast = (a, b) => { const x = n(a), y = n(b); return x === y || x.startsWith(y + ' ') || y.startsWith(x + ' ') || bewerkingsafstand(x, y) <= 2; };

  // Titel opschonen: slogan- en castdelen eruit (op de hele titel én per deel).
  function schoon(titel, maker) {
    let t = String(titel).replace(/\s*\(?\b(?:try[- ]?out|reprise|(?:voor)?premi[eè]re)\b\)?\s*$/i, '').replace(/\s*\((?:try[- ]?out|reprise|(?:voor)?premi[eè]re)\)/gi, '').trim(), m = maker;
    const castTitel = CAST.test(t) || /,.*\be\.\s?a/i.test(t);
    if (castTitel && m) [t, m] = [m, null];              // titel = cast, maker = voorstelling → omdraaien
    const delen = t.split(SCHEID).map((x) => x.trim()).filter((x) => x && !SLOGAN.test(x) && !CAST.test(x) && !/^uitverkocht$/i.test(x));
    if (m && (SLOGAN.test(m) || CAST.test(m))) m = null;
    return { titel: delen.join(' – ') || t, maker: m };
  }
  const resultaat = [];
  const tel = { a: 0, b: 0, c: 0, d: 0, e: 0, f: 0 };
  for (const g of groepen) {
    const leden = g.leden.map((l) => ({ ...l, ...{ schoon: schoon(l.titel, l.maker) } }));
    // Per schone titel: hoeveel theaters.
    const perTitel = new Map();
    for (const l of leden) { const k = l.schoon.titel; if (!perTitel.has(k)) perTitel.set(k, new Set()); perTitel.get(k).add(l.theater); }
    // Omgedraaid (titel = maker van de meerderheid): tellen bij de omgekeerde.
    const makers = new Map();
    for (const l of leden) if (l.schoon.maker) makers.set(n(l.schoon.maker), (makers.get(n(l.schoon.maker)) ?? 0) + 1);
    let kandidaten = [...perTitel].sort((a, b) => b[1].size - a[1].size || b[0].length - a[0].length);
    // Een titel die alleen de (meerderheids)maker is, telt niet als kandidaat als er een andere is.
    // Een titel alleen wegzetten als hij vaker maker is dan titel.
    const alsTitel = (t) => leden.filter((l) => n(l.schoon.titel) === n(t)).length;
    const alleenMaker = (t) => kandidaten.length > 1 && (makers.get(n(t)) ?? 0) > alsTitel(t);
    kandidaten = kandidaten.filter(([t]) => !alleenMaker(t)).concat(kandidaten.filter(([t]) => alleenMaker(t)));
    let canoniek = kandidaten[0][0];
    // Makernaam in de titel: de volledigste variant (Ayoub → Ayoub Kharkhach).
    const delenCan = canoniek.split(' – ');
    const naamDelen = new Set(leden.flatMap((l) => l.schoon.titel.split(' – ')).filter((d) => !delenCan.map(n).includes(n(d))));
    for (const [i, d] of delenCan.entries()) for (const x of naamDelen) if (!/\d/.test(x) && naamPast(d, x) && n(x).length > n(d).length && n(x).startsWith(n(d))) delenCan[i] = x;
    canoniek = delenCan.join(' – ');
    const soorten = new Set(g.soorten.filter((s) => s !== 'overig'));
    const sets = leden.map((l) => new Set([...l.titel.split(SCHEID), ...(l.maker ? [l.maker] : [])].map(n)));
    if (sets.every((s) => s.size === sets[0].size && [...s].every((x) => sets[0].has(x))) || g.soorten.includes('overig')) soorten.add('f');
    for (const s of soorten) tel[s]++;
    const twijfel = [...g.twijfel];
    // Titel en maker omgedraaid bij een deel: welke is de voorstelling?
    const zonderLeeftijd = (t) => n(String(t).replace(/\s*\(?\d+(?:[.,]\d)?\+\)?|\(\d+\s*-\s*\d+\s*jaar\)/g, ''));
    if (leden.some((l) => l.maker && canoniek.split(' – ').map(zonderLeeftijd).includes(zonderLeeftijd(l.maker)))) twijfel.push('omgedraaid: de canonieke titel is elders de maker — welke is de voorstelling?');
    // Verschillende ingevulde makers die niet bij elkaar passen: andere productie?
    const echteMakers = [...new Set(leden.map((l) => l.schoon.maker).filter(Boolean))];
    if (echteMakers.length > 1 && echteMakers.some((a) => echteMakers.some((b) => a !== b && !naamPast(a, b) && n(a) !== n(canoniek) && n(b) !== n(canoniek)))) twijfel.push(`verschillende makers: ${echteMakers.join(' / ')}`);
    // Een "naam" die een generieke titel is ("Best Of", "Nieuw programma").
    if (leden.some((l) => l.titel.split(SCHEID).some((d) => /^(best of|nieuw(e)? (programma|voorstelling)|try-?outs?|the best of)$/i.test(d.trim())))) twijfel.push('generiek titeldeel ("Best Of", "Nieuw programma"): mogelijk een andere voorstelling');
    if (/\buitverkocht\b/i.test(leden.map((l) => l.titel).join(' '))) twijfel.push('"UITVERKOCHT" in een titel (statuswoord, apart op te ruimen)');
    const veranderd = leden.filter((l) => l.titel !== canoniek);
    resultaat.push({ anker: g.anker, soorten: [...soorten], twijfel, canoniek, canoniekeSleutel: watchlistSleutel(canoniek), sleutels: [...new Set(leden.map((l) => l.sleutel))], leden: leden.map(({ schoon, rest, ...l }) => l), veranderd: veranderd.length });
  }
  // Makervarianten binnen één sleutel (zelfde titel): slogan/cast als maker, of naamvarianten.
  const perSleutel = new Map();
  for (const s of shows) {
    const k = watchlistSleutel(s.titel, s.theaterId);
    if (!perSleutel.has(k)) perSleutel.set(k, new Map());
    const m = s.maker ?? '';
    const t = perSleutel.get(k);
    if (!t.has(m)) t.set(m, new Set());
    t.get(m).add(s.theaterId);
  }
  const makerGroepen = [];
  for (const [k, m] of perSleutel) {
    const makers = [...m.keys()].filter(Boolean);
    if (!makers.length) continue;
    const slogan = makers.filter((x) => SLOGAN.test(x));
    const cast = makers.filter((x) => CAST.test(x) || /,.*,/.test(x));
    const namen = makers.filter((x) => !slogan.includes(x) && !cast.includes(x));
    const varianten = namen.length > 1 && namen.every((a) => namen.some((b) => b !== a && naamPast(a, b)));
    if (slogan.length || cast.length || varianten) makerGroepen.push({ sleutel: k, makers: [...m].map(([mk, th]) => `${mk || '(geen)'} [${[...th].join(', ')}]`), slogan, cast, varianten: varianten ? namen : [] });
  }
  // Conflicten: een sleutel in meer groepen (of een groep die naar een sleutel
  // van een andere groep wijst) → beide twijfel.
  const inGroepen = new Map();
  for (const g of resultaat) for (const k of new Set([...g.sleutels, g.canoniekeSleutel])) { if (!inGroepen.has(k)) inGroepen.set(k, []); inGroepen.get(k).push(g); }
  for (const [k, gs] of inGroepen) if (gs.length > 1) for (const g of gs) if (!g.twijfel.some((t) => t.startsWith('conflict'))) g.twijfel.push(`conflict met een andere groep (sleutel "${k}")`);
  return { resultaat, makerGroepen };
}
