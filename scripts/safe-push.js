// `npm run safe-push [-- <git push-argumenten>]`: pusht alleen als er geen
// refresh-data-run loopt of wacht, en doet eerst `git pull --ff-only`
// (werkafspraken in CLAUDE.md). Met --dry-run alleen de controle.

import { execFileSync } from 'node:child_process';
import { controleerRefresh } from './refresh-check.js';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const pushArgs = args.filter((a) => a !== '--dry-run');

const { magPushen, reden } = controleerRefresh();
if (!magPushen) {
  console.error(`✋ Push geweigerd: ${reden}`);
  process.exit(1);
}
console.log(`✓ ${reden}`);
if (dryRun) process.exit(0);

execFileSync('git', ['pull', '--ff-only'], { stdio: 'inherit' });
execFileSync('git', ['push', ...pushArgs], { stdio: 'inherit' });
