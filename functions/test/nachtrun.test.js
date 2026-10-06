// De nachtelijke run starten via de GitHub API, tegen een nep-GitHub-API
// (lokale HTTP-server): juiste URL, workflow, ref en headers; het token in
// de Authorization-header maar nergens in de logs; nette afhandeling van
// 401, 404, 500, een kapot antwoord, een timeout en een ontbrekend token.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

import { startRefresh, REPO, WORKFLOW } from '../nachtrun.js';

// Herkenbaar nep-token; scripts/test-functions.js controleert dat het
// nergens in de uitvoer staat.
const TOKEN = 'github_pat_NEP0000geheim0000nachtrun';
let server;
let api;
let verzoeken;
let antwoord; // (req, res) => void

before(async () => {
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      verzoeken.push({ method: req.method, url: req.url, headers: req.headers, body });
      antwoord(req, res);
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  api = `http://127.0.0.1:${server.address().port}`;
});

after(() => new Promise((r) => server.close(r)));

async function draai({ status = 204, body = '', token = TOKEN, timeoutMs, wacht = 0 } = {}) {
  verzoeken = [];
  antwoord = (_req, res) =>
    setTimeout(() => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(body);
    }, wacht);
  const logs = [];
  const uitkomst = await startRefresh({ token, api, timeoutMs, log: (s, extra) => logs.push({ s, ...extra }) });
  return { uitkomst, logs, verzoeken };
}

test('204: workflow_dispatch van refresh-data.yml op main, met het token alleen in de header', async () => {
  const r = await draai();
  assert.equal(r.uitkomst, 'gestart');
  assert.equal(r.verzoeken.length, 1);
  const v = r.verzoeken[0];
  assert.equal(REPO, 'marlavb/de-moelijkste-keus');
  assert.equal(WORKFLOW, 'refresh-data.yml');
  assert.equal(v.method, 'POST');
  assert.equal(v.url, '/repos/marlavb/de-moelijkste-keus/actions/workflows/refresh-data.yml/dispatches');
  assert.deepEqual(JSON.parse(v.body), { ref: 'main' });
  assert.equal(v.headers.authorization, `Bearer ${TOKEN}`);
  assert.equal(v.headers.accept, 'application/vnd.github+json');
  assert.equal(v.headers['x-github-api-version'], '2022-11-28');
  assert.ok(v.headers['user-agent']);
  assert.ok(!v.url.includes(TOKEN) && !v.body.includes(TOKEN));
  assert.deepEqual(r.logs, [{ s: 'gestart', http: 204 }]);
});

for (const [status, bericht] of [
  [401, 'Bad credentials'],
  [404, 'Not Found'],
  [500, 'Server Error'],
]) {
  test(`${status}: status "fout" met HTTP-code en melding, geen token in de log, niet gooien`, async () => {
    // Ook als GitHub het token in zijn antwoord zou herhalen.
    const r = await draai({ status, body: JSON.stringify({ message: `${bericht} (${TOKEN})`, documentation_url: 'https://docs.github.com/rest' }) });
    assert.equal(r.uitkomst, 'fout');
    assert.equal(r.verzoeken.length, 1, 'geen tweede poging');
    assert.deepEqual(r.logs, [{ s: 'fout', http: status, bericht: `${bericht} (***)` }]);
    assert.ok(!JSON.stringify(r.logs).includes(TOKEN));
  });
}

test('kapot antwoord (geen JSON): fout met ingekorte tekst', async () => {
  const r = await draai({ status: 502, body: '<html>' + 'x'.repeat(500) });
  assert.equal(r.uitkomst, 'fout');
  assert.equal(r.logs[0].http, 502);
  assert.ok(r.logs[0].bericht.length <= 200);
});

test('timeout of geen verbinding: fout, geen token in de log', async () => {
  const traag = await draai({ timeoutMs: 100, wacht: 1000 });
  assert.equal(traag.uitkomst, 'fout');
  assert.deepEqual(traag.logs, [{ s: 'fout', http: null, fout: 'timeout' }]);
  const logs = [];
  const weg = await startRefresh({ token: TOKEN, api: 'http://127.0.0.1:1', log: (s, extra) => logs.push({ s, ...extra }) });
  assert.equal(weg, 'fout');
  assert.equal(logs[0].http, null);
  assert.ok(!JSON.stringify(logs).includes(TOKEN));
});

test('geen token: niets versturen, status "geen-token"', async () => {
  const r = await draai({ token: '' });
  assert.equal(r.uitkomst, 'geen-token');
  assert.equal(r.verzoeken.length, 0);
});
