// Tests voor scripts/refresh-vandaag.js: de "vandaag al ververst"-controle
// aan het begin van refresh-data.yml (Amsterdamse datum, zomer- en wintertijd).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { alVandaagVerversd, amsterdamDatum } from '../scripts/refresh-vandaag.js';

test('zelfde Amsterdamse dag: overslaan; gisteren: verversen', () => {
  const status = { bijgewerktOp: '2026-10-06T03:42:00Z' }; // 05:42 in Amsterdam
  assert.equal(alVandaagVerversd(status, { nu: Date.parse('2026-10-06T10:05:00Z') }).alGedaan, true);
  assert.equal(alVandaagVerversd(status, { nu: Date.parse('2026-10-07T03:00:00Z') }).alGedaan, false);
});

test('rond middernacht telt Amsterdam, niet UTC (zomer- en wintertijd)', () => {
  // Zomertijd: 22:30 UTC op 5 okt is al 6 okt in Amsterdam.
  assert.equal(amsterdamDatum('2026-10-05T22:30:00Z'), '2026-10-06');
  assert.equal(alVandaagVerversd({ bijgewerktOp: '2026-10-05T22:30:00Z' }, { nu: Date.parse('2026-10-06T03:00:00Z') }).alGedaan, true);
  assert.equal(alVandaagVerversd({ bijgewerktOp: '2026-10-05T21:30:00Z' }, { nu: Date.parse('2026-10-06T03:00:00Z') }).alGedaan, false);
  // Wintertijd: 23:30 UTC op 14 dec is 15 dec in Amsterdam.
  assert.equal(amsterdamDatum('2026-12-14T23:30:00Z'), '2026-12-15');
  assert.equal(amsterdamDatum('2026-12-14T22:59:00Z'), '2026-12-14');
});

test('forceer, geen of kapotte status: altijd verversen', () => {
  const nu = Date.parse('2026-10-06T10:00:00Z');
  assert.equal(alVandaagVerversd({ bijgewerktOp: '2026-10-06T03:42:00Z' }, { nu, forceer: true }).alGedaan, false);
  assert.equal(alVandaagVerversd(null, { nu }).alGedaan, false);
  assert.equal(alVandaagVerversd({}, { nu }).alGedaan, false);
  assert.equal(alVandaagVerversd({ bijgewerktOp: 'kapot' }, { nu }).alGedaan, false);
});

test('als script: schrijft al_gedaan naar GITHUB_OUTPUT (ook met FORCEER)', () => {
  const map = mkdtempSync(path.join(tmpdir(), 'refresh-vandaag-'));
  mkdirSync(path.join(map, 'public/data'), { recursive: true });
  writeFileSync(path.join(map, 'public/data/scrape-status.json'), JSON.stringify({ bijgewerktOp: new Date().toISOString() }));
  const script = new URL('../scripts/refresh-vandaag.js', import.meta.url).pathname;
  const draai = (env) => {
    const uit = path.join(map, `out-${Math.random()}`);
    writeFileSync(uit, '');
    const log = execFileSync('node', [script], { cwd: map, env: { ...process.env, GITHUB_OUTPUT: uit, ...env }, encoding: 'utf-8' });
    return { log, out: readFileSync(uit, 'utf-8') };
  };
  const a = draai({ FORCEER: 'false' });
  assert.equal(a.out, 'al_gedaan=true\n');
  assert.match(a.log, /^Overslaan:/);
  assert.equal(draai({ FORCEER: 'true' }).out, 'al_gedaan=false\n');
});
