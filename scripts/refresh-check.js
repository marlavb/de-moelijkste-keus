// Controle vóór elke push: loopt er een refresh-data-run, of staat er een
// in de wachtrij? Dan niet pushen (werkafspraak in CLAUDE.md). Gebruikt door
// scripts/safe-push.js en de pre-push-hook in .githooks/.
//
// Faalt de controle zelf (gh niet geïnstalleerd, niet ingelogd, geen
// netwerk), dan weigeren we ook: liever een keer te voorzichtig.
//
// Voor tests: SAFE_PUSH_GH wijst naar een ander commando dan `gh`.

import { execFileSync } from 'node:child_process';

// Alle statussen waarin een run nog niet klaar is.
export const LOPENDE_STATUSSEN = ['in_progress', 'queued', 'waiting', 'pending', 'requested'];

export function ghRuns(status, { gh = process.env.SAFE_PUSH_GH || 'gh' } = {}) {
  const uit = execFileSync(
    gh,
    ['run', 'list', '--workflow', 'refresh-data.yml', '--status', status, '--limit', '20', '--json', 'databaseId,status,createdAt,event,url'],
    { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] }
  );
  return JSON.parse(uit || '[]');
}

/** { magPushen, reden, runs } — runs: de runs die nog niet klaar zijn. */
export function controleerRefresh({ haalRuns = ghRuns } = {}) {
  let runs;
  try {
    runs = LOPENDE_STATUSSEN.flatMap((status) => haalRuns(status));
  } catch (err) {
    return {
      magPushen: false,
      reden: `kon niet vaststellen of refresh-data loopt (${String(err.message).split('\n')[0]}). Controleer gh (gh auth status) en probeer opnieuw.`,
      runs: [],
    };
  }
  if (runs.length === 0) return { magPushen: true, reden: 'geen refresh-data-run bezig of in de wachtrij', runs };
  const lijst = runs.map((r) => `  - ${r.status} (${r.event}, gestart ${r.createdAt}) ${r.url ?? ''}`).join('\n');
  return {
    magPushen: false,
    reden: `refresh-data loopt of staat in de wachtrij — niet pushen tot die klaar is:\n${lijst}`,
    runs,
  };
}

// Als los script (pre-push-hook): exitcode 1 als pushen niet mag.
if (import.meta.url === `file://${process.argv[1]}`) {
  const { magPushen, reden } = controleerRefresh();
  if (!magPushen) {
    console.error(`✋ Push geweigerd: ${reden}`);
    process.exit(1);
  }
}
