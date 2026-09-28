import { test } from 'node:test';
import assert from 'node:assert/strict';

import { isCloudflareChallenge } from '../src/sites/flint.js';

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
