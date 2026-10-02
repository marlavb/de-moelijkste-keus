// UI-test voor de persoonlijke uitnodigingslink (vrienden, stap 2): maken,
// delen (Web Share API) of kopiëren, intrekken, en een geopende link
// (uitgelogd, zonder profiel, geldig, verlopen, gebruikt, eigen, al
// vrienden, geblokkeerd, offline). navigator.share en het klembord zijn
// nepversies; Firebase is nepFirebase (zonder rules: die staan in
// firebase/tests/vrienden.test.js).

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

import { nepFirebase } from './nepFirebase.js';

const ROOT = new URL('../public/', import.meta.url).pathname;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };
const ANNA = { uid: 'u1', displayName: 'Anna de Vries', email: 'anna@example.com', photoURL: null };
const TOKEN = 'Tok3n_Tok3n-Tok3n_Tok3n-Tok3n_12';
const EIGEN = 'Eigen_Eigen-Eigen_Eigen-Eigen_12';
let server;
let base;
let browser;

const profiel = (gebruikersnaam, naam) => ({ gebruikersnaam, gebruikersnaamLaag: gebruikersnaam.toLowerCase(), naam, aangemaaktOp: 1, gewijzigdOp: 1, v: 1 });
const ANNA_PROFIEL = {
  'users/u1': { profielGevraagd: true },
  'profielen/u1': profiel('Anna_V', 'Anna de Vries'),
  'usernames/anna_v': { uid: 'u1', gebruikersnaam: 'Anna_V', naam: 'Anna de Vries' },
};
const CAROL = { 'profielen/u3': profiel('carol', 'Carol Smit'), 'usernames/carol': { uid: 'u3', gebruikersnaam: 'carol', naam: 'Carol Smit' } };
const linkVan = (uid, gebruikersnaam, naam, aangemaaktOp = Date.now()) => ({ uid, gebruikersnaam, naam, aangemaaktOp });
const LINK_CAROL = { [`uitnodigingslinks/${TOKEN}`]: linkVan('u3', 'carol', 'Carol Smit') };

before(async () => {
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

// share: 'ok' | 'afbreken' | 'geen'
async function openApp({ gebruiker = ANNA, docs = ANNA_PROFIEL, hash = '#/vrienden', share = 'ok', offline = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  await ctx.route(`${base}js/firebase.js`, (r) => r.fulfill({ contentType: 'text/javascript', body: nepFirebase({ gebruiker, docs }) }));
  await ctx.addInitScript(({ share, offline }) => {
    window.__gedeeld = [];
    window.__gekopieerd = [];
    if (offline) window.__nepOffline = true;
    if (share === 'geen') {
      Object.defineProperty(Navigator.prototype, 'share', { value: undefined, configurable: true });
    } else {
      Object.defineProperty(Navigator.prototype, 'share', {
        configurable: true,
        value: async (data) => {
          if (share === 'afbreken') throw new DOMException('Geannuleerd', 'AbortError');
          window.__gedeeld.push(data);
        },
      });
    }
    Object.defineProperty(Navigator.prototype, 'clipboard', {
      configurable: true,
      get: () => ({ writeText: async (t) => { window.__gekopieerd.push(t); } }),
    });
  }, { share, offline });
  const page = await ctx.newPage();
  const fouten = [];
  page.on('pageerror', (e) => fouten.push(e.message));
  await page.goto(`${base}${hash}`);
  await page.waitForSelector('.nav-item', { state: 'attached' });
  await page.waitForTimeout(400);
  return { ctx, page, fouten };
}

const opslag = (page, pad) => page.evaluate((p) => window.__nepFirestore.get(p) ?? null, pad);
const linkDocs = (page) => page.evaluate(() => [...window.__nepFirestore.keys()].filter((k) => k.startsWith('uitnodigingslinks/')));
const hash = (page) => new URL(page.url()).hash;
const tekst = (page, sel) => page.textContent(sel);
const even = (page) => page.waitForTimeout(250);

test('link maken en delen: eenmalig token (32 tekens) met eigen gegevens; deelmenu krijgt de link', async () => {
  const { ctx, page, fouten } = await openApp();
  await page.click('#vriendLinkMaak');
  await even(page);
  const [pad] = await linkDocs(page);
  const token = pad.split('/')[1];
  assert.match(token, /^[A-Za-z0-9_-]{32}$/);
  const doc = await opslag(page, pad);
  assert.deepEqual({ ...doc, aangemaaktOp: 0 }, { uid: 'u1', gebruikersnaam: 'Anna_V', naam: 'Anna de Vries', aangemaaktOp: 0 });
  const gedeeld = await page.evaluate(() => window.__gedeeld);
  assert.equal(gedeeld.length, 1);
  assert.equal(gedeeld[0].url, `${base}#/vriend-link/${token}`);
  assert.match(await tekst(page, '#vriendLinkResultaat'), /Link gedeeld/);
  assert.equal(await page.inputValue('.vriend-link-url'), `${base}#/vriend-link/${token}`);
  assert.match(await tekst(page, '#vriendLinkLijst'), /Openstaande link.*Geldig tot/s);
  assert.deepEqual(fouten, []);
  await ctx.close();
});

test('geen deelmenu: de link wordt gekopieerd; afgebroken delen: link blijft zichtbaar', async () => {
  const een = await openApp({ share: 'geen' });
  await een.page.click('#vriendLinkMaak');
  await even(een.page);
  const [pad] = await linkDocs(een.page);
  assert.deepEqual(await een.page.evaluate(() => window.__gekopieerd), [`${base}#/vriend-link/${pad.split('/')[1]}`]);
  assert.match(await tekst(een.page, '#vriendLinkResultaat'), /Link gekopieerd/);
  assert.equal(await een.page.locator('#vriendLinkResultaat >> text=Delen').count(), 0);
  assert.deepEqual(een.fouten, []);
  await een.ctx.close();

  const twee = await openApp({ share: 'afbreken' });
  await twee.page.click('#vriendLinkMaak');
  await even(twee.page);
  assert.match(await tekst(twee.page, '#vriendLinkResultaat'), /Niet gedeeld/);
  assert.match(await twee.page.inputValue('.vriend-link-url'), /#\/vriend-link\//);
  await twee.page.click('#vriendLinkResultaat >> text=Kopiëren');
  await even(twee.page);
  assert.equal((await twee.page.evaluate(() => window.__gekopieerd)).length, 1);
  assert.deepEqual(twee.fouten, []);
  await twee.ctx.close();
});

test('eigen link intrekken: weg uit Firestore en uit de lijst', async () => {
  const docs = { ...ANNA_PROFIEL, [`uitnodigingslinks/${EIGEN}`]: linkVan('u1', 'Anna_V', 'Anna de Vries') };
  const { ctx, page, fouten } = await openApp({ docs });
  assert.match(await tekst(page, '#vriendLinkLijst'), /Geldig tot/);
  await page.click('#vriendLinkLijst >> text=Intrekken');
  await even(page);
  assert.equal(await opslag(page, `uitnodigingslinks/${EIGEN}`), null);
  assert.equal(await tekst(page, '#vriendLinkLijst'), '');
  assert.match(await tekst(page, '.vrienden-melding'), /Link ingetrokken/);
  assert.deepEqual(fouten, []);
  await ctx.close();
});

test('verlopen eigen links worden niet getoond en opgeruimd', async () => {
  const docs = { ...ANNA_PROFIEL, [`uitnodigingslinks/${EIGEN}`]: linkVan('u1', 'Anna_V', 'Anna de Vries', Date.now() - 8 * 86400000) };
  const { ctx, page, fouten } = await openApp({ docs });
  assert.equal(await tekst(page, '#vriendLinkLijst'), '');
  await even(page);
  assert.equal(await opslag(page, `uitnodigingslinks/${EIGEN}`), null);
  assert.deepEqual(fouten, []);
  await ctx.close();
});

test('link openen uitgelogd: eerst inloggen; terug gaat naar Profiel', async () => {
  const { ctx, page, fouten } = await openApp({ gebruiker: null, docs: { ...CAROL, ...LINK_CAROL }, hash: `#/vriend-link/${TOKEN}` });
  assert.equal(await page.isVisible('#screen-vriendlink'), true);
  assert.equal(await page.isVisible('#bottomNav'), false);
  assert.match(await tekst(page, '#vriendLinkInhoud'), /Log in om de uitnodiging te bekijken/);
  assert.equal(await page.isVisible('#vriendLinkInhoud .google-btn'), true);
  await page.click('#vriendLinkBack');
  await even(page);
  assert.equal(hash(page), '#/profiel');
  assert.deepEqual(fouten, []);
  await ctx.close();
});

test('link openen zonder profiel: eerst gebruikersnaam, dan terug naar de link en vrienden worden', async () => {
  const docs = { 'users/u1': { profielGevraagd: true }, ...CAROL, ...LINK_CAROL };
  const { ctx, page, fouten } = await openApp({ docs, hash: `#/vriend-link/${TOKEN}` });
  assert.match(await tekst(page, '#vriendLinkInhoud'), /Kies eerst een gebruikersnaam/);
  await page.click('#vriendLinkInhoud >> text=Gebruikersnaam kiezen');
  await even(page);
  assert.equal(hash(page), '#/profiel/instellen');
  await page.fill('#profielGebruikersnaam', 'Anna_V');
  await page.click('#profielOpslaan');
  await page.waitForTimeout(400);
  assert.equal(hash(page), `#/vriend-link/${TOKEN}`);
  assert.match(await tekst(page, '#vriendLinkInhoud'), /Word vrienden met @carol\?.*Carol Smit/s);

  await page.click('#vriendLinkInhoud >> text=Ja, word vrienden');
  await even(page);
  assert.match(await tekst(page, '#vriendLinkInhoud'), /Je bent nu vrienden met @carol/);
  assert.deepEqual({ ...(await opslag(page, 'vrienden/u1/lijst/u3')), sinds: 0 }, { uid: 'u3', sinds: 0, via: 'link', token: TOKEN });
  assert.deepEqual({ ...(await opslag(page, 'vrienden/u3/lijst/u1')), sinds: 0 }, { uid: 'u1', sinds: 0, via: 'link', token: TOKEN });
  assert.equal(await opslag(page, `uitnodigingslinks/${TOKEN}`), null);
  await page.click('#vriendLinkInhoud >> text=Naar Vrienden');
  await even(page);
  assert.equal(hash(page), '#/vrienden');
  assert.match(await tekst(page, '#vriendenInhoud'), /@carol · Carol Smit/);
  assert.deepEqual(fouten, []);
  await ctx.close();
});

test('nette meldingen: ongeldig/gebruikt, verlopen, eigen, al vrienden, zelf geblokkeerd', async () => {
  const gevallen = [
    [{}, TOKEN, /werkt niet \(meer\)/],
    [{ [`uitnodigingslinks/${TOKEN}`]: linkVan('u3', 'carol', 'Carol Smit', Date.now() - 8 * 86400000) }, TOKEN, /verlopen.*7 dagen/],
    [{ [`uitnodigingslinks/${EIGEN}`]: linkVan('u1', 'Anna_V', 'Anna de Vries') }, EIGEN, /je eigen uitnodigingslink/],
    [{ ...LINK_CAROL, 'vrienden/u1/lijst/u3': { uid: 'u3' } }, TOKEN, /al vrienden met @carol/],
    [{ ...LINK_CAROL, 'blokkades/u1/lijst/u3': { uid: 'u3', gebruikersnaam: 'carol', naam: 'Carol Smit', sinds: 1 } }, TOKEN, /Je hebt @carol geblokkeerd/],
    [LINK_CAROL, 'kort', /werkt niet \(meer\)/],
  ];
  for (const [extra, token, verwacht] of gevallen) {
    const { ctx, page, fouten } = await openApp({ docs: { ...ANNA_PROFIEL, ...CAROL, ...extra }, hash: `#/vriend-link/${token}` });
    const t = await tekst(page, '#vriendLinkInhoud');
    assert.match(t, verwacht, `${token}: ${t}`);
    assert.equal(await page.locator('#vriendLinkInhoud >> text=Ja, word vrienden').count(), 0);
    assert.deepEqual(fouten, []);
    await ctx.close();
  }
});

test('geweigerd bij "Ja" (bv. geblokkeerd door de eigenaar of net gebruikt): neutrale melding', async () => {
  const { ctx, page, fouten } = await openApp({ docs: { ...ANNA_PROFIEL, ...CAROL, ...LINK_CAROL }, hash: `#/vriend-link/${TOKEN}` });
  await page.evaluate(() => { window.__nepWeiger = (pad) => pad.startsWith('vrienden/'); });
  await page.click('#vriendLinkInhoud >> text=Ja, word vrienden');
  await even(page);
  assert.match(await tekst(page, '#vriendLinkInhoud'), /Deze link kan niet \(meer\) worden gebruikt/);
  assert.equal(await page.locator('#vriendLinkInhoud >> text=Ja, word vrienden').count(), 0);
  assert.equal(await opslag(page, 'vrienden/u1/lijst/u3'), null);
  assert.deepEqual(fouten, []);
  await ctx.close();
});

test('offline: melding met Opnieuw; netwerkfout bij "Ja" laat opnieuw proberen toe', async () => {
  const { ctx, page, fouten } = await openApp({ docs: { ...ANNA_PROFIEL, ...CAROL, ...LINK_CAROL }, hash: `#/vriend-link/${TOKEN}`, offline: true });
  assert.match(await tekst(page, '#vriendLinkInhoud'), /kon niet worden geladen/);
  await page.evaluate(() => { window.__nepOffline = false; });
  await page.click('#vriendLinkInhoud >> text=Opnieuw proberen');
  await even(page);
  assert.match(await tekst(page, '#vriendLinkInhoud'), /Word vrienden met @carol\?/);
  await page.evaluate(() => { window.__nepOffline = true; });
  await page.click('#vriendLinkInhoud >> text=Ja, word vrienden');
  await even(page);
  assert.match(await tekst(page, '#vriendLinkInhoud'), /Controleer je verbinding/);
  await page.evaluate(() => { window.__nepOffline = false; });
  await page.click('#vriendLinkInhoud >> text=Ja, word vrienden');
  await even(page);
  assert.match(await tekst(page, '#vriendLinkInhoud'), /Je bent nu vrienden met @carol/);
  assert.deepEqual(fouten, []);
  await ctx.close();
});
