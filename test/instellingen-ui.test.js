// UI-test herindeling Profiel (okt 2026): de kop met de icoonknoppen
// Berichten (met teller) en Instellingen, de profielkaart, de kaart Vrienden,
// het scherm Instellingen (#/profiel/instellingen) met Uitloggen, en de
// terugknoppen van de subschermen. Echte app, vaste agenda, nep-Firestore;
// geen netwerk naar buiten.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

import { nepFirebase } from './nepFirebase.js';
import { TIJDZONE } from './datum.js';
import { serveerVasteAgenda } from './vasteAgenda.js';

const ROOT = new URL('../public/', import.meta.url).pathname;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };
const ANNA = { uid: 'u1', displayName: 'Anna de Vries', email: 'anna@example.com', photoURL: null };
const profiel = (g, n) => ({ gebruikersnaam: g, gebruikersnaamLaag: g.toLowerCase(), naam: n, aangemaaktOp: 1, gewijzigdOp: 1, v: 1 });
const gebruiker = (uid) => ({
  [`users/${uid}`]: { profielGevraagd: true, gepland: [], geplandVerwijderd: [], watchlist: [], watchlistVerwijderd: [], gezien: [], gezienVerwijderd: [] },
  [`gedeeld/${uid}`]: { gezien: true, watchlist: true, gewijzigdOp: 1 },
});
const bericht = (planId) => ({ soort: 'reactie', van: 'u2', planId, aangemaaktOp: Date.now(), gelezen: false });
const BASIS = {
  'profielen/u1': profiel('Anna_V', 'Anna de Vries'),
  'profielen/u2': profiel('bob', 'Bob Jansen'),
  'vrienden/u1/lijst/u2': { uid: 'u2', sinds: 1, via: 'verzoek' },
  'vrienden/u2/lijst/u1': { uid: 'u1', sinds: 1, via: 'verzoek' },
  'vriendverzoeken/u3_u1': { van: 'u3', naar: 'u1', vanGebruikersnaam: 'carla', vanNaam: 'Carla Smit', aangemaaktOp: 1 },
  ...gebruiker('u1'),
};
const MET_BERICHTEN = { ...BASIS, 'inbox/u1/berichten/m1': bericht('P1'), 'inbox/u1/berichten/m2': bericht('P2') };

let server;
let base;
let browser;

before(async () => {
  server = createServer(async (req, res) => {
    const pad = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (await serveerVasteAgenda(pad, res)) return;
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

async function openApp({ wie = ANNA, docs = BASIS, hash = '#/profiel', viewport = { width: 390, height: 844 } } = {}) {
  const ctx = await browser.newContext({ viewport, serviceWorkers: 'block', timezoneId: TIJDZONE });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  await ctx.route(`${base}js/firebase.js`, (r) => r.fulfill({ contentType: 'text/javascript', body: nepFirebase({ gebruiker: wie, docs }) }));
  const page = await ctx.newPage();
  const fouten = [];
  page.on('pageerror', (e) => fouten.push(e.message));
  await page.goto(`${base}${hash}`);
  await page.waitForSelector('.nav-item', { state: 'attached' });
  await page.waitForTimeout(600);
  return { ctx, page, fouten };
}

const hash = (page) => new URL(page.url()).hash;
const even = (page, ms = 250) => page.waitForTimeout(ms);
const knop = (page, naam) => page.getByRole('button', { name: naam, exact: true });

test('kop van Profiel: Berichten en Instellingen als ronde icoonknoppen van 44 px, met toegankelijke namen; teller alleen bij ongelezen', async () => {
  // Zonder ongelezen berichten: geen teller, naam "Berichten".
  const nul = await openApp();
  assert.equal(await knop(nul.page, 'Berichten').isVisible(), true);
  assert.equal(await knop(nul.page, 'Instellingen').isVisible(), true);
  assert.equal(await nul.page.isVisible('#berichtenKnopBadge'), false);
  for (const id of ['#berichtenKnop', '#instellingenKnop']) {
    const box = await nul.page.locator(id).boundingBox();
    assert.ok(box.width >= 44 && box.height >= 44, `${id}: ${box.width}×${box.height}`);
    assert.equal(await nul.page.locator(`${id} svg`).getAttribute('aria-hidden'), 'true');
  }
  // Rechts naast de titel, op dezelfde hoogte.
  const titel = await nul.page.locator('#screen-profiel .app-title').boundingBox();
  const instellingen = await nul.page.locator('#instellingenKnop').boundingBox();
  assert.ok(instellingen.x > titel.x + titel.width, 'rechts van de titel');
  assert.ok(instellingen.y < titel.y + titel.height, 'in de kop');
  assert.deepEqual(nul.fouten, []);
  await nul.ctx.close();

  // Twee ongelezen: teller 2 op de knop en het Profiel-tabje.
  const twee = await openApp({ docs: MET_BERICHTEN });
  assert.equal(await knop(twee.page, 'Berichten, 2 ongelezen').isVisible(), true);
  assert.equal(await twee.page.textContent('#berichtenKnopBadge'), '2');
  assert.equal(await twee.page.textContent('#profielBadge'), '2');
  assert.equal(await twee.page.getAttribute('.nav-item[data-tab="profiel"]', 'aria-label'), 'Profiel, 2 ongelezen berichten');
  await knop(twee.page, 'Berichten, 2 ongelezen').click();
  await even(twee.page, 500);
  assert.equal(hash(twee.page), '#/berichten');
  assert.deepEqual(twee.fouten, []);
  await twee.ctx.close();
});

test('teller op het Profiel-tabje ook op desktop', async () => {
  const { ctx, page, fouten } = await openApp({ docs: MET_BERICHTEN, viewport: { width: 1280, height: 900 }, hash: '#/' });
  assert.equal(await page.isVisible('#profielBadge'), true);
  assert.equal(await page.textContent('#profielBadge'), '2');
  assert.deepEqual(fouten, []);
  await ctx.close();
});

test('Profiel: profielkaart met alleen avatar, naam en @gebruikersnaam; kaart Vrienden met aantal en badge; geen balken Berichten, Wat vrienden zien, Mail', async () => {
  const { ctx, page, fouten } = await openApp();
  const kaart = page.locator('#authBox .auth-box');
  assert.equal(await kaart.locator('.auth-avatar').textContent(), 'A');
  assert.equal(await kaart.locator('.auth-box-title').textContent(), 'Anna de Vries');
  assert.equal(await kaart.locator('.auth-box-handle').textContent(), '@Anna_V');
  assert.equal(await kaart.locator('button').count(), 0, 'geen Uitloggen of Wijzigen');
  const profielScherm = page.locator('#screen-profiel');
  for (const tekst of ['Uitloggen', 'Wijzigen', 'Wat vrienden zien', 'Mail bij uitnodigingen', 'Account verwijderen', 'Vindbaar op naam']) {
    assert.equal(await profielScherm.getByText(tekst, { exact: true }).count(), 0, tekst);
  }
  assert.equal(await page.locator('#screen-profiel #berichtenTegel, #screen-profiel #delenTegel, #screen-profiel #mailTegel').count(), 0);
  assert.match(await page.textContent('#vriendenTegel'), /Vrienden1 vriend · 1 nieuw verzoek/);
  assert.equal(await page.textContent('#vriendenTegel .badge'), '1');
  await page.click('#vriendenTegel');
  await even(page, 400);
  assert.equal(hash(page), '#/vrienden');
  assert.deepEqual(fouten, []);
  await ctx.close();
});

test('Instellingen: subscherm van Profiel met Account, Privacy, Meldingen, Uitloggen en Account verwijderen; terug naar Profiel', async () => {
  const { ctx, page, fouten } = await openApp();
  await knop(page, 'Instellingen').click();
  await even(page, 400);
  assert.equal(hash(page), '#/profiel/instellingen');
  // Geen nieuw tabblad: de onderbalk is verborgen, zoals bij Berichten.
  assert.equal(await page.isVisible('#bottomNav'), false);
  assert.equal(await page.textContent('#screen-instellingen .app-title'), 'Instellingen');
  assert.deepEqual(await page.locator('#instellingenInhoud .instellingen-kop').allInnerTexts(), ['Account', 'Privacy', 'Meldingen']);
  const groep = (kop) => page.getByRole('region', { name: kop });
  assert.match(await groep('Account').textContent(), /@Anna_V · Anna de VriesWijzigen/);
  assert.equal(await groep('Privacy').getByRole('switch', { name: 'Vindbaar op naam' }).count(), 1);
  assert.match(await groep('Privacy').textContent(), /Wat vrienden zien/);
  assert.match(await groep('Meldingen').textContent(), /Mail bij uitnodigingen/);
  // Onderaan: twee gewone links, minstens 44 px hoog.
  for (const naam of ['Uitloggen', 'Account verwijderen']) {
    const box = await knop(page, naam).boundingBox();
    assert.ok(box.height >= 44, `${naam}: ${box.height}`);
  }
  const kleur = await page.locator('#accountVerwijderenKnop').evaluate((el) => getComputedStyle(el).color);
  const token = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent-text-small').trim());
  assert.equal(kleur, `rgb(${[1, 3, 5].map((i) => parseInt(token.slice(i, i + 2), 16)).join(', ')})`);
  await page.click('#instellingenBack');
  await even(page);
  assert.equal(hash(page), '#/profiel');
  assert.equal(await page.isVisible('#bottomNav'), true);
  assert.deepEqual(fouten, []);
  await ctx.close();
});

test('Instellingen: de subschermen gaan terug naar Instellingen, ook via een diepe link', async () => {
  const { ctx, page, fouten } = await openApp();
  await knop(page, 'Instellingen').click();
  await even(page, 300);
  for (const [klik, scherm, terug] of [
    ['#delenTegel', '#/profiel/delen', '#delenBack'],
    ['#mailTegel', '#/profiel/mail', '#mailBack'],
    ['#accountVerwijderenKnop', '#/profiel/account-verwijderen', '#accountVerwijderenBack'],
    ['button[aria-label="Gebruikersnaam en naam wijzigen"]', '#/profiel/instellen', '#profielInstellenBack'],
  ]) {
    await page.click(klik);
    await even(page, 300);
    assert.equal(hash(page), scherm);
    await page.click(terug);
    await even(page, 300);
    assert.equal(hash(page), '#/profiel/instellingen', `terug van ${scherm}`);
  }
  await ctx.close();
  // Diepe link zonder geschiedenis: terug gaat ook naar Instellingen.
  for (const [diep, terug] of [['#/profiel/delen', '#delenBack'], ['#/profiel/mail', '#mailBack'], ['#/profiel/account-verwijderen', '#accountVerwijderenBack']]) {
    const d = await openApp({ hash: diep });
    assert.equal(hash(d.page), diep);
    await d.page.click(terug);
    await even(d.page, 300);
    assert.equal(hash(d.page), '#/profiel/instellingen', `diepe link ${diep}`);
    assert.deepEqual(d.fouten, []);
    await d.ctx.close();
  }
  assert.deepEqual(fouten, []);
});

test('Uitloggen vanuit Instellingen: uitgelogd, terug op Profiel met Inloggen en zonder knoppen in de kop', async () => {
  const { ctx, page, fouten } = await openApp({ hash: '#/profiel/instellingen' });
  await knop(page, 'Uitloggen').click();
  await page.waitForFunction(() => location.hash === '#/profiel');
  await even(page, 300);
  assert.equal(await page.evaluate(() => window.__nepUitgelogd), 1);
  assert.equal(await page.isVisible('.google-btn'), true);
  assert.equal(await page.isVisible('#berichtenKnop'), false);
  assert.equal(await page.isVisible('#instellingenKnop'), false);
  assert.deepEqual(fouten, []);
  await ctx.close();
});

test('niet ingelogd: geen Berichten- en Instellingen-knop; #/profiel/instellingen gaat naar Profiel. Zonder profiel: wel Instellingen, geen Berichten', async () => {
  const uit = await openApp({ wie: null, docs: {} });
  assert.equal(await uit.page.isVisible('#berichtenKnop'), false);
  assert.equal(await uit.page.isVisible('#instellingenKnop'), false);
  assert.equal(await uit.page.isVisible('.google-btn'), true);
  await uit.page.goto(`${base}#/profiel/instellingen`);
  await even(uit.page, 400);
  assert.equal(hash(uit.page), '#/profiel');
  assert.deepEqual(uit.fouten, []);
  await uit.ctx.close();

  const zonder = await openApp({ docs: { 'users/u1': { profielGevraagd: true } } });
  assert.equal(await zonder.page.isVisible('#berichtenKnop'), false);
  assert.equal(await zonder.page.isVisible('#instellingenKnop'), true);
  assert.match(await zonder.page.textContent('#authBox'), /Nog geen gebruikersnaam/);
  await zonder.page.click('#instellingenKnop');
  await even(zonder.page, 300);
  assert.match(await zonder.page.textContent('#instellingenInhoud'), /Kies eerst een gebruikersnaam/);
  assert.deepEqual(zonder.fouten, []);
  await zonder.ctx.close();
});
