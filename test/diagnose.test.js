// Tests voor de diagnose bij een mislukte scrape (src/lib/diagnose.js).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { zonderPersoonsgegevens, paginaDiagnose, gaNaar } from '../src/lib/diagnose.js';

test('body zonder e-mail en telefoonnummer, ingekort', () => {
  assert.equal(zonderPersoonsgegevens('Mail  kassa@theater.nl\nof bel 010 - 41 18 110'), 'Mail [e-mail] of bel [telefoon]');
  assert.equal(zonderPersoonsgegevens('x'.repeat(400)).length, 301);
});

test('diagnoseregel: status, URL na redirect, titel en body', async () => {
  const page = {
    url: () => 'https://example.test/challenge',
    title: async () => 'Just a moment...',
    evaluate: async () => 'Checking your browser before accessing example.test.',
  };
  const regel = await paginaDiagnose(page, { status: 403, url: 'https://example.test/agenda' });
  assert.match(regel, /HTTP 403/);
  assert.match(regel, /URL https:\/\/example\.test\/challenge \(laatste antwoord van https:\/\/example\.test\/agenda\)/);
  assert.match(regel, /titel "Just a moment\.\.\."/);
  assert.match(regel, /body: "Checking your browser/);
  assert.equal(await paginaDiagnose({}, {}), null);
});

function nepPagina({ antwoord }) {
  const luisteraars = new Set();
  const frame = {};
  return {
    mainFrame: () => frame,
    on: (_, f) => luisteraars.add(f),
    off: (_, f) => luisteraars.delete(f),
    goto: async () => {
      if (antwoord) for (const f of luisteraars) f({ request: () => ({ isNavigationRequest: () => true }), frame: () => frame, status: () => 200 });
      throw new Error('page.goto: Timeout 45000ms exceeded.\nCall log: …');
    },
  };
}

test('gaNaar noemt de stap: verbinden of laden', async () => {
  await assert.rejects(gaNaar(nepPagina({ antwoord: false }), 'u', { timeout: 45000 }), /stap: verbinden \(geen antwoord van de server binnen 45 s\)/);
  await assert.rejects(gaNaar(nepPagina({ antwoord: true }), 'u', { timeout: 45000 }), /stap: laden \(HTTP 200 na \d+\.\d s/);
});
