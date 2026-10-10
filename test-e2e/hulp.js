// Hulp voor de end-to-end-tests (npm run test:e2e): een statische server voor
// public/ met een vaste agenda (vasteShows), de Firebase-emulators (Auth en Firestore, project
// demo-podiumagenda, met de echte firestore.rules) via hun REST-ingangen, en
// browsercontexten op telefoonformaat die met ?emulator=1 inloggen.

import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { TIJDZONE, vandaag as vandaagAmsterdam } from '../test/datum.js';

export const PROJECT = 'demo-podiumagenda';
const FIRESTORE = 'http://127.0.0.1:8085';
const AUTH = 'http://127.0.0.1:9099';
const DOCS = `${FIRESTORE}/v1/projects/${PROJECT}/databases/(default)/documents`;
const ROOT = new URL('../public/', import.meta.url).pathname;
export const SCHERMAFBEELDINGEN = new URL('../debug/e2e-screenshots/', import.meta.url).pathname;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };

export function controleerEmulators() {
  if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST) {
    throw new Error('Geen emulators: draai deze tests via `npm run test:e2e` in de root.');
  }
}

/**
 * De vaste agenda van de tests (test-e2e/fixtures/shows.json, gemaakt met
 * scripts/e2e-fixture.js): `dagen` → `datum` vanaf vandaag (Amsterdam), zodat
 * de tests niet afhangen van de echte data en de fixture niet veroudert.
 */
export async function vasteShows() {
  const { shows } = JSON.parse(await readFile(new URL('./fixtures/shows.json', import.meta.url), 'utf-8'));
  const basis = Date.parse(`${vandaagAmsterdam()}T12:00:00Z`);
  return shows.map(({ dagen, ...s }) => ({ ...s, datum: new Date(basis + dagen * 86_400_000).toISOString().slice(0, 10) }));
}

export async function startServer() {
  const agenda = JSON.stringify(await vasteShows());
  const server = createServer(async (req, res) => {
    const pad = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    // De agenda komt uit de fixture, niet uit public/data.
    if (pad === '/data/shows.json') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(agenda);
      return;
    }
    const file = path.join(ROOT, pad.endsWith('/') ? `${pad}index.html` : pad);
    try {
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { server, base: `http://127.0.0.1:${server.address().port}/` };
}

/** Alles in de emulators leegmaken. */
export async function wisEmulators() {
  await fetch(`${FIRESTORE}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
  await fetch(`${AUTH}/emulator/v1/projects/${PROJECT}/accounts`, { method: 'DELETE' });
}

/** Een nepaccount in de Auth-emulator; geeft de uid. */
export async function maakAccount({ email, wachtwoord, naam }) {
  const r = await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-sleutel`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: wachtwoord, displayName: naam, returnSecureToken: true }),
  });
  const j = await r.json();
  if (!j.localId) throw new Error(`Account maken mislukt: ${JSON.stringify(j)}`);
  return j.localId;
}

// Firestore REST-waarde → gewone waarde.
function waarde(v) {
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('nullValue' in v) return null;
  if ('timestampValue' in v) return v.timestampValue;
  if ('mapValue' in v) return velden(v.mapValue.fields ?? {});
  if ('arrayValue' in v) return (v.arrayValue.values ?? []).map(waarde);
  return v;
}
const velden = (f) => Object.fromEntries(Object.entries(f).map(([k, v]) => [k, waarde(v)]));
const alsBeheerder = { headers: { Authorization: 'Bearer owner' } };

/** Eén document zonder rules (als beheerder), of null. */
export async function leesDoc(pad) {
  const r = await fetch(`${DOCS}/${pad}`, alsBeheerder);
  if (r.status === 404) return null;
  const j = await r.json();
  return velden(j.fields ?? {});
}

/** Alle documenten in een collectie (zonder rules): [{ pad, data }]. */
export async function lijst(pad) {
  const r = await fetch(`${DOCS}/${pad}?pageSize=300`, alsBeheerder);
  const j = await r.json();
  return (j.documents ?? []).map((d) => ({ pad: d.name.split('/documents/')[1], data: velden(d.fields ?? {}) }));
}

/** Alle documenten in alle collecties met deze naam (ook in subcollecties). */
export async function alleIn(collectie) {
  const r = await fetch(`${DOCS}:runQuery`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', Authorization: 'Bearer owner' },
    body: JSON.stringify({ structuredQuery: { from: [{ collectionId: collectie, allDescendants: true }] } }),
  });
  const j = await r.json();
  return j.filter((x) => x.document).map((x) => ({ pad: x.document.name.split('/documents/')[1], data: velden(x.document.fields ?? {}) }));
}

/**
 * Een browsercontext (390×844) voor één gebruiker; met `account` ingelogd via
 * de testlogin (alleen in de emulatormodus). Deelmenu en klembord zijn nep.
 */
export async function openGebruiker(browser, base, account = null, hash = '#/profiel') {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block', timezoneId: TIJDZONE });
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await ctx.addInitScript(() => {
    window.__gedeeld = [];
    Object.defineProperty(Navigator.prototype, 'share', { configurable: true, value: async (d) => { window.__gedeeld.push(d); } });
    Object.defineProperty(Navigator.prototype, 'clipboard', { configurable: true, get: () => ({ writeText: async () => {} }) });
  });
  const page = await ctx.newPage();
  const fouten = [];
  page.on('pageerror', (e) => fouten.push(e.message));
  page.on('dialog', (d) => { fouten.push(`dialoog: ${d.message()}`); d.dismiss(); });
  await page.goto(`${base}?emulator=1${hash}`);
  await page.waitForSelector('.nav-item', { state: 'attached' });
  if (account) {
    await page.waitForFunction(() => typeof window.__e2eLogin === 'function');
    await page.evaluate(([e, w]) => window.__e2eLogin(e, w), [account.email, account.wachtwoord]);
  }
  return { ctx, page, fouten };
}

/** Naar een route binnen de app (zelfde tabblad, testmodus blijft). */
export async function ga(page, base, hash) {
  const url = `${base}?emulator=1${hash}`;
  // Naar dezelfde URL navigeren doet niets (geen route): dan herladen.
  if (page.url() === url) await page.reload();
  else await page.goto(url);
  await page.waitForSelector('.nav-item', { state: 'attached' });
}

/** Wachten tot de tekst van `selector` aan `patroon` voldoet. */
export async function wachtOpTekst(page, selector, patroon, timeout = 15000) {
  try {
    await page.waitForFunction(
      ([sel, bron, vlaggen]) => {
        const el = document.querySelector(sel);
        return el && new RegExp(bron, vlaggen).test(el.textContent);
      },
      [selector, patroon.source, patroon.flags],
      { timeout }
    );
  } catch (err) {
    const werkelijk = await page.evaluate((sel) => document.querySelector(sel)?.textContent ?? '(geen element)', selector).catch(() => '?');
    throw new Error(`${selector} voldoet niet aan ${patroon} (${page.url()}): ${JSON.stringify(werkelijk)}`, { cause: err });
  }
}

/** Wachten tot een document (zonder rules) aan `test` voldoet. */
export async function wachtOpDoc(pad, test = (d) => d !== null, timeout = 15000) {
  const eind = Date.now() + timeout;
  for (;;) {
    const d = await leesDoc(pad);
    if (test(d)) return d;
    if (Date.now() > eind) throw new Error(`Timeout op ${pad}: ${JSON.stringify(d)}`);
    await new Promise((r) => setTimeout(r, 250));
  }
}

export async function schermafbeelding(page, naam) {
  await mkdir(SCHERMAFBEELDINGEN, { recursive: true });
  await page.screenshot({ path: path.join(SCHERMAFBEELDINGEN, `${naam}.png`) });
}

// Gewone waarde → Firestore REST-waarde (voor schrijfDoc).
function naarRest(v) {
  if (v === null) return { nullValue: null };
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(naarRest) } };
  return { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, w]) => [k, naarRest(w)])) } };
}

/** Eén document schrijven zonder rules (als beheerder), bv. een situatie van vóór een deploy. */
export async function schrijfDoc(pad, data) {
  const r = await fetch(`${DOCS}/${pad}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', Authorization: 'Bearer owner' },
    body: JSON.stringify({ fields: naarRest(data).mapValue.fields }),
  });
  if (!r.ok) throw new Error(`schrijfDoc ${pad}: ${r.status}`);
}

/** Eén document weghalen zonder rules (als beheerder). */
export async function wisDoc(pad) {
  await fetch(`${DOCS}/${pad}`, { method: 'DELETE', headers: { Authorization: 'Bearer owner' } });
}
