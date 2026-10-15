// Testpoort vóór elke push (okt 2026): alle suites na elkaar, en stoppen bij
// de eerste die faalt. Beslist op de exitcode van elke suite, nooit op tekst
// in de uitvoer. Aanleiding: op 8 okt 2026 ging een push door terwijl een
// unit-test faalde (de controle keek alleen óf er een samenvatting was).
// Gebruikt door scripts/safe-push.js en de pre-push-hook in .githooks/.
//
// Niet dubbel testen (okt 2026, testpoortGroen.js): is precies deze code al
// groen getest en is de werkboom schoon, dan slaat de poort de tests over;
// PODIUM_TESTPOORT_VOLLEDIG=1 test altijd alles.
//
// Alleen voor de tests van dit script: TESTPOORT_SUITES_VOOR_TESTS (JSON,
// [[commando, [argumenten]], …]) vervangt de suites. Met andere suites dan de
// echte wordt er nooit overgeslagen en nooit iets als groen bewaard.

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { magOverslaan, isSchoon, groenSleutel, schrijfGroen } from './testpoortGroen.js';

export const SUITES = [
  ['npm', ['test']],
  ['npm', ['run', 'test:rules']],
  ['npm', ['run', 'test:functions']],
  ['npm', ['run', 'test:e2e']],
];

const standaardUitvoer = (cmd, args) => spawnSync(cmd, args, { stdio: 'inherit' }).status ?? 1;

/** Draait de suites; geeft { ok, mislukt: 'npm run …' | null }. */
export function draaiPoort({ suites = SUITES, voerUit = standaardUitvoer, log = console.log } = {}) {
  for (const [cmd, args] of suites) {
    const naam = [cmd, ...args].join(' ');
    log(`▶ ${naam}`);
    const code = voerUit(cmd, args);
    if (code !== 0) return { ok: false, mislukt: naam };
  }
  return { ok: true, mislukt: null };
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
 * deze code al groen is (schone werkboom), anders alle suites; na groen met
 * een schone, onveranderde werkboom het resultaat bewaren. `bewaar` staat
 * alleen aan voor de echte suites. Geeft { ok, mislukt, overgeslagen }.
 */
export function testpoort({ suites = SUITES, voerUit, log = console.log, cwd = process.cwd(), env = process.env, node = process.version, bewaar = suites === SUITES } = {}) {
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
  const r = draaiPoort({ suites, voerUit, log });
  if (r.ok && bewaar) {
    const na = schoneSleutel(cwd, node);
    if (voor && na && JSON.stringify(voor) === JSON.stringify(na)) {
      schrijfGroen(cwd, na);
      log(`ℹ groen bewaard voor ${na.tree.slice(0, 12)} (.testpoort-groen)`);
    } else {
      log('ℹ niet bewaard als groen: de werkboom was niet schoon of veranderde tijdens de tests');
    }
  }
  return { ...r, overgeslagen: false };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const suites = process.env.TESTPOORT_SUITES_VOOR_TESTS ? JSON.parse(process.env.TESTPOORT_SUITES_VOOR_TESTS) : SUITES;
  const r = testpoort({ suites });
  if (!r.ok) {
    console.error(`✋ Push geweigerd: "${r.mislukt}" faalt. Eerst alles groen.`);
    process.exit(1);
  }
  console.log('✓ alle testsuites groen');
}
