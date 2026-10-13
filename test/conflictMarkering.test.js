import { test } from 'node:test';
import assert from 'node:assert/strict';
import { vindMarkering } from '../src/lib/conflictMarkering.js';

test('conflictmarkeringen: <<<<<<<, =======, >>>>>>> aan het begin van een regel; Markdown-kop niet (13 okt 2026)', () => {
  assert.deepEqual(vindMarkering('a\n<<<<<<< HEAD\nb\n=======\nc\n>>>>>>> tak\n', 'x.css'), { regel: 2, tekst: '<<<<<<< HEAD' });
  assert.deepEqual(vindMarkering('a\n=======\nb\n', 'x.js'), { regel: 2, tekst: '=======' });
  assert.deepEqual(vindMarkering('a\n>>>>>>> vindbaar-standaard-uit\n', 'x.css'), { regel: 2, tekst: '>>>>>>> vindbaar-standaard-uit' });
  assert.deepEqual(vindMarkering('a\r\n<<<<<<<\r\n', 'x.js'), { regel: 2, tekst: '<<<<<<<' });
  // Geen markering: ingesprongen, midden in een regel, langer, of een Markdown-kop.
  assert.equal(vindMarkering('  <<<<<<< HEAD\nx = "=======";\n========\n', 'x.js'), null);
  assert.equal(vindMarkering('# Kop\n=======\ntekst\n', 'README.md'), null);
  // In Markdown wel, als er ook een buitenmarkering staat.
  assert.deepEqual(vindMarkering('<<<<<<< HEAD\na\n=======\nb\n>>>>>>> x\n', 'README.md'), { regel: 1, tekst: '<<<<<<< HEAD' });
});
