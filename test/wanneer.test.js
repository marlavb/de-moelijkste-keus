import { test } from 'node:test';
import assert from 'node:assert/strict';
import { amsterdamDatum } from '../public/js/plannen.js';
import { snelBereik, wanneerBereik, matchtWanneer, weekdagVan, plusDagen, normaliseerWanneer, legeWanneer, kiesSnel, kiesDatum, wisselDag, isWanneerActief, heeftBereik } from '../public/js/wanneer.js';

const w = (extra) => ({ ...legeWanneer(), ...extra });

test('wanneer: vandaag in Amsterdam rond middernacht, zomer- en wintertijd (vaste klok)', () => {
  // Zomertijd (UTC+2): 22:30 UTC op 17 okt = 00:30 op za 18 okt in Amsterdam.
  assert.equal(amsterdamDatum(Date.parse('2026-10-17T22:30:00Z')), '2026-10-18');
  assert.equal(amsterdamDatum(Date.parse('2026-10-17T21:59:00Z')), '2026-10-17');
  // Wintertijd (UTC+1): 23:30 UTC op 1 dec = 00:30 op 2 dec.
  assert.equal(amsterdamDatum(Date.parse('2026-12-01T23:30:00Z')), '2026-12-02');
  assert.equal(amsterdamDatum(Date.parse('2026-12-01T22:59:00Z')), '2026-12-01');
  // Overgang naar wintertijd (zo 25 okt 2026, 03:00 → 02:00).
  assert.equal(amsterdamDatum(Date.parse('2026-10-24T23:30:00Z')), '2026-10-25');
  // Vandaag/morgen volgen die datum: om 00:30 (Amsterdam) is "vandaag" al de nieuwe dag.
  const nacht = amsterdamDatum(Date.parse('2026-10-17T22:30:00Z'));
  assert.deepEqual(snelBereik('vandaag', nacht), { van: '2026-10-18', tot: '2026-10-18' });
  assert.deepEqual(snelBereik('morgen', nacht), { van: '2026-10-19', tot: '2026-10-19' });
  assert.equal(matchtWanneer('2026-10-17', w({ snel: 'vandaag' }), nacht), false);
  assert.equal(matchtWanneer('2026-10-18', w({ snel: 'vandaag' }), nacht), true);
});

test('wanneer: weekdagen en datumrekenen over maand-, jaar- en tijdgrenzen', () => {
  assert.equal(weekdagVan('2026-10-12'), 1); // ma
  assert.equal(weekdagVan('2026-10-18'), 7); // zo
  assert.equal(weekdagVan('2026-10-25'), 7); // zo, dag van de klokwissel
  assert.equal(weekdagVan('2027-03-28'), 7); // zo, zomertijd in
  assert.equal(plusDagen('2026-10-31', 1), '2026-11-01');
  assert.equal(plusDagen('2026-12-31', 1), '2027-01-01');
  assert.equal(plusDagen('2026-10-24', 2), '2026-10-26');
  assert.equal(plusDagen('2028-02-28', 1), '2028-02-29');
});

test('wanneer: "Dit weekend" is vr–zo; op vr, za en zo vanaf vandaag', () => {
  assert.deepEqual(snelBereik('weekend', '2026-10-12'), { van: '2026-10-16', tot: '2026-10-18' }); // ma
  assert.deepEqual(snelBereik('weekend', '2026-10-15'), { van: '2026-10-16', tot: '2026-10-18' }); // do
  assert.deepEqual(snelBereik('weekend', '2026-10-16'), { van: '2026-10-16', tot: '2026-10-18' }); // vr
  assert.deepEqual(snelBereik('weekend', '2026-10-17'), { van: '2026-10-17', tot: '2026-10-18' }); // za
  assert.deepEqual(snelBereik('weekend', '2026-10-18'), { van: '2026-10-18', tot: '2026-10-18' }); // zo
  // Over de maandgrens: do 29 okt → vr 30 okt t/m zo 1 nov.
  assert.deepEqual(snelBereik('weekend', '2026-10-29'), { van: '2026-10-30', tot: '2026-11-01' });
});

test('wanneer: deze week, volgende week en deze maand', () => {
  assert.deepEqual(snelBereik('week', '2026-10-14'), { van: '2026-10-14', tot: '2026-10-18' }); // wo
  assert.deepEqual(snelBereik('week', '2026-10-18'), { van: '2026-10-18', tot: '2026-10-18' }); // zo
  assert.deepEqual(snelBereik('week', '2026-10-12'), { van: '2026-10-12', tot: '2026-10-18' }); // ma
  assert.deepEqual(snelBereik('volgendeWeek', '2026-10-14'), { van: '2026-10-19', tot: '2026-10-25' });
  assert.deepEqual(snelBereik('volgendeWeek', '2026-10-18'), { van: '2026-10-19', tot: '2026-10-25' }); // zo: morgen begint volgende week
  assert.deepEqual(snelBereik('volgendeWeek', '2026-10-28'), { van: '2026-11-02', tot: '2026-11-08' }); // over de maandgrens
  assert.deepEqual(snelBereik('volgendeWeek', '2026-12-30'), { van: '2027-01-04', tot: '2027-01-10' }); // over de jaargrens
  assert.deepEqual(snelBereik('maand', '2026-10-12'), { van: '2026-10-12', tot: '2026-10-31' });
  assert.deepEqual(snelBereik('maand', '2026-11-30'), { van: '2026-11-30', tot: '2026-11-30' });
  assert.deepEqual(snelBereik('maand', '2028-02-10'), { van: '2028-02-10', tot: '2028-02-29' });
  assert.deepEqual(snelBereik('maand', '2026-12-05'), { van: '2026-12-05', tot: '2026-12-31' });
});

test('wanneer: eigen datums (alleen van = vanaf, van = tot = één dag, omgedraaid rechtgezet)', () => {
  const v = '2026-10-12';
  assert.deepEqual(wanneerBereik(w({ van: '2026-11-01' }), v), { van: '2026-11-01', tot: null });
  assert.deepEqual(wanneerBereik(w({ tot: '2026-11-01' }), v), { van: null, tot: '2026-11-01' });
  assert.deepEqual(wanneerBereik(w({ van: '2026-11-05', tot: '2026-11-01' }), v), { van: '2026-11-01', tot: '2026-11-05' });
  assert.equal(wanneerBereik(w({ dagen: [1] }), v), null);
  const eenDag = w({ van: '2026-11-03', tot: '2026-11-03' });
  assert.equal(matchtWanneer('2026-11-03', eenDag, v), true);
  assert.equal(matchtWanneer('2026-11-02', eenDag, v), false);
  assert.equal(matchtWanneer('2026-11-04', eenDag, v), false);
  assert.equal(matchtWanneer('2027-06-01', w({ van: '2026-11-01' }), v), true);
  assert.equal(matchtWanneer('2026-10-31', w({ van: '2026-11-01' }), v), false);
});

test('wanneer: weekdagen, ook samen met een snelkeuze of datums; niets = alles', () => {
  const v = '2026-10-12';
  const maDo = w({ dagen: [1, 4] });
  assert.equal(matchtWanneer('2026-10-12', maDo, v), true); // ma
  assert.equal(matchtWanneer('2026-10-15', maDo, v), true); // do
  assert.equal(matchtWanneer('2026-10-14', maDo, v), false); // wo
  // Volgende week, alleen zaterdag.
  const za = w({ snel: 'volgendeWeek', dagen: [6] });
  assert.equal(matchtWanneer('2026-10-24', za, v), true);
  assert.equal(matchtWanneer('2026-10-17', za, v), false); // deze week
  assert.equal(matchtWanneer('2026-10-25', za, v), false); // zo
  assert.equal(matchtWanneer('2027-01-01', legeWanneer(), v), true);
  assert.equal(isWanneerActief(legeWanneer()), false);
  assert.equal(isWanneerActief(maDo), true);
  assert.equal(heeftBereik(maDo), false);
  assert.equal(heeftBereik(w({ snel: 'maand' })), true);
});

test('wanneer: snelkeuze en datums sluiten elkaar uit; bewaarde vorm wordt opgeschoond', () => {
  let k = kiesSnel(legeWanneer(), 'weekend');
  assert.equal(k.snel, 'weekend');
  k = kiesDatum(k, 'van', '2026-11-01');
  assert.deepEqual([k.snel, k.van], [null, '2026-11-01']);
  k = kiesSnel(k, 'morgen');
  assert.deepEqual([k.snel, k.van, k.tot], ['morgen', '', '']);
  k = kiesSnel(k, 'morgen'); // nogmaals = uit
  assert.equal(k.snel, null);
  k = wisselDag(wisselDag(wisselDag(k, 4), 1), 4);
  assert.deepEqual(k.dagen, [1]);
  assert.deepEqual(normaliseerWanneer(undefined), legeWanneer());
  assert.deepEqual(normaliseerWanneer({ snel: 'onzin', van: '1-11-2026', tot: '2026-11-05', dagen: [0, 3, 3, 8, 'ma'] }), { snel: null, van: '', tot: '2026-11-05', dagen: [3] });
  assert.deepEqual(normaliseerWanneer({ snel: 'maand', van: '2026-11-01' }).snel, null);
});
