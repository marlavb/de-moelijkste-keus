// Pre-commit-check (.githooks/pre-commit, 13 okt 2026). Snel; de volledige
// testpoort (unit, rules, functions, e2e) blijft in `npm run safe-push`.
//
// 1. Weigert een commit met conflictmarkeringen (<<<<<<<, =======, >>>>>>>
//    aan het begin van een regel) in de gestagede inhoud. Waarom: op 12 okt
//    2026 ging een merge met markeringen in styles.css bijna mee.
// 2. Draait snelle unit-tests: die bij de gewijzigde bestanden horen
//    (src/sites/x.js, src/lib/x.js, public/js/x.js, functions/x.js →
//    test/x.test.js, en gewijzigde testbestanden zelf), anders de snelle
//    suite (alles in test/ behalve de UI-tests: *-ui.test.js en
//    navigatie.test.js; ~12 s). Alleen documentatie gewijzigd: geen tests.
//
// Overslaan alleen in noodgevallen: PODIUM_GEEN_PRECOMMIT=1 git commit …
// (zie CLAUDE.md). Een gewone fout los je op, je slaat hem niet over.

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';

const { vindMarkering } = await import(new URL('../src/lib/conflictMarkering.js', import.meta.url));

const top = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
process.chdir(top);

if (process.env.PODIUM_GEEN_PRECOMMIT === '1') {
  console.log('⚠ pre-commit-check overgeslagen (PODIUM_GEEN_PRECOMMIT=1) — alleen in noodgevallen.');
  process.exit(0);
}

const gestaged = execFileSync('git', ['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z'], { encoding: 'utf8' })
  .split('\0')
  .filter(Boolean);
if (!gestaged.length) process.exit(0);

// 1. Conflictmarkeringen in de gestagede inhoud (niet in de werkmap).
const BINAIR = /\.(png|jpe?g|gif|webp|ico|pdf|woff2?|ttf|zip|gz)$/i;
const fout = [];
for (const f of gestaged) {
  if (BINAIR.test(f)) continue;
  let inhoud;
  try {
    inhoud = execFileSync('git', ['show', `:${f}`], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  } catch {
    continue;
  }
  const m = vindMarkering(inhoud, f);
  if (m) fout.push(`${f}:${m.regel}: ${m.tekst.slice(0, 40)}`);
}
if (fout.length) {
  console.error('✋ Commit geweigerd: conflictmarkeringen in gestagede bestanden:');
  for (const r of fout) console.error(`   ${r}`);
  console.error('   Los het conflict op en stage opnieuw.');
  process.exit(1);
}

// 2. Snelle tests.
const ALLEEN_TEKST = /\.(md|txt)$|^docs\/|^debug\//;
const code = gestaged.filter((f) => !ALLEEN_TEKST.test(f));
if (!code.length) {
  console.log('✓ geen conflictmarkeringen; alleen documentatie gewijzigd, geen tests.');
  process.exit(0);
}

const isUiTest = (f) => /-ui\.test\.js$|\/navigatie\.test\.js$/.test(f);
const alleTests = readdirSync('test').filter((f) => f.endsWith('.test.js')).map((f) => `test/${f}`);
const snel = alleTests.filter((f) => !isUiTest(f));

function testsVoor(f) {
  if (/^test\/.*\.test\.js$/.test(f)) return isUiTest(f) ? [] : [f];
  const m = /^(?:src\/sites|src\/lib|public\/js|functions)\/([^/]+)\.js$/.exec(f);
  if (!m) return null;
  const t = `test/${m[1]}.test.js`;
  return existsSync(t) ? [t] : null;
}
const gericht = code.map(testsVoor);
const bestanden = gericht.every((t) => t !== null) ? [...new Set(gericht.flat())] : snel;
const soort = bestanden === snel ? `snelle suite (${snel.length} bestanden, zonder UI-tests)` : `${bestanden.length} bijbehorende test(s)`;
if (!bestanden.length) {
  console.log('✓ geen conflictmarkeringen; geen snelle tests bij deze wijziging.');
  process.exit(0);
}
console.log(`pre-commit: ${soort} …`);
const start = Date.now();
const r = spawnSync(process.execPath, ['--test', '--test-reporter=dot', ...bestanden], { stdio: 'inherit', timeout: 60_000 });
const duur = Math.round((Date.now() - start) / 1000);
if (r.status !== 0) {
  console.error(`✋ Commit geweigerd: tests falen (${duur} s). Zie hierboven.`);
  process.exit(1);
}
console.log(`✓ geen conflictmarkeringen; ${soort} groen (${duur} s).`);
