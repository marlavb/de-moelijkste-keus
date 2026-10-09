// Tests voor het ophalen van robots.txt (src/lib/robots.js) met een
// nep-fetch — geen netwerk.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { loadRobotsRules, RobotsOnbereikbaarError } from '../src/lib/robots.js';

const ROBOTS = 'User-agent: *\nDisallow: /*?*\nAllow: /*?page=*\nCrawl-delay: 5\n';

function response(status, { body = '', location, setCookie = [] } = {}) {
  const headers = new Headers();
  if (location) headers.set('location', location);
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (k) => headers.get(k), getSetCookie: () => setCookie },
    text: async () => body,
  };
}

async function load(fetchImpl) {
  const logs = [];
  const rules = await loadRobotsRules('https://site.test', 'UA', 'bot', { fetchImpl, log: (m) => logs.push(m) });
  return { rules, logs };
}

test('wachtrij met cookie (BunnyCDN /csq/): cookie wordt meegestuurd en de echte robots.txt gelezen', async () => {
  const fetchImpl = async (url, { headers }) => {
    const path = new URL(url).pathname;
    const cookie = headers.Cookie ?? '';
    if (path === '/robots.txt' && cookie.includes('csq_token=ok')) return response(200, { body: ROBOTS });
    if (path === '/robots.txt') return response(307, { location: '/csq/', setCookie: ['csq_target_url=x; Path=/'] });
    if (path === '/csq/' && cookie.includes('csq_target_url=x')) {
      return response(308, { location: '/robots.txt', setCookie: ['csq_token=ok; Path=/; HttpOnly'] });
    }
    return response(307, { location: '/csq/' });
  };
  const { rules, logs } = await load(fetchImpl);
  assert.equal(rules.crawlDelayMs, 5000);
  assert.equal(rules.isAllowed('/agenda?page=2'), true);
  assert.equal(rules.isAllowed('/agenda?start=1'), false);
  assert.deepEqual(logs, [], 'geen terugval nodig');
});

test('redirectlus → behoudend 5s, met logregel', async () => {
  const fetchImpl = async () => response(307, { location: '/csq/' });
  const { rules, logs } = await load(fetchImpl);
  assert.equal(rules.crawlDelayMs, 5000);
  assert.equal(logs.length, 1);
  assert.match(logs[0], /redirectlus.*behoudend 5000ms/);
});

// RFC 9309 §2.3.1.4: robots.txt onbereikbaar (5xx, time-out, netwerkfout)
// = alles verboden. Dan gooit loadRobotsRules en slaat de run het theater
// over (terugval op de vorige data); een 4xx blijft "geen regels" (8 okt 2026).
test('netwerkfout (ook na retry) → RobotsOnbereikbaarError met de foutcode in de melding', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls++;
    throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } });
  };
  await assert.rejects(load(fetchImpl), (err) => {
    assert.ok(err instanceof RobotsOnbereikbaarError);
    assert.equal(err.message, 'robots.txt niet bereikbaar (fetch failed: ENOTFOUND)');
    return true;
  });
  assert.equal(calls, 2, 'één retry');
});

test('5xx (ook na retry) → RobotsOnbereikbaarError "HTTP 500", geen "geen regels"', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls++;
    return response(500, { body: 'Internal Server Error' });
  };
  await assert.rejects(load(fetchImpl), { name: 'RobotsOnbereikbaarError', message: 'robots.txt niet bereikbaar (HTTP 500)' });
  assert.equal(calls, 2, 'één retry');
});

test('503 eerst, daarna 200 → gewoon de regels van de tweede poging', async () => {
  let calls = 0;
  const fetchImpl = async () => (++calls === 1 ? response(503) : response(200, { body: ROBOTS }));
  const { rules, logs } = await load(fetchImpl);
  assert.equal(calls, 2);
  assert.equal(rules.crawlDelayMs, 5000);
  assert.equal(rules.isAllowed('/agenda?start=1'), false);
  assert.deepEqual(logs, []);
});

test('time-out (ook na retry) → RobotsOnbereikbaarError "time-out"', async () => {
  const fetchImpl = async () => {
    throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
  };
  await assert.rejects(load(fetchImpl), { name: 'RobotsOnbereikbaarError', message: /robots\.txt niet bereikbaar \(time-out na \d+ s\)/ });
});

test('de fetch krijgt een eigen time-out-signaal mee, ook zonder signal van de run', async () => {
  let gekregen;
  await load(async (url, opts) => {
    gekregen = opts.signal;
    return response(200, { body: ROBOTS });
  });
  assert.ok(gekregen instanceof AbortSignal);
});

test('afgebroken door het budget van de run → die reden, niet "onbereikbaar"', async () => {
  const controller = new AbortController();
  const reden = new Error('timeout na 10 min');
  const fetchImpl = async () => {
    controller.abort(reden);
    throw new DOMException('aborted', 'AbortError');
  };
  await assert.rejects(loadRobotsRules('https://site.test', 'UA', 'bot', { fetchImpl, signal: controller.signal }), (err) => err === reden);
});

test('bevestigde 404 → geen regels, 0ms, geen logregel (blijft zo na RFC 9309-aanpassing)', async () => {
  const { rules, logs } = await load(async () => response(404));
  assert.equal(rules.crawlDelayMs, 0);
  assert.equal(rules.isAllowed('/wat?dan=ook'), true);
  assert.deepEqual(logs, []);
});

test('redirect naar een andere pagina (inlogpagina) → behoudend 5s', async () => {
  const fetchImpl = async (url) =>
    new URL(url).pathname === '/robots.txt' ? response(302, { location: '/login' }) : response(200, { body: '<html>' });
  const { rules, logs } = await load(fetchImpl);
  assert.equal(rules.crawlDelayMs, 5000);
  assert.match(logs[0], /redirect naar \/login/);
});

test('403 (4xx) → geen regels, zoals RFC 9309 voor "unavailable"', async () => {
  const { rules } = await load(async () => response(403));
  assert.equal(rules.crawlDelayMs, 0);
  assert.equal(rules.isAllowed('/agenda'), true);
});
