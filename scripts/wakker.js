// De Mac wakker houden zolang safe-push loopt (testpoort + push, minuten).
// Waarom: op 13 okt 2026 sliep de Mac tijdens de testpoort; twee UI-tests
// hingen 15 minuten en safe-push weigerde. `caffeinate -i -w <pid>` houdt
// het systeem wakker en stopt vanzelf als dat proces klaar is. Alleen op
// macOS en als caffeinate bestaat; op Linux/CI gebeurt er niets.

import { spawn as spawnStandaard } from 'node:child_process';
import { existsSync } from 'node:fs';

export const CAFFEINATE = '/usr/bin/caffeinate';

/** Geeft true als caffeinate is gestart. */
export function houWakker({ platform = process.platform, bestaat = existsSync, spawn = spawnStandaard, pid = process.pid } = {}) {
  if (platform !== 'darwin' || !bestaat(CAFFEINATE)) return false;
  try {
    const kind = spawn(CAFFEINATE, ['-i', '-w', String(pid)], { stdio: 'ignore', detached: true });
    kind.on?.('error', () => {});
    kind.unref?.();
    return true;
  } catch {
    return false;
  }
}
