import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aandeslingerWeglaten } from '../src/sites/aandeslinger.js';

test('Aan de Slinger: films en cursussen weg, voorstellingen niet (9 okt 2026)', () => {
  assert.equal(aandeslingerWeglaten({ tags: ['Film'], titel: 'Vroege Film: Calle Málaga' }), 'film');
  assert.equal(aandeslingerWeglaten({ tags: [], titel: 'Vroege Film: Mother' }), 'film');
  assert.equal(aandeslingerWeglaten({ tags: ['Cursus'], titel: 'TS - Theaterklas 6-8 (maandag) - 2026' }), 'cursus');
  assert.equal(aandeslingerWeglaten({ tags: ['Toneel'], titel: 'De film van mijn leven' }), null);
  assert.equal(aandeslingerWeglaten({ tags: ['Gastbespeling'], titel: 'Vrouwejaars' }), null);
});
