// Zet de git-hooks in .githooks/ aan (npm install / npm ci, via `prepare`).
// Niet in CI: daar zou de pre-push-hook de datapush van refresh-data
// weigeren (hij ziet de run zelf als lopend, en gh kan het daar niet
// vaststellen). Zo ging het mis op 14 en 15 okt 2026.

import { execFileSync } from 'node:child_process';

export function inCI(env = process.env) {
  return env.CI === 'true' || env.GITHUB_ACTIONS === 'true';
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (inCI()) {
    console.log('hooks-installeren: CI gedetecteerd (CI/GITHUB_ACTIONS=true) — git-hooks niet aangezet.');
  } else {
    try {
      execFileSync('git', ['config', 'core.hooksPath', '.githooks'], { stdio: 'ignore' });
      console.log('hooks-installeren: git-hooks aan (core.hooksPath = .githooks).');
    } catch {
      // Geen git-repo (bijv. een uitgepakt pakket): niets te doen.
      console.log('hooks-installeren: geen git-repo — git-hooks niet aangezet.');
    }
  }
}
