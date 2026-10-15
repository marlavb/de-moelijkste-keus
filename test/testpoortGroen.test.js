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
async function poort(dir, { env = {}, node = 'v22.0.0', faalt = false } = {}) {
  const gedraaid = [];
  const log = [];
  const r = await testpoort({
    cwd: dir, env, node, bewaar: true, parallel: false,
    suites: [['nep', ['unit']], ['nep', ['e2e']]],
    voerUit: (_c, a) => (gedraaid.push(a[0]), faalt && a[0] === 'e2e' ? 1 : 0),
    log: (m) => log.push(m),
  });
  return { ...r, gedraaid, log: log.join('\n') };
}

test('groen en schoon → de volgende keer overgeslagen, met de hash en de tijd', async () => {
  const { dir } = repo();
  const eerste = await poort(dir);
  assert.deepEqual(eerste.gedraaid, ['unit', 'e2e']);
  assert.equal(existsSync(path.join(dir, GROEN_BESTAND)), true);
  assert.match(eerste.log, /groen bewaard voor [0-9a-f]{12}/);
  const tweede = await poort(dir);
  assert.equal(tweede.ok, true);
  assert.equal(tweede.overgeslagen, true);
  assert.deepEqual(tweede.gedraaid, []);
  assert.match(tweede.log, /testpoort overgeslagen: [0-9a-f]{12} al groen om \d+ \w+\.?,? \d\d:\d\d/);
  rmSync(dir, { recursive: true, force: true });
});

test('elke wijziging test opnieuw: niet-gecommit, gestaged, nieuw bestand, nieuwe commit, andere lock of Node-versie', async () => {
  const { dir, git } = repo();
  await poort(dir);
  // Niet-gecommitte wijziging: volledig, en niet als groen bewaard.
  writeFileSync(path.join(dir, 'a.js'), 'export const a = 2;\n');
  const vuil = await poort(dir);
  assert.deepEqual(vuil.gedraaid, ['unit', 'e2e']);
  assert.match(vuil.log, /werkboom niet schoon/);
  assert.match(vuil.log, /niet bewaard als groen/);
  // Gestaged maar niet gecommit: ook volledig.
  git('add', 'a.js');
  assert.deepEqual((await poort(dir)).gedraaid, ['unit', 'e2e']);
  git('reset', '-q', '--hard');
  assert.deepEqual((await poort(dir)).gedraaid, [], 'weer de groene code');
  // Een nieuw (niet-genegeerd) bestand: volledig.
  writeFileSync(path.join(dir, 'nieuw.test.js'), 'x\n');
  assert.deepEqual((await poort(dir)).gedraaid, ['unit', 'e2e']);
  rmSync(path.join(dir, 'nieuw.test.js'));
  // Nieuwe commit: andere tree → volledig, daarna weer overgeslagen.
  writeFileSync(path.join(dir, 'a.js'), 'export const a = 3;\n');
  git('commit', '-qam', 'twee');
  assert.deepEqual((await poort(dir)).gedraaid, ['unit', 'e2e']);
  assert.deepEqual((await poort(dir)).gedraaid, []);
  // Andere lock (gecommit): volledig.
  writeFileSync(path.join(dir, 'package-lock.json'), '{"v":2}\n');
  git('commit', '-qam', 'lock');
  assert.deepEqual((await poort(dir)).gedraaid, ['unit', 'e2e']);
  // Andere Node-versie: volledig.
  assert.deepEqual((await poort(dir, { node: 'v24.0.0' })).gedraaid, ['unit', 'e2e']);
  rmSync(dir, { recursive: true, force: true });
});

test('PODIUM_TESTPOORT_VOLLEDIG=1 test altijd alles; een falende suite wordt niet bewaard', async () => {
  const { dir } = repo();
  await poort(dir);
  const vol = await poort(dir, { env: { PODIUM_TESTPOORT_VOLLEDIG: '1' } });
  assert.deepEqual(vol.gedraaid, ['unit', 'e2e']);
  assert.match(vol.log, /PODIUM_TESTPOORT_VOLLEDIG=1/);
  rmSync(path.join(dir, GROEN_BESTAND));
  const rood = await poort(dir, { faalt: true });
  assert.equal(rood.ok, false);
  assert.equal(existsSync(path.join(dir, GROEN_BESTAND)), false);
  assert.deepEqual((await poort(dir, { faalt: true })).gedraaid, ['unit', 'e2e'], 'rood: de volgende keer weer alles');
  rmSync(dir, { recursive: true, force: true });
});

test('met andere suites dan de echte (tests, TESTPOORT_SUITES_VOOR_TESTS) nooit overslaan en nooit bewaren', async () => {
  const { dir } = repo();
  const gedraaid = [];
  const r = await testpoort({ cwd: dir, suites: [['nep', ['x']]], voerUit: (_c, a) => (gedraaid.push(a[0]), 0), log: () => {} });
  assert.equal(r.ok, true);
  assert.equal(existsSync(path.join(dir, GROEN_BESTAND)), false);
  await testpoort({ cwd: dir, suites: [['nep', ['x']]], voerUit: (_c, a) => (gedraaid.push(a[0]), 0), log: () => {} });
  assert.deepEqual(gedraaid, ['x', 'x']);
  assert.notEqual([['nep', ['x']]], SUITES);
  rmSync(dir, { recursive: true, force: true });
});

// ---------- Tegelijk (okt 2026) ----------

import { draaiParallel, banen, tweedeConfig, TWEEDE_POORTEN, startSuite, stappen, bezettePoorten, EERSTE_POORTEN } from '../scripts/testpoort.js';

// Nep-start: elke suite eindigt na `ms` met `code`; stop() eindigt meteen met 130.
function nepStart(gedrag, log) {
  return (cmd, args, { label }) => {
    const naam = [cmd, ...args].join(' ');
    const { ms = 10, code = 0 } = gedrag[naam] ?? {};
    let klaar;
    const p = new Promise((r) => { klaar = r; });
    const t = setTimeout(() => { log.push(`klaar ${naam}`); klaar(code); }, ms);
    return { klaar: p, stop: () => { clearTimeout(t); log.push(`gestopt ${naam} (${label})`); klaar(0); } }; // een nette afsluiting eindigt met 0
  };
}
const LANES = [
  { label: 'unit', suites: [['npm', ['test']]] },
  { label: 'rules+functions', suites: [['npm', ['run', 'test:rules']], ['npm', ['run', 'test:functions']]] },
  { label: 'e2e', suites: [['npm', ['run', 'test:e2e']]] },
];

test('tegelijk: banen naast elkaar, binnen een baan na elkaar; alles groen', async () => {
  const log = [];
  const r = await draaiParallel({ lanes: LANES, start: nepStart({ 'npm test': { ms: 30 }, 'npm run test:rules': { ms: 5 }, 'npm run test:functions': { ms: 5 }, 'npm run test:e2e': { ms: 20 } }, log), log: () => {} });
  assert.equal(r.ok, true);
  assert.equal(r.mislukt, null);
  // functions pas na rules; unit (30 ms) eindigt als laatste: ze liepen tegelijk.
  assert.ok(log.indexOf('klaar npm run test:rules') < log.indexOf('klaar npm run test:functions'));
  assert.equal(log.at(-1), 'klaar npm test');
  assert.deepEqual(Object.keys(r.tijden).sort(), ['npm run test:e2e', 'npm run test:functions', 'npm run test:rules', 'npm test']);
});

test('tegelijk: één fout → exit ≠ 0 met de naam van de suite, de andere banen stoppen, de rest van de baan draait niet', async () => {
  const log = [];
  const meldingen = [];
  const r = await draaiParallel({ lanes: LANES, start: nepStart({ 'npm test': { ms: 200 }, 'npm run test:rules': { ms: 5, code: 1 }, 'npm run test:e2e': { ms: 200 } }, log), log: (m) => meldingen.push(m) });
  assert.equal(r.ok, false);
  assert.equal(r.mislukt, 'npm run test:rules');
  assert.ok(log.includes('gestopt npm test (unit)'));
  assert.ok(log.includes('gestopt npm run test:e2e (e2e)'));
  assert.ok(!log.some((l) => l.includes('test:functions')), 'functions niet meer gestart');
  assert.ok(meldingen.includes('⏹ [unit] npm test gestopt'));
  assert.ok(!meldingen.some((m) => m.startsWith('✓')), 'niets gestopt als groen gemeld');
  assert.ok(meldingen.some((m) => /✖ \[rules\+functions\] npm run test:rules faalt \(exit 1\)/.test(m)));
});

test('banen: unit, rules+functions (tweede poorten) en e2e; samen precies de vier suites, test:e2e in losse stappen', () => {
  const scripts = { 'test:rules': 'npm --prefix firebase test', 'test:functions': 'node scripts/test-functions.js', 'test:e2e': 'npm --prefix firebase run e2e && node scripts/nep-geheimen.js && npm --prefix firebase run e2e-functies' };
  const b = banen('/repo', scripts);
  assert.deepEqual(b.map((l) => l.label), ['unit', 'rules+functions', 'e2e']);
  const namen = [...new Set(b.flatMap((l) => l.suites.map((s) => s[2])))];
  assert.deepEqual(namen, SUITES.map(([c, a]) => [c, ...a].join(' ')));
  assert.deepEqual(b[2].suites, [
    ['sh', ['-c', 'npm --prefix firebase run e2e'], 'npm run test:e2e'],
    ['sh', ['-c', 'node scripts/nep-geheimen.js'], 'npm run test:e2e'],
    ['sh', ['-c', 'npm --prefix firebase run e2e-functies'], 'npm run test:e2e'],
  ]);
  assert.equal(b[1].env.PODIUM_FIREBASE_CONFIG, '/repo/firebase.parallel.json');
  assert.equal(b[1].env.PODIUM_FUNCTIONS_POORT, '5111');
  assert.equal(b[0].env, undefined);
  assert.equal(b[2].env, undefined, 'e2e op de vaste poorten van de app');
});

test('tweede config: geen enkele poort gelijk aan die van firebase.json (ook hub, logging, websocket, eventarc, tasks)', async () => {
  const { readFileSync } = await import('node:fs');
  const config = JSON.parse(readFileSync(new URL('../firebase.json', import.meta.url), 'utf-8'));
  const t = tweedeConfig(config);
  const standaard = [8085, 9150, 9099, 5011, 4400, 4500, 9299, 9499];
  const tweede = Object.values(t.emulators).flatMap((e) => [e.port, e.websocketPort]).filter(Boolean);
  assert.deepEqual(tweede.filter((p) => standaard.includes(p)), []);
  assert.equal(new Set(tweede).size, tweede.length);
  assert.deepEqual(new Set(tweede), new Set(Object.values(TWEEDE_POORTEN)));
  assert.equal(t.firestore.rules, config.firestore.rules);
  assert.deepEqual(t.functions, config.functions);
});

test('startSuite: elke regel met het label; exitcode doorgegeven; stop() haalt de hele procesgroep weg', async () => {
  let uit = '';
  const p = startSuite(process.execPath, ['-e', 'console.log("een"); console.error("twee"); process.stdout.write("drie"); process.exit(3)'], { label: 'x', schrijf: (t) => (uit += t) });
  assert.equal(await p.klaar, 3);
  assert.deepEqual(uit.trim().split('\n').sort(), ['[x] drie', '[x] een', '[x] twee']);
  // Een kleinkind (zoals de emulator onder npm) gaat mee met stop().
  const q = startSuite(process.execPath, ['-e', 'require("child_process").spawn(process.execPath, ["-e", "setInterval(()=>{}, 1000)"], { stdio: "inherit" }); setInterval(()=>{}, 1000)'], { label: 'y', schrijf: () => {} });
  setTimeout(() => q.stop(), 200);
  assert.notEqual(await q.klaar, 0);
});

test('banen uit de echte package.json: dezelfde stappen als het script (geen drift)', async () => {
  const { readFileSync } = await import('node:fs');
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf-8'));
  const e2e = banen(new URL('..', import.meta.url).pathname).find((l) => l.label === 'e2e').suites;
  assert.equal(e2e.map((s) => s[1][1]).join(' && '), pkg.scripts['test:e2e']);
  assert.deepEqual(stappen(['npm', ['test']], pkg.scripts), [['npm', ['test'], 'npm test']]);
});

test('tegelijk: na een stop start de volgende stap van dezelfde suite niet meer (geen nieuwe emulatorronde)', async () => {
  const log = [];
  const lanes = [
    { label: 'a', suites: [['npm', ['test'], 'npm test']] },
    { label: 'e2e', suites: [['sh', ['-c', 'e2e'], 'npm run test:e2e'], ['sh', ['-c', 'geheimen'], 'npm run test:e2e'], ['sh', ['-c', 'e2e-functies'], 'npm run test:e2e']] },
  ];
  const r = await draaiParallel({ lanes, start: nepStart({ 'npm test': { ms: 5, code: 1 }, 'sh -c e2e': { ms: 200 } }, log), log: () => {} });
  assert.equal(r.mislukt, 'npm test');
  assert.ok(log.includes('gestopt sh -c e2e (e2e)'));
  assert.ok(!log.some((l) => /geheimen|e2e-functies/.test(l)));
});

test('poorten: een bezette poort wordt gezien', async () => {
  const { createServer } = await import('node:net');
  const s = createServer();
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  const p = s.address().port;
  assert.deepEqual(await bezettePoorten([p]), [p]);
  await new Promise((r) => s.close(r));
  assert.deepEqual(await bezettePoorten([p]), []);
  assert.equal(EERSTE_POORTEN.some((x) => Object.values(TWEEDE_POORTEN).includes(x)), false);
});
