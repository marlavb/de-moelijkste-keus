// `npm run alias-voorstel [-- --droog]`: R2/R3-aliassen (aliasVoorstel.js)
// uit debug/alias-voorstel.json in config/aliassen.json zetten. Afgevinkte
// keuzes blijven staan; eerdere R2/R3 worden opnieuw bepaald.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ALIASSEN_PAD, leesAliassen, controleer } from '../src/lib/aliassen.js';
import { voegVoorstelToe } from '../src/lib/aliasVoorstel.js';
import { lijktOpGezelschap } from '../src/lib/makerMeerderheid.js';
import { watchlistSleutel } from '../public/js/watchlist.js';

const droog = process.argv.includes('--droog');
const voorstel = JSON.parse(readFileSync('debug/alias-voorstel.json', 'utf-8'));
// Een bekende maker: maker (makerveld) van minstens twee producties, of hij
// lijkt op een gezelschap.
const shows = JSON.parse(readFileSync('public/data/shows.json', 'utf-8'));
const producties = new Map();
const k = (m) => String(m).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
for (const s of shows) {
  if (!s.maker) continue;
  if (!producties.has(k(s.maker))) producties.set(k(s.maker), new Set());
  producties.get(k(s.maker)).add(watchlistSleutel(s.titel, s.theaterId));
}
const isMaker = (m) => lijktOpGezelschap(m) || (producties.get(k(m))?.size ?? 0) >= 2;
const { lijst, overzicht } = voegVoorstelToe(leesAliassen(), voorstel, { isMaker });
for (const [kop, regels] of Object.entries(overzicht)) {
  console.log(`\n${kop}: ${regels.length}`);
  for (const r of regels) console.log(`  - ${r}`);
}
const meldingen = controleer(lijst);
if (meldingen.length) console.log('\nLET OP:\n  - ' + meldingen.join('\n  - '));
console.log(`\nTotaal: ${Object.keys(lijst.aliassen).length} aliassen.`);
if (!droog) writeFileSync(fileURLToPath(ALIASSEN_PAD), JSON.stringify(lijst, null, 1) + '\n');
