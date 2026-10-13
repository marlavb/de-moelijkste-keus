import { test } from 'node:test';
import assert from 'node:assert/strict';

import { isCloudflareChallenge, vulDagAan } from '../src/sites/flint.js';

test('Cloudflare-challenge herkennen', () => {
  assert.equal(isCloudflareChallenge({ status: 200, headers: { 'cf-mitigated': 'challenge' } }), true);
  assert.equal(isCloudflareChallenge({ status: 403, headers: { server: 'cloudflare' } }), true);
  assert.equal(isCloudflareChallenge({ status: 200, title: 'Just a moment...' }), true);
  assert.equal(isCloudflareChallenge({ status: 200, hasChallengeMarkup: true }), true);
});

test('gewone (lege) agenda is geen challenge', () => {
  assert.equal(isCloudflareChallenge({ status: 200, headers: { server: 'cloudflare' }, title: 'Agenda | Flint Theater Amersfoort' }), false);
  assert.equal(isCloudflareChallenge({ status: 404, headers: { server: 'nginx' } }), false);
});

test('Flint: kaarten zonder eigen datum krijgen de datum van de kaart ervoor (twee voorstellingen op één avond, 13 okt 2026)', async () => {
  const { readFileSync } = await import('node:fs');
  const { kaarten } = JSON.parse(readFileSync(new URL('./fixtures/flint-kaarten-2026-10-13.json', import.meta.url), 'utf-8'));
  assert.equal(kaarten.length, 302);
  assert.equal(kaarten.filter((k) => !k.dagTekst).length, 131);
  const gevuld = vulDagAan(kaarten);
  assert.equal(gevuld.filter((k) => !k.dagTekst).length, 0);
  // 27 nov: Next to Normal (met datum) én Novastar (zonder) — allebei op die dag.
  const op27 = gevuld.filter((k) => k.dagTekst === '27 nov 2026').map((k) => `${k.tijdTekst} ${k.titel}`);
  assert.deepEqual(op27, ['20:15 Next to Normal', '20:15 Novastar']);
  // Een kaart met eigen datum houdt die; niets verschuift naar een andere dag.
  assert.deepEqual(gevuld.map((k, i) => (kaarten[i].dagTekst ? k.dagTekst === kaarten[i].dagTekst : true)).every(Boolean), true);
  assert.deepEqual(vulDagAan([{ titel: 'A', dagTekst: null }]), [{ titel: 'A', dagTekst: null }], 'zonder eerdere datum blijft het leeg (wordt overgeslagen)');
});
