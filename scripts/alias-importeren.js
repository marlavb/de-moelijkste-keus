// `npm run alias-importeren -- <export.json> [--droog]`: een export van de
// afvinkpagina (alias-keuzes-<datum>.json) samenvoegen met config/aliassen.json.
// Nieuwe keuzes komen erbij, een groep die opnieuw is beoordeeld krijgt de
// nieuwe keuze (de oude aliassen van die groep vervallen). Toont wat er
// verandert; met --droog wordt er niets geschreven.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ALIASSEN_PAD, leesAliassen, controleer } from '../src/lib/aliassen.js';
import { voegExportSamen } from '../src/lib/aliasImport.js';

const args = process.argv.slice(2);
const droog = args.includes('--droog');
const bestand = args.find((a) => !a.startsWith('--'));
if (!bestand) {
  console.error('Gebruik: npm run alias-importeren -- <alias-keuzes-….json> [--droog]');
  process.exit(1);
}

const exp = JSON.parse(readFileSync(bestand, 'utf-8'));
// Hele titels per sleutel in de huidige data: een voorstelmaker die elders de
// titel van een andere productie is, nemen we niet over (aliasImport.js).
const { watchlistSleutel, zonderRuis } = await import('../public/js/watchlist.js');
const kaal = (t) => zonderRuis(String(t ?? '')).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const titels = new Map();
for (const s of JSON.parse(readFileSync('public/data/shows.json', 'utf-8'))) {
  for (const t of [s.titel, s.titelBron, s.titelVoorAlias].filter(Boolean)) {
    if (!titels.has(kaal(t))) titels.set(kaal(t), new Set());
    titels.get(kaal(t)).add(watchlistSleutel(s.titel, s.theaterId));
  }
}
const isTitelElders = (maker, doel) => [...(titels.get(kaal(maker)) ?? [])].some((k) => k !== doel);
const { lijst, overzicht } = voegExportSamen(leesAliassen(), exp, { isTitelElders });
const toon = (kop, regels) => {
  console.log(`\n${kop}: ${regels.length}`);
  for (const r of regels) console.log(`  - ${r}`);
};
console.log(`Export: ${exp.beoordeeld ?? '?'} groepen beoordeeld (${bestand})`);
toon('Nieuw', overzicht.nieuw);
toon('Gewijzigd', overzicht.gewijzigd);
toon('Verwijderd', overzicht.verwijderd);
toon('Conflicten (bron met twee doelen, niet opgenomen)', overzicht.conflicten);
toon('Ketens opgelost', overzicht.ketens);
if (overzicht.eenProductie) toon('Zelfde titel → één productie', overzicht.eenProductie);
console.log(`\nOngewijzigd: ${overzicht.gelijk}. Totaal na import: ${Object.keys(lijst.aliassen).length} aliassen, ${lijst.nietSamenvoegen.length} groepen "niet samenvoegen".`);
const meldingen = controleer(lijst);
if (meldingen.length) toon('LET OP', meldingen);
if (droog) {
  console.log('\n--droog: niets geschreven.');
} else {
  writeFileSync(fileURLToPath(ALIASSEN_PAD), JSON.stringify(lijst, null, 1) + '\n');
  console.log(`\nGeschreven: ${fileURLToPath(ALIASSEN_PAD)}. Daarna: npm run alias-afvinkpagina (beoordeelde groepen staan dan als "in aliaslijst").`);
}
