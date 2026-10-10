// `npm run alias-voorstel-maken [-- --shows=<bestand>] [--vandaag=JJJJ-MM-DD]`:
// maakt debug/alias-voorstel.json (src/lib/aliasGroepen.js) uit de huidige
// public/data/shows.json (al nabewerkt, dus mét de aliaslijst). Daarna:
// `npm run alias-afvinkpagina`. De items van Marla en Erik (voor de volgorde
// en de markering op de afvinkpagina) komen uit debug/alias-gebruikers.json,
// als dat bestand er is (`npm run alias-gebruikers`, alleen lezen).

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { maakGroepen, maakVoorstel } from '../src/lib/aliasGroepen.js';
import { todayIsoDate } from '../src/lib/normalize.js';

const arg = (naam) => process.argv.find((a) => a.startsWith(`--${naam}=`))?.split('=').slice(1).join('=');
const bron = arg('shows') ?? 'public/data/shows.json';
const vandaag = arg('vandaag') ?? todayIsoDate();
const data = JSON.parse(readFileSync(bron, 'utf-8'));
const shows = Array.isArray(data) ? data : data.shows;

const groepen = maakGroepen(shows, { vandaag });
const { resultaat } = maakVoorstel(groepen, shows);
const gebruikersItems = existsSync('debug/alias-gebruikers.json') ? JSON.parse(readFileSync('debug/alias-gebruikers.json', 'utf-8')) : [];
mkdirSync('debug', { recursive: true });
writeFileSync('debug/alias-voorstel.json', JSON.stringify({ gemaakt: vandaag, bron: `${bron} (${vandaag})`, groepen: resultaat, gebruikersItems }, null, 1) + '\n');
const twijfel = resultaat.filter((g) => g.twijfel.length).length;
console.log(`debug/alias-voorstel.json: ${resultaat.length} groepen (${twijfel} met twijfel, ${resultaat.length - twijfel} zonder); ${gebruikersItems.length} gebruikersitems${existsSync('debug/alias-gebruikers.json') ? '' : ' (geen debug/alias-gebruikers.json)'}.`);
console.log('Daarna: npm run alias-afvinkpagina');
