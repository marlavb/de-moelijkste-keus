// Tests voor de alias-kandidaten (src/lib/aliasKandidaten.js). Er wordt
// niets samengevoegd; dit zoekt alleen paren voor de handmatige afvinklijst.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { soortVerschil, vindKandidaten, bewerkingsafstand } from '../src/lib/aliasKandidaten.js';

test('soort verschil tussen twee delen', () => {
  assert.equal(soortVerschil('rudsichtlos', 'rudsichtslos'), 'spelling');
  assert.equal(soortVerschil('lovella telesford', 'lovella telesfort'), 'spelling');
  assert.equal(soortVerschil('de broers van arkel', 'broers van arkel'), 'lidwoord');
  assert.equal(soortVerschil('oudejaarsconference', 'oudejaarsconference 2026'), 'jaartal');
  assert.equal(soortVerschil('finalistentournee', 'finalistentournee 60ste editie'), 'jaartal');
  assert.equal(soortVerschil('rayen panday', 'rayen panday en friends'), 'toevoeging');
  assert.equal(soortVerschil('jan beuving', 'jan beuving en tom dicke'), 'toevoeging');
  // Afleveringen en tijden zijn andere voorstellingen.
  assert.equal(soortVerschil('niet zomaar een pubquiz 2', 'niet zomaar een pubquiz 3'), null);
  assert.equal(soortVerschil('11 00 uur', '14 00 uur'), null);
  // Korte woorden en echte verschillen: geen kandidaat.
  assert.equal(soortVerschil('pan', 'man'), null);
  assert.equal(soortVerschil('prikkelarme kermis', 'gelukskoekje'), null);
  assert.equal(bewerkingsafstand('kitten', 'sitting'), 3);
});

const show = (titel, theaterId) => ({ titel, theaterId, datum: '2026-12-01' });

test('paren van sleutels die op één deel na gelijk zijn', () => {
  const paren = vindKandidaten([
    show('Ruud Smulders – Rüdsichtlos', 'delamar'),
    show('Ruud Smulders – RÜDSICHTSLOS', 'griffioen'),
    show('Sara Kroos – Prikkelarme kermis', 'delamar'),
    show('Sara Kroos – Gelukskoekje', 'omval'),
    // Alleen bij één en hetzelfde theater: een reeks, geen alias.
    show('Flunknarf – Niet zomaar een Pubquiz #2', 'stadsschouwburgutrecht'),
    show('Flunknarf – Niet zomaar een Pubquiz #3', 'stadsschouwburgutrecht'),
    // Theatergebonden (uitsluitlijst) doet niet mee.
    show('Nora', 'flint'),
    show('Norra', 'delamar'),
  ]);
  assert.deepEqual(
    paren.map((p) => [p.soort, p.deelA, p.deelB]),
    [['spelling', 'rudsichtlos', 'rudsichtslos']]
  );
});
