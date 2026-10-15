// Niet dubbel testen (okt 2026): na een groene testpoort bewaren we wat er
// getest is (tree-hash van HEAD, hashes van de package-locks, Node-versie)
// in .testpoort-groen (genegeerd door git). De volgende testpoort slaat de
// tests alleen over als de werkboom helemaal schoon is (ook geen nieuwe,
// niet-genegeerde bestanden) en precies hetzelfde getest is. Elke andere
// wijziging, ook een niet-gecommitte, laat alles weer draaien. Volledig
// forceren: PODIUM_TESTPOORT_VOLLEDIG=1.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';

export const GROEN_BESTAND = '.testpoort-groen';
export const LOCKS = ['package-lock.json', 'firebase/package-lock.json', 'functions/package-lock.json'];

const git = (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });

/** Schoon: geen gewijzigde, gestagede of nieuwe (niet-genegeerde) bestanden. */
export function isSchoon(cwd) {
  return git(cwd, ['status', '--porcelain', '--untracked-files=all']).trim() === '';
}

/** Wat er getest wordt: tree van HEAD, hashes van de locks, Node-versie. */
export function groenSleutel(cwd, { node = process.version } = {}) {
  const tree = git(cwd, ['rev-parse', 'HEAD^{tree}']).trim();
  const locks = {};
  for (const l of LOCKS) {
    const p = path.join(cwd, l);
    locks[l] = existsSync(p) ? createHash('sha256').update(readFileSync(p)).digest('hex') : null;
  }
  return { tree, locks, node };
}

const zelfde = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export function leesGroen(cwd) {
  try {
    return JSON.parse(readFileSync(path.join(cwd, GROEN_BESTAND), 'utf-8'));
  } catch {
    return null;
  }
}

export function schrijfGroen(cwd, sleutel, nu = new Date()) {
  writeFileSync(path.join(cwd, GROEN_BESTAND), `${JSON.stringify({ ...sleutel, groenOp: nu.toISOString() }, null, 1)}\n`);
}

export const tijdNl = (iso) => new Date(iso).toLocaleString('nl-NL', { timeZone: 'Europe/Amsterdam', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/**
 * Mag de testpoort overslaan? { overslaan, reden }. Nooit bij
 * PODIUM_TESTPOORT_VOLLEDIG=1, een vuile werkboom, of een andere sleutel.
 */
export function magOverslaan(cwd, { env = process.env, node = process.version } = {}) {
  if (env.PODIUM_TESTPOORT_VOLLEDIG === '1') return { overslaan: false, reden: 'PODIUM_TESTPOORT_VOLLEDIG=1: volledig testen' };
  if (!isSchoon(cwd)) return { overslaan: false, reden: 'werkboom niet schoon: volledig testen' };
  const groen = leesGroen(cwd);
  const nu = groenSleutel(cwd, { node });
  if (!groen) return { overslaan: false, reden: 'nog niets groen getest: volledig testen' };
  const { groenOp, ...oud } = groen;
  if (!zelfde(oud, nu)) return { overslaan: false, reden: 'andere code dan de laatste groene testpoort: volledig testen' };
  return { overslaan: true, reden: `testpoort overgeslagen: ${nu.tree.slice(0, 12)} al groen om ${tijdNl(groenOp)}` };
}
