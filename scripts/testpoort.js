// Testpoort vóór elke push (okt 2026): alle suites na elkaar, en stoppen bij
// de eerste die faalt. Beslist op de exitcode van elke suite, nooit op tekst
// in de uitvoer. Aanleiding: op 8 okt 2026 ging een push door terwijl een
// unit-test faalde (de controle keek alleen óf er een samenvatting was).
// Gebruikt door scripts/safe-push.js en de pre-push-hook in .githooks/.
//
// Alleen voor de tests van dit script: TESTPOORT_SUITES_VOOR_TESTS (JSON,
// [[commando, [argumenten]], …]) vervangt de suites.

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const SUITES = [
  ['npm', ['test']],
  ['npm', ['run', 'test:rules']],
  ['npm', ['run', 'test:functions']],
  ['npm', ['run', 'test:e2e']],
];

const standaardUitvoer = (cmd, args) => spawnSync(cmd, args, { stdio: 'inherit' }).status ?? 1;

/** Draait de suites; geeft { ok, mislukt: 'npm run …' | null }. */
export function draaiPoort({ suites = SUITES, voerUit = standaardUitvoer, log = console.log } = {}) {
  for (const [cmd, args] of suites) {
    const naam = [cmd, ...args].join(' ');
    log(`▶ ${naam}`);
    const code = voerUit(cmd, args);
    if (code !== 0) return { ok: false, mislukt: naam };
  }
  return { ok: true, mislukt: null };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const suites = process.env.TESTPOORT_SUITES_VOOR_TESTS ? JSON.parse(process.env.TESTPOORT_SUITES_VOOR_TESTS) : SUITES;
  const r = draaiPoort({ suites });
  if (!r.ok) {
    console.error(`✋ Push geweigerd: "${r.mislukt}" faalt. Eerst alles groen.`);
    process.exit(1);
  }
  console.log('✓ alle testsuites groen');
}
