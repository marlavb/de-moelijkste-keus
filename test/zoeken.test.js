import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchtZoekterm, zoekVorm, zoekTeksten } from '../public/js/zoeken.js';

const blast = { titel: 'Blast a universe', maker: 'NDT 2', theaterNaam: 'Stadsschouwburg Utrecht', stad: 'Utrecht', theaterId: 'stadsschouwburgutrecht' };
const liefde = { titel: 'Over de Liefde – Aaf Brandt Corstius & Lies Visschedijk', maker: null, theaterNaam: 'Theater Kikker', stad: 'Utrecht' };

test('zoeken: ook in de maker en de getoonde titel ("NDT" vindt "Blast a universe – NDT 2", 15 okt 2026)', () => {
  assert.equal(matchtZoekterm(blast, 'NDT'), true);
  assert.equal(matchtZoekterm(blast, 'ndt 2'), true);
  assert.equal(matchtZoekterm(blast, 'universe – ndt'), true, 'getoonde titel met maker');
  assert.equal(matchtZoekterm(blast, 'blast'), true);
  assert.equal(matchtZoekterm(liefde, 'Brandt'), true);
  assert.equal(matchtZoekterm(blast, 'poem'), false);
});

test('zoeken: theater, stad, zoekaliassen, brontitel, accenten en lege zoekterm', () => {
  assert.equal(matchtZoekterm(blast, 'utrecht'), true);
  assert.equal(matchtZoekterm({ ...blast, theaterNaam: 'Koninklijk Theater Carré', stad: 'Amsterdam' }, 'carre'), true);
  assert.equal(matchtZoekterm({ ...blast, theaterNaam: 'Internationaal Theater Amsterdam' }, 'ita', { aliassen: ['ita'] }), true);
  assert.equal(matchtZoekterm({ ...blast, titelBron: 'NDT 2 – Blast a universe' }, 'ndt 2 – blast'), true);
  assert.equal(matchtZoekterm(blast, ''), true);
  assert.equal(matchtZoekterm(blast, '   '), true);
  assert.equal(zoekVorm('  Carré   Amsterdam '), 'carre amsterdam');
  assert.deepEqual(zoekTeksten({ titel: 'Teckel', maker: 'Nina van Tongeren', theaterNaam: 'Theater Bellevue', stad: 'Amsterdam' }),
    ['Teckel – Nina van Tongeren', 'Nina van Tongeren', 'Theater Bellevue', 'Amsterdam']);
});
