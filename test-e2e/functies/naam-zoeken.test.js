// End-to-end: vrienden zoeken op volledige naam (okt 2026), tegen de
// emulators mét de Functions-emulator (callable zoekOpNaam en de triggers die
// de zoekindex bijhouden) en de echte firestore.rules. Vier accounts:
//   A anna  "Anna de Vries" — vindbaar (standaard)
//   D anna2 "Anna de Vries" — vindbaar, zelfde naam (twee treffers)
//   C carol "Carol Smit"    — zet "Vindbaar op naam" uit
//   B bob   "Bob Jansen"    — zoekt
// Draai met `npm run test:e2e` (ronde met de functies). Tests in volgorde.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

import { controleerEmulators, startServer, wisEmulators, maakAccount, leesDoc, openGebruiker, ga, wachtOpTekst, wachtOpDoc, schermafbeelding } from '../hulp.js';

const ACCOUNTS = {
  A: { email: 'anna@naam.e2e.test', wachtwoord: 'geheim-anna', naam: 'Anna de Vries', gebruikersnaam: 'anna' },
  D: { email: 'anna2@naam.e2e.test', wachtwoord: 'geheim-anna2', naam: 'Anna de Vries', gebruikersnaam: 'anna2' },
  C: { email: 'carol@naam.e2e.test', wachtwoord: 'geheim-carol', naam: 'Carol Smit', gebruikersnaam: 'carol' },
  B: { email: 'bob@naam.e2e.test', wachtwoord: 'geheim-bob', naam: 'Bob Jansen', gebruikersnaam: 'bob' },
};
const uid = {};
const ik = {};
let server;
let base;
let browser;

before(async () => {
  controleerEmulators();
  await wisEmulators();
  for (const [k, a] of Object.entries(ACCOUNTS)) uid[k] = await maakAccount(a);
  ({ server, base } = await startServer());
  browser = await chromium.launch();
  for (const k of Object.keys(ACCOUNTS)) ik[k] = await openGebruiker(browser, base, ACCOUNTS[k]);
});

after(async () => {
  for (const g of Object.values(ik)) await g.ctx.close().catch(() => {});
  await browser?.close();
  await new Promise((r) => server.close(r));
});

async function zoek(page, tekst) {
  await ga(page, base, '#/vrienden');
  await page.waitForSelector('#vriendZoekInput');
  await page.fill('#vriendZoekInput', tekst);
  await page.click('#vriendZoekForm button[type="submit"]');
}

test('profiel kiezen: regel "Anderen kunnen je vinden op deze naam"; daarna vindbaar (voorkeur + zoekindex via de trigger)', async () => {
  for (const k of Object.keys(ACCOUNTS)) {
    const { page } = ik[k];
    await page.waitForFunction(() => location.hash === '#/profiel/instellen', null, { timeout: 15000 });
    assert.match(await page.textContent('#profielNaamVindbaar'), /Anderen kunnen je vinden op deze naam \(uit te zetten in Profiel\)/);
    await page.fill('#profielGebruikersnaam', ACCOUNTS[k].gebruikersnaam);
    await page.fill('#profielNaam', ACCOUNTS[k].naam);
    await page.click('#profielOpslaan');
    await page.waitForFunction(() => location.hash === '#/profiel', null, { timeout: 15000 });
    await page.waitForSelector('#vindbaarSchakelaar');
    assert.equal(await page.getAttribute('#vindbaarSchakelaar', 'aria-checked'), 'true');
    await wachtOpDoc(`naamvoorkeur/${uid[k]}`, (d) => d?.vindbaar === true);
    await wachtOpDoc(`naamIndexLid/${uid[k]}`, (d) => d !== null, 30000);
  }
  await schermafbeelding(ik.A.page, 'naam-zoeken-profiel');
});

test('C zet "Vindbaar op naam" uit: uit de zoekindex', async () => {
  const C = ik.C.page;
  await C.click('#vindbaarSchakelaar');
  await wachtOpTekst(C, '.profiel-vindbaar', /Opgeslagen: je bent niet meer vindbaar op je naam/);
  assert.equal(await C.getAttribute('#vindbaarSchakelaar', 'aria-checked'), 'false');
  await wachtOpDoc(`naamvoorkeur/${uid.C}`, (d) => d?.vindbaar === false);
  await wachtOpDoc(`naamIndexLid/${uid.C}`, (d) => d === null, 30000);
  await schermafbeelding(C, 'naam-zoeken-vindbaar-uit');
});

test('B vindt A op naam (hoofdletters en spaties maken niet uit), twee treffers met dezelfde naam, en stuurt A een verzoek', async () => {
  const B = ik.B.page;
  await zoek(B, '  anna   DE vries ');
  await B.waitForSelector('.vriend-zoek-lijst');
  const rijen = await B.locator('.vriend-zoek-lijst .vriend-rij-tekst').allTextContents();
  assert.deepEqual(rijen, ['@anna · Anna de Vries', '@anna2 · Anna de Vries']);
  await schermafbeelding(B, 'naam-zoeken-treffers');
  await B.click('button[aria-label="Vriendschapsverzoek sturen aan @anna"]');
  await wachtOpTekst(B, '#vriendZoekResultaat', /Verzoek verstuurd aan @anna/);
  assert.ok(await leesDoc(`vriendverzoeken/${uid.B}_${uid.A}`));
  // A ziet het verzoek.
  await ga(ik.A.page, base, '#/profiel');
  await wachtOpTekst(ik.A.page, '#vriendenTegel', /1 nieuw verzoek/);
});

test('C (vindbaar uit) wordt niet gevonden: neutrale tekst; op gebruikersnaam nog wel', async () => {
  const B = ik.B.page;
  await zoek(B, 'Carol Smit');
  await wachtOpTekst(B, '#vriendZoekResultaat', /^Niemand gevonden met deze naam\.$/);
  await schermafbeelding(B, 'naam-zoeken-niemand');
  await zoek(B, 'carol');
  await wachtOpTekst(B, '#vriendZoekResultaat', /@carol · Carol Smit/);
});

test('een woord zonder geldige gebruikersnaam: uitleg; geen e-mailadressen of uid in het antwoord', async () => {
  const B = ik.B.page;
  await zoek(B, 'a');
  await wachtOpTekst(B, '#vriendZoekResultaat', /gebruikersnaam of een voor- en achternaam/);
  const antwoord = await B.evaluate(async () => {
    const { roepFunctie } = await import('./js/firebase.js');
    return (await roepFunctie('zoekOpNaam', { naam: 'Anna de Vries' })).data;
  });
  assert.deepEqual(antwoord, { treffers: [{ gebruikersnaam: 'anna', naam: 'Anna de Vries' }, { gebruikersnaam: 'anna2', naam: 'Anna de Vries' }] });
});

test('geen fouten in de pagina', () => {
  for (const [k, g] of Object.entries(ik)) assert.deepEqual(g.fouten, [], k);
});
