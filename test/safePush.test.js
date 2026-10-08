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

// ---------- Testpoort (8 okt 2026): stoppen bij de eerste falende suite ----------

import { draaiPoort, SUITES } from '../scripts/testpoort.js';

test('testpoort: alle vier de suites, in volgorde', () => {
  assert.deepEqual(SUITES.map(([c, a]) => [c, ...a].join(' ')), ['npm test', 'npm run test:rules', 'npm run test:functions', 'npm run test:e2e']);
});

test('testpoort: beslist op de exitcode; stopt bij de eerste die faalt, de rest draait niet', () => {
  const gedraaid = [];
  const voerUit = (cmd, args) => (gedraaid.push(args.join(' ')), args.includes('test:rules') ? 1 : 0);
  assert.deepEqual(draaiPoort({ voerUit, log: () => {} }), { ok: false, mislukt: 'npm run test:rules' });
  assert.deepEqual(gedraaid, ['test', 'run test:rules']);
  assert.deepEqual(draaiPoort({ voerUit: () => 0, log: () => {} }), { ok: true, mislukt: null });
  // Een suite die niet eens start (status null) telt als mislukt.
  assert.equal(draaiPoort({ suites: [['bestaat-niet-xyz', []]], log: () => {} }).ok, false);
});

test('pre-push-hook: refresh rustig maar een suite faalt → geweigerd; groen → toegestaan; net getest door safe-push → geen tests', () => {
  const rustig = nepGh({});
  const hook = new URL('../.githooks/pre-push', import.meta.url).pathname;
  const haak = (suites, extra = {}) =>
    spawnSync('sh', [hook], { env: { ...process.env, SAFE_PUSH_GH: rustig, TESTPOORT_SUITES_VOOR_TESTS: JSON.stringify(suites), ...extra }, encoding: 'utf-8' });
  const faalt = haak([[process.execPath, ['-e', 'process.exit(0)']], [process.execPath, ['-e', 'process.exit(3)']]]);
  assert.equal(faalt.status, 1);
  assert.match(faalt.stderr, /Push geweigerd: ".*process\.exit\(3\)" faalt/);
  assert.equal(haak([[process.execPath, ['-e', 'process.exit(0)']]]).status, 0);
  const head = spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf-8' }).stdout.trim();
  assert.equal(haak([[process.execPath, ['-e', 'process.exit(1)']]], { PODIUM_GETEST: head }).status, 0, 'getest door safe-push: niet nog eens');
});
