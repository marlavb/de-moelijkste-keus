// Niet dubbel testen (okt 2026): de testpoort slaat alleen over als precies
// dezelfde code al groen getest is en de werkboom schoon is. In een tijdelijke
// git-repo, met nep-suites.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import { testpoort, SUITES } from '../scripts/testpoort.js';
import { GROEN_BESTAND } from '../scripts/testpoortGroen.js';

function repo() {
  const dir = mkdtempSync(path.join(tmpdir(), 'poort-'));
  const git = (...a) => execFileSync('git', a, { cwd: dir, stdio: 'ignore' });
  git('init', '-q');
  git('config', 'user.email', 't@example.com');
  git('config', 'user.name', 't');
  writeFileSync(path.join(dir, '.gitignore'), `${GROEN_BESTAND}\nnode_modules/\n`);
  writeFileSync(path.join(dir, 'a.js'), 'export const a = 1;\n');
  writeFileSync(path.join(dir, 'package-lock.json'), '{"v":1}\n');
  git('add', '.');
  git('commit', '-qm', 'eerste');
  return { dir, git };
}

// Draait de poort met tellende nep-suites; `faalt` laat de tweede suite falen.
function poort(dir, { env = {}, node = 'v22.0.0', faalt = false } = {}) {
  const gedraaid = [];
  const log = [];
  const r = testpoort({
    cwd: dir, env, node, bewaar: true,
    suites: [['nep', ['unit']], ['nep', ['e2e']]],
    voerUit: (_c, a) => (gedraaid.push(a[0]), faalt && a[0] === 'e2e' ? 1 : 0),
    log: (m) => log.push(m),
  });
  return { ...r, gedraaid, log: log.join('\n') };
}

test('groen en schoon → de volgende keer overgeslagen, met de hash en de tijd', () => {
  const { dir } = repo();
  const eerste = poort(dir);
  assert.deepEqual(eerste.gedraaid, ['unit', 'e2e']);
  assert.equal(existsSync(path.join(dir, GROEN_BESTAND)), true);
  assert.match(eerste.log, /groen bewaard voor [0-9a-f]{12}/);
  const tweede = poort(dir);
  assert.equal(tweede.ok, true);
  assert.equal(tweede.overgeslagen, true);
  assert.deepEqual(tweede.gedraaid, []);
  assert.match(tweede.log, /testpoort overgeslagen: [0-9a-f]{12} al groen om \d+ \w+\.?,? \d\d:\d\d/);
  rmSync(dir, { recursive: true, force: true });
});

test('elke wijziging test opnieuw: niet-gecommit, gestaged, nieuw bestand, nieuwe commit, andere lock of Node-versie', () => {
  const { dir, git } = repo();
  poort(dir);
  // Niet-gecommitte wijziging: volledig, en niet als groen bewaard.
  writeFileSync(path.join(dir, 'a.js'), 'export const a = 2;\n');
  const vuil = poort(dir);
  assert.deepEqual(vuil.gedraaid, ['unit', 'e2e']);
  assert.match(vuil.log, /werkboom niet schoon/);
  assert.match(vuil.log, /niet bewaard als groen/);
  // Gestaged maar niet gecommit: ook volledig.
  git('add', 'a.js');
  assert.deepEqual(poort(dir).gedraaid, ['unit', 'e2e']);
  git('reset', '-q', '--hard');
  assert.deepEqual(poort(dir).gedraaid, [], 'weer de groene code');
  // Een nieuw (niet-genegeerd) bestand: volledig.
  writeFileSync(path.join(dir, 'nieuw.test.js'), 'x\n');
  assert.deepEqual(poort(dir).gedraaid, ['unit', 'e2e']);
  rmSync(path.join(dir, 'nieuw.test.js'));
  // Nieuwe commit: andere tree → volledig, daarna weer overgeslagen.
  writeFileSync(path.join(dir, 'a.js'), 'export const a = 3;\n');
  git('commit', '-qam', 'twee');
  assert.deepEqual(poort(dir).gedraaid, ['unit', 'e2e']);
  assert.deepEqual(poort(dir).gedraaid, []);
  // Andere lock (gecommit): volledig.
  writeFileSync(path.join(dir, 'package-lock.json'), '{"v":2}\n');
  git('commit', '-qam', 'lock');
  assert.deepEqual(poort(dir).gedraaid, ['unit', 'e2e']);
  // Andere Node-versie: volledig.
  assert.deepEqual(poort(dir, { node: 'v24.0.0' }).gedraaid, ['unit', 'e2e']);
  rmSync(dir, { recursive: true, force: true });
});

test('PODIUM_TESTPOORT_VOLLEDIG=1 test altijd alles; een falende suite wordt niet bewaard', () => {
  const { dir } = repo();
  poort(dir);
  const vol = poort(dir, { env: { PODIUM_TESTPOORT_VOLLEDIG: '1' } });
  assert.deepEqual(vol.gedraaid, ['unit', 'e2e']);
  assert.match(vol.log, /PODIUM_TESTPOORT_VOLLEDIG=1/);
  rmSync(path.join(dir, GROEN_BESTAND));
  const rood = poort(dir, { faalt: true });
  assert.equal(rood.ok, false);
  assert.equal(existsSync(path.join(dir, GROEN_BESTAND)), false);
  assert.deepEqual(poort(dir, { faalt: true }).gedraaid, ['unit', 'e2e'], 'rood: de volgende keer weer alles');
  rmSync(dir, { recursive: true, force: true });
});

test('met andere suites dan de echte (tests, TESTPOORT_SUITES_VOOR_TESTS) nooit overslaan en nooit bewaren', () => {
  const { dir } = repo();
  const gedraaid = [];
  const r = testpoort({ cwd: dir, suites: [['nep', ['x']]], voerUit: (_c, a) => (gedraaid.push(a[0]), 0), log: () => {} });
  assert.equal(r.ok, true);
  assert.equal(existsSync(path.join(dir, GROEN_BESTAND)), false);
  testpoort({ cwd: dir, suites: [['nep', ['x']]], voerUit: (_c, a) => (gedraaid.push(a[0]), 0), log: () => {} });
  assert.deepEqual(gedraaid, ['x', 'x']);
  assert.notEqual([['nep', ['x']]], SUITES);
  rmSync(dir, { recursive: true, force: true });
});
