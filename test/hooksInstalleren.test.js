import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inCI } from '../scripts/hooks-installeren.js';

const script = new URL('../scripts/hooks-installeren.js', import.meta.url).pathname;
const zonderCI = Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'CI' && k !== 'GITHUB_ACTIONS'));

function nieuweRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'hooks-'));
  execFileSync('git', ['init', '--quiet'], { cwd: dir });
  return dir;
}
const hooksPath = (dir) => {
  try { return execFileSync('git', ['config', '--local', 'core.hooksPath'], { cwd: dir, encoding: 'utf-8' }).trim(); } catch { return null; }
};

test('inCI: CI of GITHUB_ACTIONS = "true"', () => {
  assert.equal(inCI({ CI: 'true' }), true);
  assert.equal(inCI({ GITHUB_ACTIONS: 'true' }), true);
  assert.equal(inCI({}), false);
  assert.equal(inCI({ CI: 'false' }), false);
});

test('hooks-installeren: lokaal aan, in CI niet (14 okt 2026)', () => {
  const lokaal = nieuweRepo();
  execFileSync('node', [script], { cwd: lokaal, env: zonderCI });
  assert.equal(hooksPath(lokaal), '.githooks');

  for (const env of [{ CI: 'true' }, { GITHUB_ACTIONS: 'true' }]) {
    const ci = nieuweRepo();
    const uit = execFileSync('node', [script], { cwd: ci, env: { ...zonderCI, ...env }, encoding: 'utf-8' });
    assert.equal(hooksPath(ci), null);
    assert.match(uit, /CI gedetecteerd/);
  }
});

test('hooks stoppen direct in GitHub Actions', () => {
  for (const hook of ['pre-commit', 'pre-push']) {
    const pad = new URL(`../.githooks/${hook}`, import.meta.url).pathname;
    const regels = readFileSync(pad, 'utf-8').split('\n');
    const stop = regels.findIndex((r) => r.includes('"$GITHUB_ACTIONS" = "true"') && r.includes('exit 0'));
    const node = regels.findIndex((r) => /\bnode\b/.test(r) && !r.startsWith('#'));
    assert.ok(stop >= 0 && stop < node, `${hook}: GITHUB_ACTIONS-stop vóór de eerste node-aanroep`);
    // En echt uitvoeren: met GITHUB_ACTIONS=true meteen exit 0, ook buiten een repo.
    execFileSync('sh', [pad], { cwd: tmpdir(), env: { ...zonderCI, GITHUB_ACTIONS: 'true' } });
  }
});

test('workflows die pushen halen core.hooksPath weg', () => {
  for (const wf of ['refresh-data.yml', 'readme.yml']) {
    const tekst = readFileSync(new URL(`../.github/workflows/${wf}`, import.meta.url), 'utf-8');
    assert.match(tekst, /git config --local --unset core\.hooksPath \|\| true/, wf);
  }
});
