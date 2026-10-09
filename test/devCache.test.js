import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';

import { devCacheEnabled, installDevCache } from '../src/lib/devCache.js';

test('devcache: alleen aan met SCRAPE_CACHE=1 en nooit in CI', () => {
  assert.equal(devCacheEnabled({}), false);
  assert.equal(devCacheEnabled({ SCRAPE_CACHE: '1' }), true);
  assert.equal(devCacheEnabled({ SCRAPE_CACHE: '1', CI: 'true' }), false);
  assert.equal(devCacheEnabled({ SCRAPE_CACHE: '1', GITHUB_ACTIONS: 'true' }), false);
  assert.equal(devCacheEnabled({ SCRAPE_CACHE: '0' }), false);
});

test('devcache: tweede keer laden komt uit de cache, zonder request naar de site', async () => {
  let hits = 0;
  const server = http.createServer((req, res) => {
    hits++;
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(`<html><body><h1>agenda ${hits}</h1></body></html>`);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}/agenda`;
  const dir = await mkdtemp(path.join(tmpdir(), 'devcache-'));
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const cache = await installDevCache(page, { dir, log: () => {} });
    await page.goto(url);
    assert.equal(await page.textContent('h1'), 'agenda 1');
    await page.goto(url);
    assert.equal(await page.textContent('h1'), 'agenda 1', 'zelfde HTML uit de cache');
    assert.equal(hits, 1, 'de site kreeg maar één request');
    assert.deepEqual(cache.stats(), { hits: 1, misses: 1 });
  } finally {
    await browser.close();
    server.close();
  }
});

test('devcache offline (SCRAPE_OFFLINE=1): wat niet in de cache staat, gaat niet naar de site', async () => {
  let hits = 0;
  const server = http.createServer((req, res) => {
    hits++;
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<html><body><h1>agenda</h1></body></html>');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}/nieuw`;
  const dir = await mkdtemp(path.join(tmpdir(), 'devcache-'));
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await installDevCache(page, { dir, log: () => {}, offline: true });
    await assert.rejects(page.goto(url));
    assert.equal(hits, 0, 'geen request naar de site');
  } finally {
    await browser.close();
    server.close();
  }
});

test('metDevCache: zonder SCRAPE_CACHE gewoon ophalen; met cache één keer; offline zonder cache een fout, geen verzoek', async () => {
  const { metDevCache } = await import('../src/lib/devCache.js');
  const { mkdtemp, rm } = await import('node:fs/promises');
  const os = await import('node:os');
  const pathMod = await import('node:path');
  const dir = await mkdtemp(pathMod.join(os.tmpdir(), 'devcache-json-'));
  let n = 0;
  const ophalen = async () => ({ keer: ++n });
  try {
    assert.deepEqual(await metDevCache('https://site.test/api', 'a', ophalen, { dir, env: {} }), { keer: 1 });
    const aan = { SCRAPE_CACHE: '1' };
    assert.deepEqual(await metDevCache('https://site.test/api', 'a', ophalen, { dir, env: aan }), { keer: 2 });
    assert.deepEqual(await metDevCache('https://site.test/api', 'a', ophalen, { dir, env: aan }), { keer: 2 }, 'uit de cache');
    const offline = { SCRAPE_CACHE: '1', SCRAPE_OFFLINE: '1' };
    assert.deepEqual(await metDevCache('https://site.test/api', 'a', ophalen, { dir, env: offline }), { keer: 2 });
    await assert.rejects(metDevCache('https://site.test/api', 'b', ophalen, { dir, env: offline }), /offline/);
    assert.equal(n, 2, 'offline: geen verzoek');
    assert.deepEqual(await metDevCache('https://site.test/api', 'b', ophalen, { dir, env: { ...aan, CI: 'true' } }), { keer: 3 }, 'CI: nooit uit de cache');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
