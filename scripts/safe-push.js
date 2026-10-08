// `npm run safe-push [-- <git push-argumenten>]`: pusht alleen als er geen
// refresh-data-run loopt of wacht én alle testsuites groen zijn
// (werkafspraken in CLAUDE.md). Volgorde: refresh-controle, `git pull
// --ff-only`, alle suites (scripts/testpoort.js; stopt bij de eerste die
// faalt), nog eens de refresh-controle (de tests duren minuten), dan `git
// push`. De pre-push-hook slaat de tests over voor precies deze commit
// (PODIUM_GETEST), zodat ze niet twee keer draaien.
// Met --dry-run alleen de refresh-controle.

import { execFileSync } from 'node:child_process';
import { controleerRefresh } from './refresh-check.js';
import { draaiPoort, SUITES } from './testpoort.js';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const pushArgs = args.filter((a) => a !== '--dry-run');

function refresh() {
  const { magPushen, reden } = controleerRefresh();
  if (!magPushen) {
    console.error(`✋ Push geweigerd: ${reden}`);
    process.exit(1);
  }
  console.log(`✓ ${reden}`);
}

refresh();
if (dryRun) process.exit(0);

execFileSync('git', ['pull', '--ff-only'], { stdio: 'inherit' });
const suites = process.env.TESTPOORT_SUITES_VOOR_TESTS ? JSON.parse(process.env.TESTPOORT_SUITES_VOOR_TESTS) : SUITES;
const poort = draaiPoort({ suites });
if (!poort.ok) {
  console.error(`✋ Push geweigerd: "${poort.mislukt}" faalt. Eerst alles groen.`);
  process.exit(1);
}
console.log('✓ alle testsuites groen');
refresh();
const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf-8' }).trim();
execFileSync('git', ['push', ...pushArgs], { stdio: 'inherit', env: { ...process.env, PODIUM_GETEST: head } });
