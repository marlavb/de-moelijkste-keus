// Tests voor het ophalen van robots.txt (src/lib/robots.js) met een
// nep-fetch — geen netwerk.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { loadRobotsRules } from '../src/lib/robots.js';

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

test('netwerkfout (ook na retry) → behoudend 5s, met logregel', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls++;
    throw new TypeError('fetch failed');
  };
  const { rules, logs } = await load(fetchImpl);
  assert.equal(calls, 2, 'één retry');
  assert.equal(rules.crawlDelayMs, 5000);
  assert.match(logs[0], /fetch failed.*behoudend/);
});

test('bevestigde 404 → geen regels, 0ms, geen logregel', async () => {
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
