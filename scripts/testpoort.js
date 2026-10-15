// Testpoort vóór elke push (okt 2026): alle suites, en stoppen bij de eerste
// die faalt. Beslist op de exitcode van elke suite, nooit op tekst in de
// uitvoer. Aanleiding: op 8 okt 2026 ging een push door terwijl een
// unit-test faalde (de controle keek alleen óf er een samenvatting was).
// Gebruikt door scripts/safe-push.js en de pre-push-hook in .githooks/.
//
// Niet dubbel testen (okt 2026, testpoortGroen.js): is precies deze code al
// groen getest en is de werkboom schoon, dan slaat de poort de tests over;
// PODIUM_TESTPOORT_VOLLEDIG=1 test altijd alles.
//
// Tegelijk (okt 2026): drie banen naast elkaar, binnen een baan na elkaar:
//   unit             npm test (geen emulator; servers op een vrije poort)
//   rules+functions  op een tweede set emulatorpoorten (firebase.parallel.json,
//                    gemaakt uit firebase.json, genegeerd door git)
//   e2e              op de poorten van firebase.json (de app in de browser
//                    gebruikt die vast, public/js/emulator.js)
// Elke regel uitvoer krijgt het label van zijn baan. Faalt een suite, dan
// stoppen de andere banen (hun hele procesgroep, ook de emulators) en meldt
// de poort welke suite faalde. Na elkaar als vroeger: PODIUM_TESTPOORT_SERIEEL=1.
//
// Alleen voor de tests van dit script: TESTPOORT_SUITES_VOOR_TESTS (JSON,
// [[commando, [argumenten]], …]) vervangt de suites (na elkaar). Met andere
// suites dan de echte wordt er nooit overgeslagen en nooit iets als groen
// bewaard.

import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { magOverslaan, isSchoon, groenSleutel, schrijfGroen } from './testpoortGroen.js';

export const SUITES = [
  ['npm', ['test']],
  ['npm', ['run', 'test:rules']],
  ['npm', ['run', 'test:functions']],
  ['npm', ['run', 'test:e2e']],
];

// De tweede set emulatorpoorten (rules+functions); de eerste staat in
// firebase.json (8085, 9150, 9099, 5011, 4400, 4500, 9299, 9499).
export const TWEEDE_POORTEN = { firestore: 8185, websocket: 9160, auth: 9199, functions: 5111, hub: 4410, logging: 4510, eventarc: 9309, tasks: 9509 };
export const TWEEDE_CONFIG = 'firebase.parallel.json';

/** firebase.json met de tweede set poorten (pure functie). */
export function tweedeConfig(config, p = TWEEDE_POORTEN) {
  const em = config.emulators ?? {};
  return {
    ...config,
    emulators: {
      ...em,
      firestore: { ...em.firestore, host: '127.0.0.1', port: p.firestore, websocketPort: p.websocket },
      auth: { ...em.auth, host: '127.0.0.1', port: p.auth },
      functions: { ...em.functions, host: '127.0.0.1', port: p.functions },
      hub: { host: '127.0.0.1', port: p.hub },
      logging: { host: '127.0.0.1', port: p.logging },
      eventarc: { host: '127.0.0.1', port: p.eventarc },
      tasks: { host: '127.0.0.1', port: p.tasks },
    },
  };
}

/** De banen voor de echte suites; `cwd` voor het absolute pad naar de tweede config. */
export function banen(cwd = process.cwd()) {
  const tweede = path.join(cwd, TWEEDE_CONFIG);
  return [
    { label: 'unit', suites: [SUITES[0]] },
    { label: 'rules+functions', suites: [SUITES[1], SUITES[2]], env: { PODIUM_FIREBASE_CONFIG: tweede, PODIUM_FUNCTIONS_POORT: String(TWEEDE_POORTEN.functions) } },
    { label: 'e2e', suites: [SUITES[3]] },
  ];
}

const standaardUitvoer = (cmd, args) => spawnSync(cmd, args, { stdio: 'inherit' }).status ?? 1;

/** Na elkaar; geeft { ok, mislukt: 'npm run …' | null }. */
export function draaiPoort({ suites = SUITES, voerUit = standaardUitvoer, log = console.log } = {}) {
  for (const [cmd, args] of suites) {
    const naam = [cmd, ...args].join(' ');
    log(`▶ ${naam}`);
    const code = voerUit(cmd, args);
    if (code !== 0) return { ok: false, mislukt: naam };
  }
  return { ok: true, mislukt: null };
}

/**
 * Start een suite in een eigen procesgroep; elke regel uitvoer met het label
 * ervoor. Geeft { klaar: Promise<exitcode>, stop() }.
 */
export function startSuite(cmd, args, { label, env = {}, schrijf = (t) => process.stdout.write(t) } = {}) {
  const kind = spawn(cmd, args, { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  const voorvoegsel = `[${label}] `;
  const rest = { stdout: '', stderr: '' };
  const lees = (stroom) => (stuk) => {
    const tekst = rest[stroom] + stuk;
    const regels = tekst.split('\n');
    rest[stroom] = regels.pop();
    if (regels.length) schrijf(regels.map((r) => voorvoegsel + r).join('\n') + '\n');
  };
  kind.stdout.on('data', lees('stdout'));
  kind.stderr.on('data', lees('stderr'));
  const klaar = new Promise((resolve) => {
    kind.on('error', () => resolve(1));
    kind.on('close', (code) => {
      for (const s of ['stdout', 'stderr']) if (rest[s]) schrijf(voorvoegsel + rest[s] + '\n');
      resolve(code ?? 1);
    });
  });
  let gestopt = false;
  const stop = () => {
    if (gestopt || kind.exitCode !== null) return;
    gestopt = true;
    try {
      process.kill(-kind.pid, 'SIGINT');
    } catch {
      return;
    }
    // Emulators sluiten netjes af op SIGINT; anders na 10 s hard.
    setTimeout(() => {
      try {
        process.kill(-kind.pid, 'SIGKILL');
      } catch {
        // al weg
      }
    }, 10_000).unref();
  };
  return { klaar, stop };
}

/**
 * Banen tegelijk, binnen een baan na elkaar. Bij de eerste fout stoppen de
 * andere banen; geeft { ok, mislukt, tijden: { 'npm run …': seconden } }.
 */
export async function draaiParallel({ lanes, start = startSuite, log = console.log, nu = () => Date.now() } = {}) {
  let mislukt = null;
  const lopend = new Set();
  const tijden = {};
  const stopAlles = () => {
    for (const p of lopend) p.stop();
  };
  await Promise.all(
    lanes.map(async ({ label, suites, env }) => {
      for (const [cmd, args] of suites) {
        if (mislukt) return;
        const naam = [cmd, ...args].join(' ');
        log(`▶ [${label}] ${naam}`);
        const begin = nu();
        const p = start(cmd, args, { label, env });
        lopend.add(p);
        const code = await p.klaar;
        lopend.delete(p);
        tijden[naam] = Math.round((nu() - begin) / 100) / 10;
        if (code !== 0) {
          if (!mislukt) {
            mislukt = naam;
            log(`✖ [${label}] ${naam} faalt (exit ${code}); de andere banen stoppen`);
            stopAlles();
          }
          return;
        }
        log(`✓ [${label}] ${naam} groen (${tijden[naam]} s)`);
      }
    })
  );
  return { ok: !mislukt, mislukt, tijden };
}

const schoneSleutel = (cwd, node) => {
  try {
    return isSchoon(cwd) ? groenSleutel(cwd, { node }) : null;
  } catch {
    return null;
  }
};

/**
 * De poort met het geheugen van testpoortGroen.js: overslaan als precies
 * deze code al groen is (schone werkboom), anders alle suites (de echte
 * tegelijk in banen, tenzij PODIUM_TESTPOORT_SERIEEL=1); na groen met een
 * schone, onveranderde werkboom het resultaat bewaren. `bewaar` staat alleen
 * aan voor de echte suites. Geeft Promise<{ ok, mislukt, overgeslagen }>.
 */
export async function testpoort({
  suites = SUITES,
  voerUit,
  log = console.log,
  cwd = process.cwd(),
  env = process.env,
  node = process.version,
  bewaar = suites === SUITES,
  parallel = suites === SUITES && env.PODIUM_TESTPOORT_SERIEEL !== '1',
  lanes,
  start,
} = {}) {
  if (bewaar) {
    let besluit;
    try {
      besluit = magOverslaan(cwd, { env, node });
    } catch (err) {
      besluit = { overslaan: false, reden: `geen git-informatie (${String(err.message).split('\n')[0]}): volledig testen` };
    }
    if (besluit.overslaan) {
      log(`✓ ${besluit.reden}`);
      return { ok: true, mislukt: null, overgeslagen: true };
    }
    log(`ℹ ${besluit.reden}`);
  }
  const voor = bewaar ? schoneSleutel(cwd, node) : null;
  let r;
  if (parallel) {
    if (!lanes) {
      const config = JSON.parse(readFileSync(path.join(cwd, 'firebase.json'), 'utf-8'));
      writeFileSync(path.join(cwd, TWEEDE_CONFIG), `${JSON.stringify(tweedeConfig(config), null, 2)}\n`);
    }
    r = await draaiParallel({ lanes: lanes ?? banen(cwd), start, log });
  } else {
    r = draaiPoort({ suites, voerUit, log });
  }
  if (r.ok && bewaar) {
    const na = schoneSleutel(cwd, node);
    if (voor && na && JSON.stringify(voor) === JSON.stringify(na)) {
      schrijfGroen(cwd, na);
      log(`ℹ groen bewaard voor ${na.tree.slice(0, 12)} (.testpoort-groen)`);
    } else {
      log('ℹ niet bewaard als groen: de werkboom was niet schoon of veranderde tijdens de tests');
    }
  }
  return { ok: r.ok, mislukt: r.mislukt, overgeslagen: false };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const suites = process.env.TESTPOORT_SUITES_VOOR_TESTS ? JSON.parse(process.env.TESTPOORT_SUITES_VOOR_TESTS) : SUITES;
  const r = await testpoort({ suites });
  if (!r.ok) {
    console.error(`✋ Push geweigerd: "${r.mislukt}" faalt. Eerst alles groen.`);
    process.exit(1);
  }
  console.log('✓ alle testsuites groen');
}
