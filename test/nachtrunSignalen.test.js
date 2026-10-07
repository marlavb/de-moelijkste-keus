// Tests voor de beslisregels van de nachtrun (src/lib/nachtrunSignalen.js):
// wanneer rood, wanneer groen met waarschuwing, en wat er met het issue gebeurt.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { beoordeelNachtrun, nachtenSinds, samenvatting, issueActie, MAX_SCRAPE_MINUTEN } from '../src/lib/nachtrunSignalen.js';

const ok = { status: 'ok' };
const tv = (reeks = 1, fout = 'exception: page.goto: net::ERR_NAME_NOT_RESOLVED') => ({ status: 'terugval', fout, terugvalReeks: reeks });
const status = (extra = {}) => ({ theaters: { a: ok, b: ok, c: { status: 'leeg' }, d: { status: 'gepauzeerd', terugvalReeks: 9 }, ...extra } });
const stappenOk = { scrape: 'success', datacheck: 'success', commit: 'success', deploy: 'success' };

test('0 terugvallen: groen, issue sluiten', () => {
  const b = beoordeelNachtrun({ status: status(), scrapeSeconden: 3500, stappen: stappenOk });
  assert.equal(b.niveau, 'ok');
  assert.deepEqual(b.aantallen, { ok: 2, leeg: 1, gepauzeerd: 1, terugval: 0 });
  assert.equal(issueActie(b), 'sluiten');
});

test('1 terugval, 1e nacht: groen met waarschuwing, issue niet aanraken', () => {
  const b = beoordeelNachtrun({ status: status({ mozaiek: tv(1) }), scrapeSeconden: 3500, stappen: stappenOk });
  assert.equal(b.niveau, 'waarschuwing');
  assert.equal(b.terugval[0].id, 'mozaiek');
  assert.equal(issueActie(b), 'niets');
});

test('1 terugval, 2e nacht op rij: rood', () => {
  const b = beoordeelNachtrun({ status: status({ mozaiek: tv(2) }), stappen: stappenOk });
  assert.equal(b.niveau, 'rood');
  assert.match(b.redenen[0], /mozaiek valt 2 nachten op rij terug/);
  assert.equal(issueActie(b), 'bijwerken');
});

test('3 terugvallen in één nacht: waarschuwing; 4: rood', () => {
  const drie = beoordeelNachtrun({ status: status({ x: tv(), y: tv(), z: tv() }), stappen: stappenOk });
  assert.equal(drie.niveau, 'waarschuwing');
  const vier = beoordeelNachtrun({ status: status({ w: tv(), x: tv(), y: tv(), z: tv() }), stappen: stappenOk });
  assert.equal(vier.niveau, 'rood');
  assert.ok(vier.redenen.some((r) => /4 theaters vallen terug/.test(r)));
});

test('gepauzeerd telt niet mee, ook niet met een oude reeks; "fout" telt als terugval', () => {
  const b = beoordeelNachtrun({ status: status({ p: { status: 'gepauzeerd', terugvalReeks: 5 } }), stappen: stappenOk });
  assert.equal(b.niveau, 'ok');
  assert.equal(b.aantallen.gepauzeerd, 2);
  const f = beoordeelNachtrun({ status: status({ n: { status: 'fout', fout: 'timeout', terugvalReeks: 1 } }), stappen: stappenOk });
  assert.equal(f.niveau, 'waarschuwing');
});

test('rood bij scherpe daling, gefaalde stap of te lange scrape; deploy overgeslagen is geen fout', () => {
  const daling = beoordeelNachtrun({ status: status({ a: { status: 'ok', waarschuwing: 'scherpe daling: 10 unieke komende voorstellingen, vorige keer 80' } }), stappen: stappenOk });
  assert.equal(daling.niveau, 'rood');
  for (const stap of ['scrape', 'datacheck', 'commit', 'deploy']) {
    assert.equal(beoordeelNachtrun({ status: status(), stappen: { ...stappenOk, [stap]: 'failure' } }).niveau, 'rood', stap);
  }
  assert.equal(beoordeelNachtrun({ status: status(), stappen: { ...stappenOk, deploy: 'skipped' } }).niveau, 'ok');
  assert.equal(beoordeelNachtrun({ status: status(), scrapeSeconden: MAX_SCRAPE_MINUTEN * 60 + 1, stappen: stappenOk }).niveau, 'rood');
  assert.equal(beoordeelNachtrun({ status: status(), scrapeSeconden: MAX_SCRAPE_MINUTEN * 60, stappen: stappenOk }).niveau, 'ok');
});

test('nachtenSinds: Amsterdamse datums, tweede run op dezelfde dag telt niet dubbel', () => {
  assert.equal(nachtenSinds(null, '2026-10-07T03:00:00Z'), 0);
  assert.equal(nachtenSinds('2026-10-07T03:23:00Z', '2026-10-07T07:47:00Z'), 1);
  assert.equal(nachtenSinds('2026-10-07T03:23:00Z', '2026-10-08T03:20:00Z'), 2);
  // 23:30 UTC op 6 okt is al 7 okt in Amsterdam.
  assert.equal(nachtenSinds('2026-10-06T23:30:00Z', '2026-10-07T03:00:00Z'), 1);
});

test('samenvatting: looptijd, aantallen, en per teruggevallen theater fout en reeks', () => {
  const b = beoordeelNachtrun({ status: status({ mozaiek: tv(2, 'a | b') }), scrapeSeconden: 3504, stappen: stappenOk });
  const md = samenvatting(b, { datum: '2026-10-08', runUrl: 'https://github.com/x/y/actions/runs/1' });
  assert.match(md, /❌ Nachtrun: aandacht nodig \(2026-10-08\)/);
  assert.match(md, /Looptijd scrapen: 58 min 24 s/);
  assert.match(md, /\| 2 \| 1 \| 1 \| 1 \|/);
  assert.match(md, /\| mozaiek \| 2 \| a \\\| b \|/);
  assert.match(md, /Run: https:\/\/github.com/);
});

// ---------- Issue "Nachtrun: aandacht nodig" (scripts/nachtrun-signalen.js) ----------

import { verwerkIssue } from '../scripts/nachtrun-signalen.js';

function nepGh(open = []) {
  const aanroepen = [];
  const gh = (args) => {
    aanroepen.push(args.slice(0, 3).join(' '));
    return args[1] === 'list' ? JSON.stringify(open) : '';
  };
  return { gh, aanroepen };
}

test('issue: rood zonder open issue → label en issue aanmaken; met open issue → bijwerken, geen tweede', () => {
  const nieuw = nepGh([]);
  assert.equal(verwerkIssue('bijwerken', 'samenvatting', { gh: nieuw.gh, datum: '2026-10-08' }), 'aangemaakt');
  assert.ok(nieuw.aanroepen.some((a) => a.startsWith('label create nachtrun')));
  assert.ok(nieuw.aanroepen.some((a) => a.startsWith('issue create --title')));
  const bestaand = nepGh([{ number: 7, title: 'Nachtrun: aandacht nodig' }]);
  assert.equal(verwerkIssue('bijwerken', 'samenvatting', { gh: bestaand.gh, datum: '2026-10-08' }), 'bijgewerkt');
  assert.ok(bestaand.aanroepen.includes('issue edit 7'));
  assert.ok(bestaand.aanroepen.includes('issue comment 7'));
  assert.equal(bestaand.aanroepen.some((a) => a.startsWith('issue create')), false);
});

test('issue: groen zonder terugval → sluiten als het open is; waarschuwing → niets', () => {
  const open = nepGh([{ number: 7, title: 'Nachtrun: aandacht nodig' }, { number: 9, title: 'iets anders' }]);
  assert.equal(verwerkIssue('sluiten', 'x', { gh: open.gh, datum: '2026-10-08' }), 'gesloten');
  assert.ok(open.aanroepen.includes('issue close 7'));
  assert.equal(verwerkIssue('sluiten', 'x', { gh: nepGh([]).gh, datum: '2026-10-08' }), 'niets');
  const w = nepGh([{ number: 7, title: 'Nachtrun: aandacht nodig' }]);
  assert.equal(verwerkIssue('niets', 'x', { gh: w.gh, datum: '2026-10-08' }), 'niets');
  assert.deepEqual(w.aanroepen, []);
});
