// `npm run alias-afvinkpagina`: maakt van debug/alias-voorstel.json (het
// aliasvoorstel van 9 okt 2026, stap B van de aliaslijst) een lokale pagina
// debug/alias-afvinken.html om de twijfelgroepen te beoordelen. Alleen voor
// lokaal gebruik, niet in de app; debug/ staat niet in git.
//
// Per groep: de varianten (titel, maker, theaters, speeldata), het voorstel
// (canonieke titel + maker), de twijfelreden en de keuze "samenvoegen", "niet
// samenvoegen" of "andere naam". Keuzes blijven in localStorage van de
// browser; "Exporteer" downloadt de alias-JSON (bron → canoniek). Groepen
// zonder keuze komen niet in de export en blijven dus ongewijzigd.
// Volgorde: eerst groepen met items van Marla of Erik, dan op aantal theaters.

import { readFileSync, writeFileSync } from 'node:fs';

// Slogan of cast ("Soy Kroon als Frans Halsema") niet als voorgestelde maker
// (titels-ronde-1, R1); zonder die regel in titels.js telt elke maker.
const { isSloganOfCast = () => false } = await import('../src/lib/titels.js');

const voorstel = JSON.parse(readFileSync('debug/alias-voorstel.json', 'utf-8'));
const shows = JSON.parse(readFileSync('public/data/shows.json', 'utf-8'));

const theaterNamen = Object.fromEntries(shows.map((s) => [s.theaterId, s.theaterNaam]));
const speeldata = new Map(); // theaterId|titel → [datum, …]
for (const s of shows) {
  const k = `${s.theaterId}|${s.titel}`;
  if (!speeldata.has(k)) speeldata.set(k, []);
  speeldata.get(k).push(s.datum);
}

const SOORTEN = {
  a: 'slogan/ondertitel',
  b: 'cast als maker',
  c: 'extra titeldeel',
  d: 'makervariant',
  e: 'maker ontbreekt',
  f: 'maker in titel / omgedraaid',
};

// Het voorstel "Voorstelling – Maker" gesplitst in titel en maker, volgens
// de titelconventie van de app (laatste deel = maker). Niet bij een leeftijd
// ("(6+)", "3+") of "Reeks: titel". Staat het eerste deel bij een variant als
// maker of als losse titel, dan krijgt de kaart een waarschuwing: uit de data
// is dan niet te zien wie de maker is ("Herman van Veen" / "Vandaag" staat
// even vaak andersom; Markant "Floor Bosman" / "PUUR FLOOR").
const kaal = (t) => String(t ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s*(?:\(\d[^)]*\)|[–-]\s*\d+\s*\+)\s*$/, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
function splits(canoniek, leden) {
  const delen = canoniek.split(' – ');
  const geen = { titel: canoniek, maker: null, volgordeTwijfel: false };
  // volgordeTwijfel: 'andersom' (eerste deel elders maker of losse titel),
  // 'onbevestigd' (het laatste deel is nergens maker of losse titel) of false.
  if (delen.length < 2) return geen;
  // Een leeftijd achteraan hoort bij de titel: "Beuk – Kim van Zeben (4+)".
  const leeftijd = delen.at(-1).match(/\s*\(\d[^)]*\)$/)?.[0] ?? '';
  const laatste = delen.at(-1).slice(0, delen.at(-1).length - leeftijd.length);
  const eerste = delen.slice(0, -1).join(' – ');
  if (!/\p{L}{2}/u.test(laatste) || /^\d|\+\)?$|\bjaar\b/i.test(laatste) || laatste.includes(':')) return geen;
  const andersom = leden.some((x) => (x.maker && kaal(x.maker) === kaal(eerste)) || kaal(x.titel) === kaal(eerste));
  const bevestigd = leden.some((x) => (x.maker && (kaal(x.maker).includes(kaal(laatste)) || kaal(laatste).includes(kaal(x.maker)))) || kaal(x.titel) === kaal(laatste));
  return { titel: eerste + leeftijd, maker: laatste, volgordeTwijfel: andersom ? 'andersom' : bevestigd ? false : 'onbevestigd' };
}

const groepen = voorstel.groepen
  .filter((g) => g.twijfel?.length)
  .map((g) => {
    // Varianten: zelfde titel en maker samen, met alle theaters en speeldata.
    const varianten = new Map();
    for (const l of g.leden) {
      const k = `${l.titel}\u0000${l.maker ?? ''}`;
      if (!varianten.has(k)) varianten.set(k, { titel: l.titel, maker: l.maker, sleutel: l.sleutel, theaters: [], data: [] });
      const v = varianten.get(k);
      v.theaters.push(l.theater);
      v.data.push(...(speeldata.get(`${l.theater}|${l.titel}`) ?? []));
    }
    for (const v of varianten.values()) v.data = [...new Set(v.data)].sort();
    // Voorgestelde maker: de meest voorkomende maker bij de canonieke sleutel.
    const makers = new Map();
    for (const l of g.leden) if (l.sleutel === g.canoniekeSleutel && l.maker && !isSloganOfCast(l.maker)) makers.set(l.maker, (makers.get(l.maker) ?? 0) + l.n);
    const maker = [...makers].sort((p, q) => q[1] - p[1] || p[0].localeCompare(q[0]))[0]?.[0] ?? null;
    const items = voorstel.gebruikersItems.filter((i) => g.sleutels.includes(i.sleutel));
    const gesplitst = splits(g.canoniek, g.leden);
    return {
      id: g.anker,
      canoniek: g.canoniek,
      canoniekeSleutel: g.canoniekeSleutel,
      titel: gesplitst.titel,
      maker: gesplitst.maker ?? maker,
      gesplitst: gesplitst.maker !== null,
      volgordeTwijfel: gesplitst.volgordeTwijfel,
      soorten: g.soorten,
      twijfel: g.twijfel,
      items,
      aantalTheaters: new Set(g.leden.map((l) => l.theater)).size,
      varianten: [...varianten.values()].sort((p, q) => q.theaters.length - p.theaters.length || p.titel.localeCompare(q.titel)),
    };
  })
  .sort((p, q) => Number(q.items.length > 0) - Number(p.items.length > 0) || q.aantalTheaters - p.aantalTheaters || p.canoniek.localeCompare(q.canoniek));

const data = { gemaakt: voorstel.gemaakt, bron: voorstel.bron, soorten: SOORTEN, theaterNamen, groepen };
const json = JSON.stringify(data).replace(/</g, '\\u003c');

const html = `<!doctype html>
<html lang="nl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Aliassen afvinken</title>
<style>
:root {
  --bg: #f6f5f2; --card: #ffffff; --text: #1d1d1b; --text-2: #5f5e58; --line: #e2e0d9;
  --accent: #2f5d8a; --accent-bg: #e7eef6; --warn: #8a5a00; --warn-bg: #fbf1dc;
  --ok: #2e6b3a; --ok-bg: #e4f1e6; --no: #8b2f2f; --no-bg: #f6e3e3; --user: #6b3f8f; --user-bg: #efe6f6;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --bg: #161615; --card: #21211f; --text: #ecebe6; --text-2: #a7a59d; --line: #3a3935;
    --accent: #8db8e3; --accent-bg: #23303d; --warn: #e6b65c; --warn-bg: #3a2f1a;
    --ok: #8fd19c; --ok-bg: #1f3324; --no: #f0a0a0; --no-bg: #3b2222; --user: #cfa8ee; --user-bg: #2f2439;
  }
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); font: 15px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; }
header { position: sticky; top: 0; z-index: 2; background: var(--bg); border-bottom: 1px solid var(--line); padding: 12px 16px; }
header h1 { font-size: 18px; margin: 0 0 4px; }
.balk { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-top: 8px; }
.balk input[type=search] { flex: 1 1 200px; min-width: 0; padding: 6px 10px; border: 1px solid var(--line); border-radius: 8px; background: var(--card); color: var(--text); font: inherit; }
.balk select, .balk button { padding: 6px 10px; border: 1px solid var(--line); border-radius: 8px; background: var(--card); color: var(--text); font: inherit; cursor: pointer; }
.balk button.hoofd { background: var(--accent); color: var(--card); border-color: var(--accent); }
.voortgang { color: var(--text-2); font-size: 13px; }
main { max-width: 980px; margin: 0 auto; padding: 16px; }
.groep { background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 14px 16px; margin-bottom: 14px; }
.groep.samenvoegen { border-left: 5px solid var(--ok); }
.groep.niet { border-left: 5px solid var(--no); }
.groep.andere { border-left: 5px solid var(--accent); }
.kop { display: flex; flex-wrap: wrap; gap: 6px 10px; align-items: baseline; }
.kop h2 { font-size: 16px; margin: 0; }
.kop .maker { color: var(--text-2); }
.nr { color: var(--text-2); font-size: 12px; margin-left: auto; }
.labels { display: flex; flex-wrap: wrap; gap: 6px; margin: 8px 0; }
.label { font-size: 12px; padding: 1px 8px; border-radius: 999px; background: var(--accent-bg); color: var(--accent); }
.label.gebruiker { background: var(--user-bg); color: var(--user); font-weight: 600; }
.twijfel { background: var(--warn-bg); color: var(--warn); border-radius: 8px; padding: 6px 10px; margin: 8px 0; font-size: 14px; }
.twijfel ul { margin: 0; padding-left: 18px; }
.tabel { width: 100%; overflow-x: auto; }
table { border-collapse: collapse; width: 100%; font-size: 14px; }
th, td { text-align: left; vertical-align: top; padding: 6px 8px; border-top: 1px solid var(--line); }
th { color: var(--text-2); font-weight: 500; font-size: 12px; }
td.titel { font-weight: 500; }
tr.canoniek td.titel::before { content: "= "; color: var(--ok); }
.data { color: var(--text-2); font-size: 13px; }
.keuze { display: flex; flex-wrap: wrap; gap: 8px 14px; align-items: center; margin-top: 10px; padding-top: 10px; border-top: 1px dashed var(--line); }
.keuze label { display: inline-flex; gap: 6px; align-items: center; cursor: pointer; }
.keuze input[type=text] { flex: 1 1 220px; min-width: 0; padding: 5px 8px; border: 1px solid var(--line); border-radius: 6px; background: var(--bg); color: var(--text); font: inherit; }
.keuze input[type=text]:disabled { opacity: .5; }
.keuze .wis { margin-left: auto; background: none; border: none; color: var(--text-2); text-decoration: underline; cursor: pointer; font: inherit; font-size: 13px; }
.leeg { color: var(--text-2); text-align: center; padding: 40px 0; }
@media (max-width: 640px) {
  thead { display: none; }
  table, tbody, tr, td { display: block; width: 100%; }
  tr { border-top: 1px solid var(--line); padding: 6px 0; }
  td { border: none; padding: 2px 0; }
  td[data-k]::before { content: attr(data-k) ": "; color: var(--text-2); font-size: 12px; }
}
</style>
</head>
<body>
<header>
  <h1>Aliassen afvinken</h1>
  <div class="voortgang" id="voortgang"></div>
  <div class="balk">
    <input type="search" id="zoek" placeholder="Zoek op titel, maker of theater" aria-label="Zoeken">
    <select id="filter" aria-label="Filter">
      <option value="alle">Alle groepen</option>
      <option value="open">Zonder keuze</option>
      <option value="gekozen">Met keuze</option>
      <option value="gebruikers">Met items van Marla/Erik</option>
    </select>
    <button class="hoofd" id="exporteer" type="button">Exporteer</button>
  </div>
</header>
<main id="lijst"></main>
<script type="application/json" id="data">${json}</script>
<script>
const DATA = JSON.parse(document.getElementById('data').textContent);
const OPSLAG = 'podiumagenda-alias-afvinken-v1';
let keuzes = {};
try { keuzes = JSON.parse(localStorage.getItem(OPSLAG) || '{}') || {}; } catch { keuzes = {}; }
const bewaar = () => { try { localStorage.setItem(OPSLAG, JSON.stringify(keuzes)); } catch {} };

const MAANDEN = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];
const kort = (d) => Number(d.slice(8, 10)) + ' ' + MAANDEN[Number(d.slice(5, 7)) - 1] + ' ' + d.slice(2, 4);
const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const naam = (id) => DATA.theaterNamen[id] || id;

function dataTekst(data) {
  if (!data.length) return '–';
  const lijst = data.slice(0, 6).map(kort).join(', ');
  return data.length + '× · ' + lijst + (data.length > 6 ? ' … (+' + (data.length - 6) + ')' : '');
}

function kaart(g, i) {
  const k = keuzes[g.id] || {};
  const klasse = k.keuze === 'samenvoegen' ? 'samenvoegen' : k.keuze === 'niet samenvoegen' ? 'niet' : k.keuze === 'andere naam' ? 'andere' : '';
  const naamVeld = 'k' + i;
  const items = g.items.map((it) => '<span class="label gebruiker">' + esc(it.wie) + ': ' + esc(it.veld) + (it.titel ? ' “' + esc(it.titel) + '”' : '') + '</span>').join('');
  const soorten = g.soorten.map((s) => '<span class="label">' + esc(s) + ' · ' + esc(DATA.soorten[s] || s) + '</span>').join('');
  const rijen = g.varianten.map((v) => '<tr class="' + (v.sleutel === g.canoniekeSleutel ? 'canoniek' : '') + '">'
    + '<td class="titel" data-k="Titel">' + esc(v.titel) + '</td>'
    + '<td data-k="Maker">' + (v.maker ? esc(v.maker) : '<span class="data">–</span>') + '</td>'
    + '<td data-k="Theaters">' + v.theaters.map((t) => esc(naam(t))).join(', ') + '</td>'
    + '<td class="data" data-k="Speeldata">' + esc(dataTekst(v.data)) + '</td></tr>').join('');
  const radio = (waarde) => '<label><input type="radio" name="' + naamVeld + '" value="' + waarde + '"' + (k.keuze === waarde ? ' checked' : '') + '> ' + waarde[0].toUpperCase() + waarde.slice(1) + '</label>';
  return '<section class="groep ' + klasse + '" data-id="' + esc(g.id) + '">'
    + '<div class="kop"><h2>' + esc(g.titel) + '</h2><span class="maker">' + (g.maker ? 'maker: ' + esc(g.maker) : 'geen maker') + '</span><span class="nr">' + g.aantalTheaters + ' theaters</span></div>'
    + '<div class="labels">' + items + soorten + '</div>'
    + '<div class="twijfel"><strong>Twijfel</strong><ul>' + g.twijfel.map((t) => '<li>' + esc(t) + '</li>').join('')
    + (g.volgordeTwijfel === 'andersom' ? '<li>titel en maker: elders staat het andersom (“' + esc(g.titel) + '” als maker of losse titel) — kijk na wie de maker is</li>' : '')
    + (g.volgordeTwijfel === 'onbevestigd' ? '<li>titel en maker: “' + esc(g.maker) + '” is bij geen variant maker — misschien een ondertitel, kijk na</li>' : '') + '</ul></div>'
    + '<div class="tabel"><table><thead><tr><th>Titel (= voorstel)</th><th>Maker</th><th>Theaters</th><th>Speeldata</th></tr></thead><tbody>' + rijen + '</tbody></table></div>'
    + '<div class="keuze">' + radio('samenvoegen') + radio('niet samenvoegen') + radio('andere naam')
    + '<input type="text" data-veld="titel" placeholder="Titel" aria-label="Andere naam: titel" value="' + esc(k.titel ?? k.naam ?? '') + '"' + (k.keuze === 'andere naam' ? '' : ' disabled') + '>'
    + '<input type="text" data-veld="maker" placeholder="Maker (leeg = geen)" aria-label="Andere naam: maker" value="' + esc(k.maker ?? '') + '"' + (k.keuze === 'andere naam' ? '' : ' disabled') + '>'
    + '<button type="button" class="wis">Wis keuze</button></div>'
    + '</section>';
}

function zichtbaar(g) {
  const f = document.getElementById('filter').value;
  const k = keuzes[g.id];
  if (f === 'open' && k) return false;
  if (f === 'gekozen' && !k) return false;
  if (f === 'gebruikers' && !g.items.length) return false;
  const q = document.getElementById('zoek').value.trim().toLowerCase();
  if (!q) return true;
  return [g.canoniek, g.titel, g.maker, ...g.varianten.flatMap((v) => [v.titel, v.maker, ...v.theaters.map(naam)])].some((t) => String(t ?? '').toLowerCase().includes(q));
}

function teken() {
  const lijst = document.getElementById('lijst');
  const html = DATA.groepen.map((g, i) => (zichtbaar(g) ? kaart(g, i) : '')).join('');
  lijst.innerHTML = html || '<p class="leeg">Geen groepen bij dit filter.</p>';
  voortgang();
}

function voortgang() {
  const n = DATA.groepen.filter((g) => keuzes[g.id]).length;
  const tel = (w) => DATA.groepen.filter((g) => keuzes[g.id]?.keuze === w).length;
  document.getElementById('voortgang').textContent = n + ' van ' + DATA.groepen.length + ' twijfelgroepen beoordeeld (samenvoegen ' + tel('samenvoegen') + ', niet ' + tel('niet samenvoegen') + ', andere naam ' + tel('andere naam') + ') · data: ' + DATA.bron;
}

const groepVan = (el) => DATA.groepen.find((g) => g.id === el.closest('.groep').dataset.id);

document.getElementById('lijst').addEventListener('change', (e) => {
  if (e.target.type !== 'radio') return;
  const g = groepVan(e.target);
  const sectie = e.target.closest('.groep');
  const titelVeld = sectie.querySelector('input[data-veld=titel]');
  const makerVeld = sectie.querySelector('input[data-veld=maker]');
  const andere = e.target.value === 'andere naam';
  // Bij "andere naam" beginnen de velden met het voorstel.
  if (andere && !titelVeld.value.trim()) { titelVeld.value = g.titel; makerVeld.value = g.maker ?? ''; }
  keuzes[g.id] = { keuze: e.target.value, ...(andere ? { titel: titelVeld.value.trim() || g.titel, maker: makerVeld.value.trim() || null } : {}) };
  titelVeld.disabled = !andere;
  makerVeld.disabled = !andere;
  sectie.classList.remove('samenvoegen', 'niet', 'andere');
  sectie.classList.add({ samenvoegen: 'samenvoegen', 'niet samenvoegen': 'niet', 'andere naam': 'andere' }[e.target.value]);
  bewaar();
  voortgang();
});
document.getElementById('lijst').addEventListener('input', (e) => {
  if (e.target.type !== 'text') return;
  const g = groepVan(e.target);
  if (keuzes[g.id]?.keuze !== 'andere naam') return;
  const sectie = e.target.closest('.groep');
  keuzes[g.id].titel = sectie.querySelector('input[data-veld=titel]').value.trim();
  keuzes[g.id].maker = sectie.querySelector('input[data-veld=maker]').value.trim() || null;
  delete keuzes[g.id].naam;
  bewaar();
});
document.getElementById('lijst').addEventListener('click', (e) => {
  if (!e.target.classList.contains('wis')) return;
  delete keuzes[groepVan(e.target).id];
  bewaar();
  teken();
});
document.getElementById('zoek').addEventListener('input', teken);
document.getElementById('filter').addEventListener('change', teken);

// Export: per beoordeelde groep bron → canoniek. "samenvoegen": elke variant
// met een andere sleutel dan het voorstel naar het voorstel; "andere naam":
// alle varianten naar de ingevulde titel en maker (sleutel volgt in stap B);
// canoniek = { titel, maker, weergave } met weergave "Titel – Maker";
// "niet samenvoegen" apart, zodat de groep niet opnieuw wordt voorgesteld.
document.getElementById('exporteer').addEventListener('click', () => {
  const aliassen = [];
  const nietSamenvoegen = [];
  for (const g of DATA.groepen) {
    const k = keuzes[g.id];
    if (!k) continue;
    if (k.keuze === 'niet samenvoegen') { nietSamenvoegen.push({ groep: g.id, sleutels: [...new Set(g.varianten.map((v) => v.sleutel))] }); continue; }
    const andere = k.keuze === 'andere naam';
    const titel = andere ? (k.titel || k.naam || g.titel) : g.titel;
    const maker = andere ? (k.maker ?? null) : g.maker;
    // Weergave: bij "samenvoegen" het voorstel zoals het in de data staat.
    const doel = { titel, maker, weergave: andere ? (maker ? titel + ' – ' + maker : titel) : g.canoniek };
    const bronnen = new Map();
    for (const v of g.varianten) {
      if (!andere && v.sleutel === g.canoniekeSleutel) continue;
      if (!bronnen.has(v.sleutel)) bronnen.set(v.sleutel, { bron: v.sleutel, titels: [], theaters: [] });
      const b = bronnen.get(v.sleutel);
      if (!b.titels.includes(v.titel)) b.titels.push(v.titel);
      for (const t of v.theaters) if (!b.theaters.includes(t)) b.theaters.push(t);
    }
    for (const b of bronnen.values()) {
      aliassen.push({ groep: g.id, keuze: k.keuze, bron: b.bron, bronTitels: b.titels, theaters: b.theaters, canoniek: doel, canoniekeSleutel: andere ? null : g.canoniekeSleutel });
    }
  }
  const uit = { gemaakt: new Date().toISOString(), voorstel: DATA.gemaakt, bron: DATA.bron, beoordeeld: Object.keys(keuzes).length, aliassen, nietSamenvoegen };
  const blob = new Blob([JSON.stringify(uit, null, 2) + '\\n'], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'alias-keuzes-' + new Date().toISOString().slice(0, 10) + '.json';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
});

teken();
</script>
</body>
</html>
`;

writeFileSync('debug/alias-afvinken.html', html);
console.log(`debug/alias-afvinken.html: ${groepen.length} twijfelgroepen, ${groepen.filter((g) => g.items.length).length} met items van Marla/Erik, ${groepen.filter((g) => g.gesplitst).length} voorstellen in titel en maker gesplitst (waarschuwing: ${groepen.filter((g) => g.volgordeTwijfel === 'andersom').length} elders andersom, ${groepen.filter((g) => g.volgordeTwijfel === 'onbevestigd').length} maker nergens bevestigd).`);
