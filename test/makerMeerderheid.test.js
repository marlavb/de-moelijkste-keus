// Tests voor de maker op productieniveau (src/lib/makerMeerderheid.js).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { pasMakerMeerderheidToe, kiesMaker, makerSleutel, makerKern, verdachtReden } from '../src/lib/makerMeerderheid.js';

let n = 0;
const s = (theaterId, maker, titel = 'Teckel') => ({ id: `${theaterId}-${++n}`, theaterId, titel, maker, datum: '2027-02-11', tijd: '20:30' });

test('lege maker neemt de ene maker over; makerBron bewaard (ook null)', () => {
  const invoer = [s('bellevue', 'Nina van Tongeren'), s('ssu', null), s('schuur', undefined), s('kunstlinie', '  ')];
  const { shows, gewijzigd } = pasMakerMeerderheidToe(invoer);
  assert.deepEqual(shows.map((x) => x.maker), Array(4).fill('Nina van Tongeren'));
  assert.equal(shows[1].makerBron, null);
  assert.equal(shows[2].makerBron, null);
  assert.equal(shows[3].makerBron, '  ');
  assert.equal('makerBron' in shows[0], false);
  assert.equal(gewijzigd, 3);
});

test('oude data zonder makerveld: niets verzonnen', () => {
  const { shows, gewijzigd } = pasMakerMeerderheidToe([{ theaterId: 'a', titel: 'Teckel' }, { theaterId: 'b', titel: 'Teckel' }]);
  assert.equal(gewijzigd, 0);
  assert.equal(shows[0].maker, undefined);
});

test('nooit van een andere productie (andere sleutel) of een theatergebonden titel', () => {
  const { shows } = pasMakerMeerderheidToe([s('a', 'Nina van Tongeren', 'Teckel'), s('b', null, 'Teckel 2'), s('c', 'KOBRA', 'Nora'), s('d', null, 'Nora')]);
  assert.equal(shows[1].maker, null);
  assert.equal(shows[3].maker, null);
});

test('Teckel: varianten die alleen ná " / " verschillen → de kern, bij alle theaters', () => {
  assert.equal(makerSleutel('Linssen & Provily'), makerSleutel('Linssen en Provily'));
  const beslissingen = [];
  const { shows } = pasMakerMeerderheidToe(
    [
      s('mozaiek', 'Nina van Tongeren / Theater Bellevue'),
      s('zaal3', 'Nina van Tongeren – Theater Bellevue'),
      s('bellevue', 'Nina van Tongeren / Bellevue Producties'),
      s('bijlmerparktheater', 'Theater Bellevue en Nina van Tongeren'),
      s('ssu', null),
      s('schuur', null),
    ],
    { beslissingen }
  );
  assert.deepEqual(new Set(shows.map((x) => x.maker)), new Set(['Nina van Tongeren']));
  assert.equal(shows[2].makerBron, 'Nina van Tongeren / Bellevue Producties');
  assert.equal(shows[4].makerBron, null);
  assert.equal(beslissingen[0].reden, 'kern');
  // Eén stem per theater: tien speeldata bij één theater tellen als één.
  const veel = Array.from({ length: 10 }, () => s('a', 'X'));
  assert.equal(pasMakerMeerderheidToe([...veel, s('b', 'Y'), s('c', 'Y')]).shows[0].maker, 'Y');
});

test('kern: ook zonder spaties rond "/", niet in "a/d"; een maker zonder "/" telt als zijn eigen kern', () => {
  assert.equal(makerKern('Nina van Tongeren / Theater Bellevue'), 'Nina van Tongeren');
  assert.equal(makerKern('Thorn de Vries/Roeland Fernhout'), 'Thorn de Vries');
  assert.equal(makerKern('Podium Mozaiek/ Sarah Jane'), 'Podium Mozaiek');
  assert.equal(makerKern('Theater a/d Rijn / Ludwig Bindervoet'), 'Theater a/d Rijn');
  assert.equal(makerKern('Orkater'), 'Orkater');
  // "Orkater" en "Orkater / Bijlmer Parktheater": alleen verschil ná " / " → "Orkater".
  assert.equal(kiesMaker([{ theaterId: 'ita', maker: 'Orkater' }, { theaterId: 'tr25', maker: 'Orkater / Bijlmer Parktheater' }]).maker, 'Orkater');
});

test('gelijke stand opgelost door de kern', () => {
  const { shows, gewijzigd } = pasMakerMeerderheidToe([s('a', 'Nina van Tongeren / Theater Bellevue'), s('b', 'Nina van Tongeren / Bellevue Producties'), s('c', null)]);
  assert.equal(gewijzigd, 3);
  assert.deepEqual(new Set(shows.map((x) => x.maker)), new Set(['Nina van Tongeren']));
});

test('coproductie blijft: één variant met " / " wordt niet ingekort; een ander deel vóór " / " is een eigen kern', () => {
  // Alleen deze variant: heel overnemen.
  const een = pasMakerMeerderheidToe([s('a', 'Toneelgroep Maastricht / Stichting NOX'), s('b', 'Toneelgroep Maastricht / Stichting NOX'), s('c', null)]);
  assert.equal(een.shows[2].maker, 'Toneelgroep Maastricht / Stichting NOX');
  // Verschillend deel vóór " / ": gelijke stand, niets wijzigen.
  const conflicten = [];
  const invoer = [s('a', 'Thorn de Vries/Roeland Fernhout'), s('b', 'Roeland Fernhout & Thorn de Vries'), s('c', null)];
  const r = pasMakerMeerderheidToe(invoer, { conflicten });
  assert.equal(r.gewijzigd, 0);
  assert.equal(conflicten.length, 1);
});

test('verdachte maker van één theater wordt niet overgenomen, wel gemeld', () => {
  const geval = (maker, extra = []) => {
    const verdacht = [];
    const r = pasMakerMeerderheidToe([s('flint', maker, 'Nhung Dam'), s('delanding', null, 'Nhung Dam'), ...extra], { verdacht });
    return { maker: r.shows[1].maker, verdacht };
  };
  // Cijfers, kleine letter, nooit-maker-lijst.
  for (const m of ['20 jaar 3JS', 'Boney M 1976 – 2026', 'inclusief diner en concert', 'met Soy Kroon']) {
    const { maker, verdacht } = geval(m);
    assert.equal(maker, null, m);
    assert.equal(verdacht.length, 1, m);
  }
  // Titel van een andere productie (hele titel, of het eerste deel van "Voorstelling – Artiest").
  const titel = geval('Legende van de witte slang', [s('koningshof', 'Nhung Dam', 'Legende van de witte slang')]);
  assert.equal(titel.maker, null);
  assert.match(titel.verdacht[0].reden, /titel van "legende van de witte slang"/);
  assert.equal(geval('Date Night', [s('griffioen', null, 'Date Night – Alain Clark')]).maker, null);
  // Het laatste deel (de artiest) mag wel: "Jan Beuving" uit "Dekpunt – Jan Beuving".
  assert.equal(geval('Jan Beuving', [s('stoep', null, 'Dekpunt – Jan Beuving')]).maker, 'Jan Beuving');
  assert.equal(verdachtReden('Nina van Tongeren'), null);
  // Van twee theaters: niet verdacht (dezelfde regel geldt alleen voor één bron).
  const twee = pasMakerMeerderheidToe([s('a', 'Theater 155'), s('b', 'Theater 155'), s('c', null)]);
  assert.equal(twee.shows[2].maker, 'Theater 155');
  // Verandert er niets (alleen die ene speeldatum), dan ook geen melding.
  const verdacht = [];
  pasMakerMeerderheidToe([s('flint', '20 jaar 3JS', '3JS')], { verdacht });
  assert.equal(verdacht.length, 0);
});

test('gelijke stand tussen verschillende makers: niets wijzigen, wel als conflict gemeld', () => {
  const conflicten = [];
  const invoer = [s('a', 'Thorn de Vries'), s('b', 'Roeland Fernhout'), s('c', null)];
  const { shows, gewijzigd } = pasMakerMeerderheidToe(invoer, { conflicten });
  assert.equal(gewijzigd, 0);
  assert.deepEqual(shows, invoer);
  assert.equal(conflicten.length, 1);
  assert.equal(conflicten[0].sleutel, 'teckel');
  assert.deepEqual(kiesMaker([{ maker: 'A' }, { maker: 'B' }]), { maker: null, gelijk: true });
  assert.equal(kiesMaker([]), null);
});

test('binnen één theater: data zonder maker krijgen de maker van de andere data', () => {
  const { shows } = pasMakerMeerderheidToe([s('a', 'Jan Beuving'), s('a', null)]);
  assert.equal(shows[1].maker, 'Jan Beuving');
});

test('idempotent: terug naar makerBron en opnieuw toepassen geeft hetzelfde', () => {
  const invoer = [s('a', 'X'), s('b', 'X'), s('c', 'Y'), s('d', null)];
  const { shows } = pasMakerMeerderheidToe(invoer);
  const terug = shows.map(({ makerBron, ...x }) => (makerBron !== undefined ? { ...x, maker: makerBron } : x));
  assert.deepEqual(terug, invoer);
  assert.deepEqual(pasMakerMeerderheidToe(terug).shows, shows);
});

test('schrijfwijze bij gelijke telling: hoofdletter vooraan, minste hoofdletters', () => {
  assert.equal(kiesMaker([{ theaterId: 'a', maker: 'Collectief BLAUWDRUK' }, { theaterId: 'b', maker: 'Collectief Blauwdruk' }]).maker, 'Collectief Blauwdruk');
  assert.equal(kiesMaker([{ theaterId: 'a', maker: 'rightaboutnow.inc' }, { theaterId: 'b', maker: 'RIGHTABOUTNOW INC.' }]).maker, 'RIGHTABOUTNOW INC.');
});

test('verdacht: titel met toevoeging ("(try-out)", "(reprise)") telt als dezelfde titel', () => {
  const verdacht = [];
  const r = pasMakerMeerderheidToe([s('koningshof', 'Bonobo (try-out)', 'Flip Noorman'), s('x', null, 'Flip Noorman'), s('hogewoerd', 'Flip Noorman en band', 'Bonobo')], { verdacht });
  assert.equal(r.shows[1].maker, null);
  assert.match(verdacht[0].reden, /titel van "bonobo"/);
});

test('"A/B" en "A – B" blijven dezelfde maker (geen gelijke stand door de kern)', () => {
  const conflicten = [];
  const { shows } = pasMakerMeerderheidToe([s('bellevue', 'Theater Rotterdam/Mathieu Wijdeven'), s('spui', 'Theater Rotterdam – Mathieu Wijdeven'), s('x', null)], { conflicten });
  assert.equal(conflicten.length, 0);
  assert.equal(shows[2].maker, 'Theater Rotterdam – Mathieu Wijdeven');
});
