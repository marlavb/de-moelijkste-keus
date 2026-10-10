// `npm run alias-gebruikers -- Marla=<uid> Erik=<uid>`: leest (alleen lezen)
// de watchlist- en Gezien-items van deze gebruikers uit Firestore en schrijft
// debug/alias-gebruikers.json (niet in git) voor de afvinkpagina. Gebruikt het
// token van `gcloud auth print-access-token` (je eigen login); de uid's komen
// alleen van de opdrachtregel en worden niet bewaard.

import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';

const PROJECT = 'de-moeilijkste-keus';
const paren = process.argv.slice(2).map((a) => a.split('=')).filter(([n, u]) => n && u);
if (!paren.length) {
  console.error('Gebruik: npm run alias-gebruikers -- Marla=<uid> Erik=<uid>');
  process.exit(1);
}
const token = execFileSync('gcloud', ['auth', 'print-access-token'], { encoding: 'utf-8' }).trim();
const waarde = (v) =>
  v == null ? v
  : 'stringValue' in v ? v.stringValue
  : 'integerValue' in v ? Number(v.integerValue)
  : 'arrayValue' in v ? (v.arrayValue.values ?? []).map(waarde)
  : 'mapValue' in v ? Object.fromEntries(Object.entries(v.mapValue.fields ?? {}).map(([k, x]) => [k, waarde(x)]))
  : null;
const items = [];
for (const [wie, uid] of paren) {
  const r = await fetch(`https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/users/${uid}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error(`users/${wie}: HTTP ${r.status}`);
  const velden = Object.fromEntries(Object.entries((await r.json()).fields ?? {}).map(([k, v]) => [k, waarde(v)]));
  for (const veld of ['watchlist', 'watchlistVerwijderd', 'gezien', 'gezienVerwijderd']) {
    for (const it of velden[veld] ?? []) if (it?.sleutel) items.push({ wie, veld, titel: it.titel ?? '', sleutel: it.sleutel });
  }
}
mkdirSync('debug', { recursive: true });
writeFileSync('debug/alias-gebruikers.json', JSON.stringify(items, null, 1) + '\n');
console.log(`debug/alias-gebruikers.json: ${items.length} items van ${paren.map(([w]) => w).join(', ')}.`);
