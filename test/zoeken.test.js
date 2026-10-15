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

test('zoeken: korte zoekterm (≤ 3 tekens) vanaf het begin van een woord, langere ook midden in een woord (15 okt 2026)', () => {
  // "NDT" niet meer in "Brandt", "Grondtonen", "Soundtrack"; wel "NDT1" en "(NDT 2)".
  assert.equal(matchtZoekterm(liefde, 'NDT'), false);
  assert.equal(matchtZoekterm({ titel: 'Grondtonen (9+)', maker: 'Het Houten Huis' }, 'ndt'), false);
  assert.equal(matchtZoekterm({ titel: 'Out of the stillness', maker: 'Nederlands Dans Theater (NDT 1)' }, 'ndt'), true);
  assert.equal(matchtZoekterm({ titel: 'Filmvertoning: Into the Hairy – NDT1' }, 'ndt'), true);
  assert.equal(matchtZoekterm({ titel: 'Evita' }, 'ita'), false);
  // Vier tekens of meer: ook in samenstellingen.
  assert.equal(matchtZoekterm({ titel: 'KYLIAN', maker: 'Introdans' }, 'dans'), true);
  assert.equal(matchtZoekterm({ titel: 'Babykerstconcert (0+)' }, 'kerst'), true);
  assert.equal(matchtZoekterm({ titel: 'KINO: Rembrandt Frerichs' }, 'brandt'), true);
  // Tekens met een betekenis in een reguliere expressie breken niets.
  assert.equal(matchtZoekterm({ titel: 'C++ voor beginners' }, 'c++'), true);
  assert.equal(matchtZoekterm({ titel: 'Abc' }, 'a.c'), false);
});
