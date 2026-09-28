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
