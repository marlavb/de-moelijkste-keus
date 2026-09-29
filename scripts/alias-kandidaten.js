// `npm run alias-kandidaten`: zoekt in public/data/shows.json paren
// watchlist-sleutels die waarschijnlijk dezelfde voorstelling zijn (zie
// src/lib/aliasKandidaten.js) en schrijft een afvinklijst naar
// debug/alias-kandidaten.md. Voegt zelf niets samen.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { vindKandidaten } from '../src/lib/aliasKandidaten.js';
import { zonderRuis } from '../public/js/watchlist.js';
import { normalizeTitle } from '../public/js/productions.js';

const shows = JSON.parse(readFileSync('public/data/shows.json', 'utf-8'));
const theaterNamen = new Map(shows.map((s) => [s.theaterId, s.theaterNaam]));
const MAANDEN = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];
const kortDatum = (iso) => `${Number(iso.slice(8, 10))} ${MAANDEN[Number(iso.slice(5, 7)) - 1]}`;
const SCHEIDING = /\s+[–—-]\s+|\s+\|\s+|:\s+/;

// Meest gebruikte schrijfwijze van een sleutel, en daarin het gevraagde deel.
function weergave(x) {
  const tel = new Map();
  for (const s of x.shows) tel.set(s.titel, (tel.get(s.titel) ?? 0) + 1);
  return [...tel].sort((p, q) => q[1] - p[1] || p[0].localeCompare(q[0]))[0][0];
}
// De schrijfwijze van één deel zoals de theaters hem gebruiken: de meest
// voorkomende, en liever niet in hoofdletters ("Rüdsichtslos", niet
// "RÜDSICHTSLOS"). Het "&" blijft zoals de bron het schrijft.
function deelInWeergave(x, deel) {
  const tel = new Map();
  for (const s of x.shows) {
    for (const p of s.titel.split(SCHEIDING).map((q) => q.trim())) {
      if (normalizeTitle(zonderRuis(p)) !== deel) continue;
      const schoon = p.replace(/\s*\((?:reprise|try-?out|premi[eè]re|derni[eè]re)\)\s*$/i, '').trim();
      tel.set(schoon, (tel.get(schoon) ?? 0) + 1);
    }
  }
  const kapitalen = (t) => t === t.toUpperCase() && /\p{Lu}/u.test(t);
  const beste = [...tel].sort((a, b) => kapitalen(a[0]) - kapitalen(b[0]) || b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? deel;
  // Alleen hoofdletters beschikbaar: "RÜDSICHTSLOS" → "Rüdsichtslos".
  return kapitalen(beste) ? beste.charAt(0) + beste.slice(1).toLowerCase() : beste;
}
function kant(x) {
  const theaters = [...new Set(x.shows.map((s) => s.theaterId))].map((t) => theaterNamen.get(t) ?? t);
  const data = [...x.shows].sort((p, q) => p.datum.localeCompare(q.datum)).slice(0, 3).map((s) => `${theaterNamen.get(s.theaterId)} ${kortDatum(s.datum)}`);
  return { titel: weergave(x), theaters, data };
}

const SOORTEN = {
  spelling: { kop: 'Spelling (kleine bewerkingsafstand)', twijfel: null },
  lidwoord: { kop: 'Lidwoord ("De Broers van Arkel" / "Broers van Arkel")', twijfel: null },
  jaartal: { kop: 'Jaartal of editie', twijfel: 'met jaartal: dit seizoen waarschijnlijk dezelfde, maar een alias geldt ook volgend jaar — alleen als specifieke alias, en na dit seizoen opruimen' },
  toevoeging: { kop: 'Toevoeging ("en Friends", "derniere", "live" …)', twijfel: 'kan een andere voorstelling zijn dan zonder de toevoeging' },
};

const paren = vindKandidaten(shows);
let md = `# Alias-kandidaten\n\nGegenereerd ${new Date().toISOString()} uit public/data/shows.json. Niet committen.\n\n`;
md += `Vink aan wat samengevoegd mag worden (\`[x]\`); pas zo nodig de schrijfwijze achter "→ voorstel:" aan. `;
md += `Een alias werkt op het niveau van één deel van de titel (variant → canoniek), voor alle theaters.\n\n`;
md += `Voorstel = de schrijfwijze bij de meeste theaters, dan de meeste speeldata, dan alfabetisch. ⚠ = twijfel, met de reden.\n\n`;
let totaal = 0;
for (const [soort, { kop, twijfel }] of Object.entries(SOORTEN)) {
  const lijst = paren.filter((p) => p.soort === soort);
  if (!lijst.length) continue;
  md += `## ${kop} (${lijst.length})\n\n`;
  for (const p of lijst.sort((x, y) => x.a.sleutel.localeCompare(y.a.sleutel))) {
    const A = kant(p.a), B = kant(p.b);
    // Voorstel: meeste theaters, dan meeste speeldata, dan alfabetisch.
    const [canon] = [[p.a, p.deelA, A], [p.b, p.deelB, B]].sort(
      (x, y) => y[2].theaters.length - x[2].theaters.length || y[0].shows.length - x[0].shows.length || x[1].localeCompare(y[1])
    );
    const voorstel = deelInWeergave(canon[0], canon[1]);
    const redenen = [];
    if (twijfel) redenen.push(twijfel);
    if (soort === 'spelling' && Math.min(p.deelA.length, p.deelB.length) < 8) redenen.push('kort deel, kleine afwijking kan een ander woord zijn');
    md += `- [ ] ${A.titel} (${A.theaters.join(', ')}) ⇄ ${B.titel} (${B.theaters.join(', ')}) → voorstel: ${voorstel}${redenen.length ? `  ⚠ ${redenen.join('; ')}` : ''}\n`;
    md += `  - speeldata: ${A.data.join(', ')} ⇄ ${B.data.join(', ')}\n`;
    totaal++;
  }
  md += '\n';
}
mkdirSync('debug', { recursive: true });
writeFileSync('debug/alias-kandidaten.md', md);
console.log(`${totaal} kandidaat-paren → debug/alias-kandidaten.md (${Object.keys(SOORTEN).map((s) => `${s} ${paren.filter((p) => p.soort === s).length}`).join(', ')})`);
