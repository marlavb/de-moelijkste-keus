// Testmodus voor de end-to-end-tests (public/js/emulator.js): alleen op
// localhost/127.0.0.1 én met ?emulator=1. Op de live site nooit, ook niet
// met ?emulator=1; en firebase.js gebruikt daar het echte project.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { gebruikEmulator, EMULATOR_PROJECT } from '../public/js/emulator.js';

const opslag = () => {
  const m = new Map();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)) };
};

test('live site: nooit de emulator, ook niet met ?emulator=1 of een oude sessievlag', () => {
  const s = opslag();
  s.setItem('podiumagenda:emulator', '1');
  for (const hostname of ['marlavb.github.io', 'localhost.evil.com', 'evil-localhost', '127.0.0.2', '0.0.0.0', '']) {
    assert.equal(gebruikEmulator({ hostname, search: '?emulator=1' }, s), false, hostname);
  }
  assert.equal(gebruikEmulator(null, s), false);
});

test('localhost: alleen met ?emulator=1; daarna voor dit tabblad onthouden', () => {
  const s = opslag();
  assert.equal(gebruikEmulator({ hostname: 'localhost', search: '' }, s), false);
  assert.equal(gebruikEmulator({ hostname: 'localhost', search: '?emulator=0' }, s), false);
  assert.equal(gebruikEmulator({ hostname: '127.0.0.1', search: '?emulator=1' }, s), true);
  assert.equal(gebruikEmulator({ hostname: '127.0.0.1', search: '' }, s), true);
  // Zonder opslag (geblokkeerd): alleen de URL telt.
  const kapot = { getItem: () => { throw new Error('geblokkeerd'); }, setItem: () => { throw new Error('geblokkeerd'); } };
  assert.equal(gebruikEmulator({ hostname: 'localhost', search: '?emulator=1' }, kapot), true);
  assert.equal(gebruikEmulator({ hostname: 'localhost', search: '' }, kapot), false);
});

test('firebase.js: echt project standaard, het demo-project alleen via gebruikEmulator', async () => {
  const bron = await readFile(new URL('../public/js/firebase.js', import.meta.url), 'utf8');
  assert.equal(EMULATOR_PROJECT, 'demo-podiumagenda');
  assert.match(bron, /projectId: 'de-moeilijkste-keus'/);
  assert.match(bron, /const EMULATOR = gebruikEmulator\(window\.location, sessie\);/);
  assert.match(bron, /EMULATOR \? \{ apiKey: 'demo-sleutel', authDomain: 'localhost', projectId: EMULATOR_PROJECT, appId: 'demo-app' \} : firebaseConfig/);
  // De emulators en de testlogin alleen binnen if (EMULATOR).
  const blok = bron.slice(bron.indexOf('if (EMULATOR) {'));
  for (const regel of ['connectAuthEmulator(', 'connectFirestoreEmulator(', 'window.__e2eLogin']) {
    assert.equal(bron.split(regel).length - 1, 1, regel);
    assert.ok(blok.includes(regel), regel);
  }
});
