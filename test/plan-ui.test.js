// UI-test voor gedeelde plannen (stap 4a): vrienden uitnodigen vanuit
// Gepland, intrekken, "met wie" voor organisator en gast, kaarten, "Ik ga
// toch niet", plan opheffen, een voorbije datum, offline en namen met HTML.
// Echte app uit public/; Firebase is nepFirebase (zonder rules: die staan in
// firebase/tests/plannen.test.js).

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

import { nepFirebase } from './nepFirebase.js';
import { planIn, legeGepland } from '../public/js/gepland.js';
import { speeldagVan } from '../public/js/plannen.js';
import { TIJDZONE, vandaag as vandaagAmsterdam } from './datum.js';

const ROOT = new URL('../public/', import.meta.url).pathname;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };
const ANNA = { uid: 'u1', displayName: 'Anna de Vries', email: 'anna@example.com', photoURL: null };
const BOB = { uid: 'u2', displayName: 'Bob Jansen', email: 'bob@example.com', photoURL: null };
let server;
let base;
let browser;
let show;
let item; // gepland-item voor `show`

const profiel = (gebruikersnaam, naam) => ({ gebruikersnaam, gebruikersnaamLaag: gebruikersnaam.toLowerCase(), naam, aangemaaktOp: 1, gewijzigdOp: 1, v: 1 });
const vriend = (a, b) => ({ [`vrienden/${a}/lijst/${b}`]: { uid: b, sinds: 1, via: 'verzoek' }, [`vrienden/${b}/lijst/${a}`]: { uid: a, sinds: 1, via: 'verzoek' } });
const gebruiker = (uid, gepland = []) => ({
  [`users/${uid}`]: { profielGevraagd: true, gepland, geplandVerwijderd: [], watchlist: [], watchlistVerwijderd: [], gezien: [], gezienVerwijderd: [] },
  [`gedeeld/${uid}`]: { gezien: false, watchlist: false, gewijzigdOp: 1 },
});
let BASIS;

function planDocs({ planId = 'P1', leden, genodigden = leden.filter((l) => l.rol === 'gast').map((l) => l.uid), opgeheven = false }) {
  const docs = {
    [`plannen/${planId}`]: {
      eigenaar: 'u1', sleutel: item.sleutel, sleutelV: 4,
      voorstelling: { titel: item.titel, theaterId: item.theaterId, theaterNaam: item.theaterNaam, stad: item.stad, datum: item.datum, tijd: item.tijd },
      speeldag: speeldagVan(item.datum).getTime(), genodigden, opgeheven, aangemaaktOp: 1, gewijzigdOp: 1,
    },
  };
  for (const l of leden) docs[`plannen/${planId}/leden/${l.uid}`] = { planId, uitgenodigdDoor: 'u1', uitgenodigdOp: 1, kaarten: false, ...l };
  return docs;
}

before(async () => {
  const data = JSON.parse(await readFile(path.join(ROOT, 'data/shows.json'), 'utf-8'));
  const shows = Array.isArray(data) ? data : data.shows;
  const vandaag = vandaagAmsterdam();
  show = shows.find((s) => s.datum > vandaag && s.tijd);
  item = planIn(legeGepland(), show, 100).gepland[0];
  BASIS = {
    'profielen/u1': profiel('Anna_V', 'Anna de Vries'),
    'usernames/anna_v': { uid: 'u1', gebruikersnaam: 'Anna_V', naam: 'Anna de Vries' },
    'profielen/u2': profiel('bob', 'Bob Jansen'),
    'profielen/u3': profiel('carol', '<img src=x onerror="window.__xss=1">Carol'),
    'profielen/u4': profiel('dave', 'Dave'),
    ...vriend('u1', 'u2'),
    ...vriend('u1', 'u3'),
    ...gebruiker('u1', [item]),
  };

  server = createServer(async (req, res) => {
    const pad = decodeURIComponent(new URL(req.url, 'http://x').pathname);
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
  base = `http://127.0.0.1:${server.address().port}/`;
  browser = await chromium.launch();
});

after(async () => {
  await browser?.close();
  await new Promise((r) => server.close(r));
});

async function openApp({ wie = ANNA, docs = BASIS, hash = '#/profiel', offline = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block', timezoneId: TIJDZONE });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  await ctx.route(`${base}js/firebase.js`, (r) => r.fulfill({ contentType: 'text/javascript', body: nepFirebase({ gebruiker: wie, docs }) }));
  if (offline) await ctx.addInitScript(() => { window.__nepOffline = true; });
  const page = await ctx.newPage();
  const fouten = [];
  page.on('pageerror', (e) => fouten.push(e.message));
  page.on('dialog', (d) => { fouten.push(`dialoog: ${d.message()}`); d.dismiss(); });
  await page.goto(`${base}${hash}`);
  await page.waitForSelector('.nav-item', { state: 'attached' });
  await page.waitForTimeout(600);
  return { ctx, page, fouten };
}

const opslag = (page, pad) => page.evaluate((p) => window.__nepFirestore.get(p) ?? null, pad);
const paden = (page, begin) => page.evaluate((b) => [...window.__nepFirestore.keys()].filter((k) => k.startsWith(b)), begin);
const hash = (page) => new URL(page.url()).hash;
const tekst = (page, sel) => page.textContent(sel);
// Wachten tot de app rustig is: een paar rondes van een timer-tik (de
// nep-Firestore stuurt zijn callbacks met setTimeout 0) en twee
// animatieframes (tekenen), in plaats van een vaste wachttijd.
const rustig = (page) => page.evaluate(async () => {
  for (let i = 0; i < 3; i++) await new Promise((r) => setTimeout(() => requestAnimationFrame(() => requestAnimationFrame(r)), 0));
});
const even = (page) => rustig(page);

test('uitnodigen vanuit Gepland: gedeeld plan, leden, berichten, planId bij het eigen item; intrekken', async () => {
  const { ctx, page, fouten } = await openApp();
  await page.click('#geplandList button[aria-label^="Vrienden uitnodigen"]');
  await even(page);
  assert.equal(hash(page), `#/uitnodigen/${encodeURIComponent(item.sleutel)}`);
  assert.equal(await page.isVisible('#bottomNav'), false);
  assert.match(await tekst(page, '#uitnodigenInhoud'), /nog 10 van de 10 plekken/);
  // Naam met HTML: gewone tekst.
  assert.match(await tekst(page, 'label[for="uitnodig-u3"]'), /<img src=x onerror="window.__xss=1">Carol/);
  assert.equal(await page.locator('#uitnodigenInhoud img').count(), 0);

  await page.check('#uitnodig-u2');
  await page.check('#uitnodig-u3');
  await page.click('#uitnodigenInhoud >> text=Uitnodigen (2)');
  await even(page, 500);
  const [planPad] = (await paden(page, 'plannen/')).filter((p) => p.split('/').length === 2);
  const planId = planPad.split('/')[1];
  const plan = await opslag(page, planPad);
  assert.equal(plan.eigenaar, 'u1');
  assert.deepEqual(plan.genodigden, ['u2', 'u3']);
  assert.equal((await opslag(page, `plannen/${planId}/leden/u1`)).rol, 'organisator');
  assert.equal((await opslag(page, `plannen/${planId}/leden/u2`)).status, 'uitgenodigd');
  assert.equal((await paden(page, 'inbox/u2/berichten/')).length, 1);
  assert.equal((await paden(page, 'inbox/u3/berichten/')).length, 1);
  assert.equal((await opslag(page, 'users/u1')).gepland[0].planId, planId);
  assert.match(await tekst(page, '#uitnodigenInhoud .vrienden-melding'), /Uitgenodigd: @bob, @carol\./);
  assert.match(await tekst(page, '#uitnodigenInhoud'), /@bob · heeft nog niet gereageerd/);

  await page.click('button[aria-label="Uitnodiging van @carol intrekken"]');
  await even(page, 500);
  assert.equal(await opslag(page, `plannen/${planId}/leden/u3`), null);
  assert.deepEqual((await opslag(page, planPad)).genodigden, ['u2']);

  await page.click('#uitnodigenBack');
  await even(page);
  assert.equal(hash(page), '#/profiel');
  assert.match(await tekst(page, '#geplandList'), /@bob heeft nog niet gereageerd/);
  assert.equal(await page.evaluate(() => window.__xss ?? null), null);
  assert.deepEqual(fouten, []);
  await ctx.close();
});

test('met wie (organisator): meegaan met kaarten, kan niet, gaat niet meer (geen vriend: "iemand"); momentopname bewaard', async () => {
  const docs = {
    ...BASIS,
    ...gebruiker('u1', [{ ...item, planId: 'P1' }]),
    ...planDocs({
      leden: [
        { uid: 'u1', rol: 'organisator', status: 'gaat' },
        { uid: 'u2', rol: 'gast', status: 'gaat', kaarten: true },
        { uid: 'u3', rol: 'gast', status: 'kan-niet' },
        { uid: 'u4', rol: 'gast', status: 'weg' },
      ],
    }),
  };
  // dave is geen vriend: zijn profiel is onleesbaar (rules) of ontbreekt; allebei "iemand".
  delete docs['profielen/u4'];
  const { ctx, page, fouten } = await openApp({ docs });
  await even(page, 400);
  assert.match(await tekst(page, '#geplandList .plan-samen-tekst'), /^Met @bob \(kaarten ✓\) · @carol kan niet · iemand gaat niet meer$/);
  assert.deepEqual((await opslag(page, 'users/u1')).gepland[0].metWie, ['@bob']);
  // Detailscherm: dezelfde regel en "Plan opheffen".
  await page.goto(`${base}#/show/${encodeURIComponent(show.id)}`);
  await even(page, 600);
  assert.match(await tekst(page, '#detailPlanSamen'), /Met @bob \(kaarten ✓\)/);
  assert.equal(await page.locator('#detailPlanSamen >> text=Plan opheffen').count(), 1);
  assert.deepEqual(fouten, []);
  await ctx.close();
});

test('gast: met wie, kaarten in het plan, en "Ik ga toch niet"', async () => {
  const docs = {
    ...BASIS,
    'profielen/u2': profiel('bob', 'Bob Jansen'),
    ...gebruiker('u2', [{ ...item, planId: 'P1' }]),
    ...planDocs({ leden: [{ uid: 'u1', rol: 'organisator', status: 'gaat', kaarten: true }, { uid: 'u2', rol: 'gast', status: 'gaat' }] }),
  };
  const { ctx, page, fouten } = await openApp({ wie: BOB, docs });
  await even(page, 400);
  assert.match(await tekst(page, '#geplandList .plan-samen-tekst'), /^Met @Anna_V \(kaarten ✓\)$/);
  assert.equal(await page.locator('#geplandList button[aria-label^="Vrienden uitnodigen"]').count(), 0);

  // Kaarten wisselen: ook in het plan.
  await page.click('#geplandList .plan-status');
  await even(page);
  assert.equal((await opslag(page, 'plannen/P1/leden/u2')).kaarten, true);

  // Uitnodigscherm als gast: alleen de organisator nodigt uit.
  await page.goto(`${base}#/uitnodigen/${encodeURIComponent(item.sleutel)}`);
  await even(page, 600);
  assert.match(await tekst(page, '#uitnodigenInhoud'), /Alleen @Anna_V kan mensen uitnodigen/);
  await page.goto(`${base}#/profiel`);
  await even(page, 600);

  await page.click('#geplandList button[aria-label^="Ik ga toch niet"]');
  assert.match(await tekst(page, '#geplandList .plan-bevestig'), /^Toch niet meegaan\? @Anna_V krijgt hiervan een bericht\./);
  await page.click('#geplandList .plan-bevestig >> text="Ik ga niet"');
  await even(page, 500);
  assert.equal((await opslag(page, 'plannen/P1/leden/u2')).status, 'weg');
  assert.equal((await opslag(page, 'users/u2')).gepland.length, 0);
  const berichten = await page.evaluate(() => [...window.__nepFirestore.entries()].filter(([k]) => k.startsWith('inbox/u1/')).map(([, v]) => v));
  assert.deepEqual(berichten.map((b) => `${b.van}:${b.soort}`), ['u2:weg']);
  assert.deepEqual(fouten, []);
  await ctx.close();
});

test('organisator heft het plan op: berichten aan de leden, eigen item blijft als gewoon plan', async () => {
  const docs = {
    ...BASIS,
    ...gebruiker('u1', [{ ...item, planId: 'P1' }]),
    ...planDocs({ leden: [{ uid: 'u1', rol: 'organisator', status: 'gaat' }, { uid: 'u2', rol: 'gast', status: 'gaat' }, { uid: 'u3', rol: 'gast', status: 'uitgenodigd' }] }),
  };
  const { ctx, page, fouten } = await openApp({ docs, hash: `#/show/${encodeURIComponent(show.id)}` });
  await even(page, 600);
  await page.click('#detailPlanSamen >> text=Plan opheffen');
  assert.match(await tekst(page, '#detailPlanSamen .plan-bevestig'), /^Plan opheffen\? @bob en @carol krijgen hiervan een bericht\./);
  await page.click('#detailPlanSamen .plan-bevestig >> text="Opheffen"');
  await even(page, 500);
  assert.equal((await opslag(page, 'plannen/P1')).opgeheven, true);
  assert.equal((await paden(page, 'inbox/u2/')).length, 1);
  assert.equal((await paden(page, 'inbox/u3/')).length, 1);
  assert.equal((await opslag(page, 'users/u1')).gepland.length, 1);
  assert.doesNotMatch(await tekst(page, '#detailPlanSamen'), /Met |Plan opheffen/);
  // Weer uit te nodigen als nieuw plan.
  assert.equal(await page.locator('#detailPlanSamen >> text=Vrienden uitnodigen').count(), 1);
  assert.deepEqual(fouten, []);
  await ctx.close();
});

test('"Uit je planning halen" bij een gedeeld plan: organisator heft op en het item is weg', async () => {
  const docs = {
    ...BASIS,
    ...gebruiker('u1', [{ ...item, planId: 'P1' }]),
    ...planDocs({ leden: [{ uid: 'u1', rol: 'organisator', status: 'gaat' }, { uid: 'u2', rol: 'gast', status: 'gaat' }] }),
  };
  const { ctx, page, fouten } = await openApp({ docs, hash: `#/show/${encodeURIComponent(show.id)}` });
  await even(page, 600);
  await page.click('#detailUnplan');
  assert.match(await tekst(page, '#detailPlanSamen .plan-bevestig'), /^Uit je planning halen\? Het gedeelde plan wordt dan opgeheven\. @bob krijgt hiervan een bericht\./);
  await page.click('#detailPlanSamen .plan-bevestig >> text="Uit planning halen"');
  await even(page, 500);
  assert.equal((await opslag(page, 'plannen/P1')).opgeheven, true);
  assert.equal((await paden(page, 'inbox/u2/')).length, 1);
  assert.equal((await opslag(page, 'users/u1')).gepland.length, 0);
  assert.deepEqual(fouten, []);
  await ctx.close();
});

test('Annuleren bij Plan opheffen, Uit je planning halen en Ik ga toch niet: er gebeurt niets, geen bericht', async () => {
  const leden = [{ uid: 'u1', rol: 'organisator', status: 'gaat' }, { uid: 'u2', rol: 'gast', status: 'gaat' }];
  // Organisator: opheffen en uit planning halen, allebei annuleren.
  const docsA = { ...BASIS, ...gebruiker('u1', [{ ...item, planId: 'P1' }]), ...planDocs({ leden }) };
  const a = await openApp({ docs: docsA, hash: `#/show/${encodeURIComponent(show.id)}` });
  await even(a.page, 600);
  for (const knop of ['#detailPlanSamen >> text=Plan opheffen', '#detailUnplan']) {
    await a.page.click(knop);
    assert.equal(await a.page.locator('#detailPlanSamen .plan-bevestig').count(), 1);
    await a.page.click('#detailPlanSamen .plan-bevestig >> text="Annuleren"');
    await even(a.page);
    assert.equal(await a.page.locator('.plan-bevestig').count(), 0);
  }
  assert.equal((await opslag(a.page, 'plannen/P1')).opgeheven, false);
  assert.equal((await opslag(a.page, 'users/u1')).gepland.length, 1);
  assert.deepEqual(await paden(a.page, 'inbox/'), []);
  assert.deepEqual(a.fouten, []);
  await a.ctx.close();

  // Gast: Ik ga toch niet, annuleren (in Gepland en in het detailscherm).
  const docsB = { ...BASIS, 'profielen/u2': profiel('bob', 'Bob Jansen'), ...gebruiker('u2', [{ ...item, planId: 'P1' }]), ...planDocs({ leden }) };
  const b = await openApp({ wie: BOB, docs: docsB });
  await even(b.page, 400);
  await b.page.click('#geplandList button[aria-label^="Ik ga toch niet"]');
  await b.page.click('#geplandList .plan-bevestig >> text="Annuleren"');
  await even(b.page);
  await b.page.goto(`${base}#/show/${encodeURIComponent(show.id)}`);
  await even(b.page, 600);
  await b.page.click('#detailUnplan');
  assert.match(await tekst(b.page, '#detailPlanSamen .plan-bevestig'), /Toch niet meegaan\?/);
  await b.page.click('#detailPlanSamen .plan-bevestig >> text="Annuleren"');
  await even(b.page);
  assert.equal((await opslag(b.page, 'plannen/P1/leden/u2')).status, 'gaat');
  assert.equal((await opslag(b.page, 'users/u2')).gepland.length, 1);
  assert.deepEqual(await paden(b.page, 'inbox/'), []);
  assert.deepEqual(b.fouten, []);
  await b.ctx.close();
});

test('gewoon (niet gedeeld) plan: Uit je planning halen zonder bevestiging, zoals voorheen', async () => {
  const { ctx, page, fouten } = await openApp({ hash: `#/show/${encodeURIComponent(show.id)}` });
  await even(page, 400);
  await page.click('#detailUnplan');
  await even(page);
  assert.equal(await page.locator('.plan-bevestig').count(), 0);
  assert.equal((await opslag(page, 'users/u1')).gepland.length, 0);
  assert.deepEqual(fouten, []);
  await ctx.close();
});

test('rond middernacht: uitnodigen volgt de datum in Amsterdam, niet die van het toestel (UTC)', async () => {
  for (const [datum, voor, na] of [
    ['2026-07-15', '2026-07-15T21:30:00Z', '2026-07-15T22:30:00Z'], // zomertijd: 23:30 / 00:30 Amsterdam
    ['2026-01-15', '2026-01-15T22:30:00Z', '2026-01-15T23:30:00Z'], // wintertijd: 23:30 / 00:30 Amsterdam
  ]) {
    const plan = { ...item, sleutel: `${item.theaterId}|${datum}|20:00|middernacht`, datum, tijd: '20:00' };
    for (const [tijd, verwacht] of [[voor, 1], [na, 0]]) {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block', timezoneId: 'UTC' });
      await ctx.clock.setFixedTime(new Date(tijd));
      await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
      await ctx.route(`${base}js/firebase.js`, (r) => r.fulfill({ contentType: 'text/javascript', body: nepFirebase({ gebruiker: ANNA, docs: { ...BASIS, ...gebruiker('u1', [plan]) } }) }));
      const page = await ctx.newPage();
      const fouten = [];
      page.on('pageerror', (e) => fouten.push(e.message));
      await page.goto(`${base}#/profiel`);
      await page.waitForSelector('.nav-item', { state: 'attached' });
      await page.waitForTimeout(600);
      // Op het toestel (UTC) is het in beide gevallen nog de speeldag, maar
      // telt Amsterdam: vóór middernacht in Gepland met uitnodigknop, erna
      // is de speeldag voorbij en staat het plan in Gezien.
      assert.equal(await page.locator('#geplandList button[aria-label^="Vrienden uitnodigen"]').count(), verwacht, `${datum} ${tijd}`);
      if (verwacht) assert.match(await tekst(page, '#geplandList'), /middernacht|Grip|20:00/);
      else {
        assert.equal(await page.locator('#geplandList .plan-row').count(), 0, `${datum} ${tijd}`);
        assert.equal((await opslag(page, 'users/u1')).gezien.length, 1, `${datum} ${tijd}`);
      }
      assert.deepEqual(fouten, []);
      await ctx.close();
    }
  }
});

test('voorbije datum: het plan is al naar Gezien, dus niets meer uit te nodigen', async () => {
  const oud = { ...item, sleutel: `${item.theaterId}|2020-01-01|20:00|oud`, datum: '2020-01-01' };
  const docs = { ...BASIS, ...gebruiker('u1', [oud]) };
  const { ctx, page, fouten } = await openApp({ docs, hash: `#/uitnodigen/${encodeURIComponent(oud.sleutel)}` });
  assert.match(await tekst(page, '#uitnodigenInhoud'), /niet \(meer\) in je planning/);
  assert.equal(await page.locator('#uitnodigenInhoud button').filter({ hasText: /uitnodigen/i }).count(), 0);
  assert.deepEqual(fouten, []);
  await ctx.close();
});

test('offline: melding met Opnieuw; weer online kun je uitnodigen', async () => {
  const { ctx, page, fouten } = await openApp();
  await page.evaluate(() => { window.__nepOffline = true; });
  await page.click('#geplandList button[aria-label^="Vrienden uitnodigen"]');
  await even(page, 500);
  assert.match(await tekst(page, '#uitnodigenInhoud'), /kon niet worden geladen/);
  await page.evaluate(() => { window.__nepOffline = false; });
  await page.click('#uitnodigenInhoud >> text=Opnieuw proberen');
  await even(page, 500);
  assert.equal(await page.isVisible('#uitnodig-u2'), true);
  // Offline uitnodigen: melding, niets geschreven.
  await page.check('#uitnodig-u2');
  await page.evaluate(() => { window.__nepOffline = true; });
  await page.click('#uitnodigenInhoud >> text=Uitnodigen (1)');
  await even(page, 400);
  assert.match(await tekst(page, '#uitnodigenInhoud .vrienden-melding'), /Controleer je verbinding/);
  assert.deepEqual(await paden(page, 'plannen/'), []);
  assert.deepEqual(fouten, []);
  await ctx.close();
});
