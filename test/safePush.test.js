// Tests voor de push-blokkade (scripts/refresh-check.js en safe-push.js),
// met een nep-`gh` die vaste uitvoer geeft.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { controleerRefresh, LOPENDE_STATUSSEN } from '../scripts/refresh-check.js';

const run = (status) => ({ databaseId: 1, status, createdAt: '2026-09-29T10:33:25Z', event: 'schedule', url: 'https://github.com/x/runs/1' });

test('geen lopende runs → pushen mag', () => {
  const gevraagd = [];
  const r = controleerRefresh({ haalRuns: (s) => (gevraagd.push(s), []) });
  assert.equal(r.magPushen, true);
  assert.deepEqual(gevraagd, LOPENDE_STATUSSEN);
  assert.ok(gevraagd.includes('in_progress') && gevraagd.includes('queued'));
});

test('run bezig of in de wachtrij → geweigerd, met de run in de melding', () => {
  for (const status of ['in_progress', 'queued']) {
    const r = controleerRefresh({ haalRuns: (s) => (s === status ? [run(status)] : []) });
    assert.equal(r.magPushen, false);
    assert.match(r.reden, new RegExp(`refresh-data loopt of staat in de wachtrij[\\s\\S]*${status} \\(schedule`));
  }
});

test('gh faalt → geweigerd (liever te voorzichtig)', () => {
  const r = controleerRefresh({ haalRuns: () => { throw new Error('gh: not logged in'); } });
  assert.equal(r.magPushen, false);
  assert.match(r.reden, /kon niet vaststellen.*not logged in/);
});

// Het echte script, met een nep-gh als los programma.
function nepGh(uitvoerPerStatus) {
  const dir = mkdtempSync(path.join(tmpdir(), 'nepgh-'));
  const file = path.join(dir, 'gh');
  writeFileSync(
    file,
    `#!/usr/bin/env node
const args = process.argv.slice(2);
const status = args[args.indexOf('--status') + 1];
if (!args.includes('--workflow') || args[args.indexOf('--workflow') + 1] !== 'refresh-data.yml') process.exit(2);
process.stdout.write(JSON.stringify(${JSON.stringify(uitvoerPerStatus)}[status] ?? []));
`
  );
  chmodSync(file, 0o755);
  return file;
}

const script = (naam, gh, extra = []) =>
  spawnSync(process.execPath, [new URL(`../scripts/${naam}`, import.meta.url).pathname, ...extra], {
    env: { ...process.env, SAFE_PUSH_GH: gh },
    encoding: 'utf-8',
  });

test('pre-push-controle en safe-push --dry-run met nep-gh', () => {
  const rustig = nepGh({});
  assert.equal(script('refresh-check.js', rustig).status, 0);
  const ok = script('safe-push.js', rustig, ['--dry-run']);
  assert.equal(ok.status, 0);
  assert.match(ok.stdout, /geen refresh-data-run bezig/);

  const druk = nepGh({ queued: [run('queued')] });
  const hook = script('refresh-check.js', druk);
  assert.equal(hook.status, 1);
  assert.match(hook.stderr, /Push geweigerd: refresh-data loopt of staat in de wachtrij/);
  const push = script('safe-push.js', druk, ['--dry-run']);
  assert.equal(push.status, 1);

  const kapot = script('refresh-check.js', '/bestaat/niet/gh');
  assert.equal(kapot.status, 1);
  assert.match(kapot.stderr, /kon niet vaststellen/);
});
