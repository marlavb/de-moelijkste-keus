// End-to-end: account verwijderen (vrienden stap 6, okt 2026), tegen de
// emulators mét de Functions-emulator (callable verwijderAccount) en de echte
// firestore.rules. Twee accounts:
//   A anna "Anna de Vries" — verwijdert haar account
//   B bob  "Bob Jansen"    — vriend van anna, gast in haar plan
// Draai met `npm run test:e2e` (ronde met de functies). Tests in volgorde.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

import { controleerEmulators, startServer, wisEmulators, maakAccount, leesDoc, schrijfDoc, openGebruiker, ga, wachtOpTekst, schermafbeelding } from '../hulp.js';
import { dagenVerder } from '../../test/datum.js';

const ACCOUNTS = {
  A: { email: 'anna@verwijder.e2e.test', wachtwoord: 'geheim-anna', naam: 'Anna de Vries', gebruikersnaam: 'anna' },
  B: { email: 'bob@verwijder.e2e.test', wachtwoord: 'geheim-bob', naam: 'Bob Jansen', gebruikersnaam: 'bob' },
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

/** Kan dit account nog inloggen (Auth-emulator)? */
async function kanInloggen({ email, wachtwoord }) {
  const r = await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-sleutel', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: wachtwoord, returnSecureToken: true }),
  });
  return r.ok;
}

test('profielen, vriendschap, plan van anna met bob, bericht aan bob', async () => {
  for (const k of Object.keys(ACCOUNTS)) {
    const { page } = ik[k];
    await page.waitForFunction(() => location.hash === '#/profiel/instellen', null, { timeout: 15000 });
    await page.fill('#profielGebruikersnaam', ACCOUNTS[k].gebruikersnaam);
    await page.fill('#profielNaam', ACCOUNTS[k].naam);
    await page.click('#profielOpslaan');
    await page.waitForFunction(() => location.hash === '#/profiel', null, { timeout: 15000 });
  }
  const nu = new Date();
  await schrijfDoc(`vrienden/${uid.A}/lijst/${uid.B}`, { uid: uid.B, sinds: nu, via: 'verzoek' });
  await schrijfDoc(`vrienden/${uid.B}/lijst/${uid.A}`, { uid: uid.A, sinds: nu, via: 'verzoek' });
  const datum = dagenVerder(10);
  await schrijfDoc('plannen/plan-anna', {
    eigenaar: uid.A,
    sleutel: `delamar|${datum}|20:15|grip`,
    sleutelV: 4,
    voorstelling: { titel: 'Grip – Rayen Panday', theaterId: 'delamar', theaterNaam: 'DeLaMar', stad: 'Amsterdam', datum, tijd: '20:15' },
    speeldag: new Date(`${datum}T00:00:00Z`),
    genodigden: [uid.B],
    opgeheven: false,
    aangemaaktOp: nu,
    gewijzigdOp: nu,
  });
  await schrijfDoc(`plannen/plan-anna/leden/${uid.A}`, { uid: uid.A, planId: 'plan-anna', rol: 'organisator', status: 'gaat', uitgenodigdDoor: uid.A, uitgenodigdOp: nu, kaarten: false });
  await schrijfDoc(`plannen/plan-anna/leden/${uid.B}`, { uid: uid.B, planId: 'plan-anna', rol: 'gast', status: 'uitgenodigd', uitgenodigdDoor: uid.A, uitgenodigdOp: nu, kaarten: false });
  await schrijfDoc(`inbox/${uid.B}/berichten/uitnodiging_plan-anna`, { soort: 'uitnodiging', van: uid.A, planId: 'plan-anna', aangemaaktOp: nu, gelezen: false });
  assert.ok(await leesDoc(`profielen/${uid.A}`));
  assert.ok(await leesDoc('usernames/anna'));
});

test('de knop in Profiel opent het scherm met wat er weggaat; verwijderen pas na het vinkje', async () => {
  const { page } = ik.A;
  await ga(page, base, '#/profiel');
  await page.waitForSelector('#accountVerwijderenKnop', { state: 'visible' });
  await page.locator('#accountVerwijderenKnop').scrollIntoViewIfNeeded();
  await schermafbeelding(page, 'account-verwijderen-knop');
  await page.click('#accountVerwijderenKnop');
  await page.waitForFunction(() => location.hash === '#/profiel/account-verwijderen');
  await wachtOpTekst(page, '#accountVerwijderenInhoud', /Dit kan niet ongedaan worden gemaakt/);
  const tekst = await page.textContent('#accountVerwijderenInhoud');
  for (const regel of [/gebruikersnaam \(die is daarna weer vrij/, /watchlist, Gezien, planning en theaterkeuze/, /vriendschappen/, /Gedeeld plan opgeheven/, /Berichten aan en van jou/, /Google-account zelf blijft bestaan/]) {
    assert.match(tekst, regel);
  }
  assert.equal(await page.isDisabled('#accountVerwijderenBevestig'), true);
  await page.check('#verwijderBegrepen');
  assert.equal(await page.isDisabled('#accountVerwijderenBevestig'), false);
  await schermafbeelding(page, 'account-verwijderen-bevestiging');
  // Annuleren: terug naar Profiel, niets weg.
  await page.click('text=Annuleren');
  await page.waitForFunction(() => location.hash === '#/profiel');
  assert.ok(await leesDoc(`profielen/${uid.A}`));
  assert.equal(ik.A.fouten.length, 0, ik.A.fouten.join('\n'));
});

test('verwijderen: niets meer van anna, ook niet bij bob; gebruikersnaam vrij; inlog weg; lokale lijsten gewist', async () => {
  const { page } = ik.A;
  await page.evaluate(() => localStorage.setItem('podiumagenda:watchlist', JSON.stringify({ watchlist: [{ sleutel: 'grip' }], watchlistVerwijderd: [] })));
  await page.click('#accountVerwijderenKnop');
  await page.waitForSelector('#verwijderBegrepen');
  await page.check('#verwijderOokLokaal');
  await page.check('#verwijderBegrepen');
  await page.click('#accountVerwijderenBevestig');
  await wachtOpTekst(page, '#accountVerwijderenInhoud', /Je account is verwijderd/, 30000);
  await schermafbeelding(page, 'account-verwijderen-klaar');

  for (const pad of [
    `users/${uid.A}`,
    `profielen/${uid.A}`,
    'usernames/anna',
    `vrienden/${uid.A}/lijst/${uid.B}`,
    `vrienden/${uid.B}/lijst/${uid.A}`,
    'plannen/plan-anna',
    `plannen/plan-anna/leden/${uid.B}`,
    `inbox/${uid.B}/berichten/uitnodiging_plan-anna`,
    `naamvoorkeur/${uid.A}`,
    `naamIndexLid/${uid.A}`,
  ]) {
    assert.equal(await leesDoc(pad), null, pad);
  }
  assert.equal(await kanInloggen(ACCOUNTS.A), false);
  assert.equal(await kanInloggen(ACCOUNTS.B), true);
  assert.ok(await leesDoc(`profielen/${uid.B}`));
  // Lokaal gewist en uitgelogd.
  assert.equal(await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('podiumagenda:watchlist')).length), 0);
  await page.click('text=Naar de agenda');
  await page.waitForFunction(() => location.hash === '#/' || location.hash === '');
  await ga(page, base, '#/profiel');
  await wachtOpTekst(page, '#authBox', /Niet ingelogd/);
  assert.equal(await page.isHidden('#accountVerwijderenRij'), true);

  // Bij bob: geen vriend meer.
  const B = ik.B.page;
  await ga(B, base, '#/vrienden');
  await wachtOpTekst(B, '#vriendenInhoud', /Nog geen vrienden/);
  assert.equal(ik.A.fouten.length, 0, ik.A.fouten.join('\n'));
});
