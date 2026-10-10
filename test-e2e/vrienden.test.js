// End-to-end: profiel, vrienden, delen en gedeelde plannen met drie
// nepaccounts (A = anna, B = bob, C = carol), elk in een eigen browsercontext,
// tegen de Firebase-emulators met de echte firestore.rules. Vervangt de
// afvinklijsten van stap 1 t/m 4. Draai met `npm run test:e2e`.
// De tests in dit bestand bouwen op elkaar voort (in volgorde).

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

import {
  controleerEmulators,
  startServer,
  wisEmulators,
  maakAccount,
  leesDoc,
  lijst,
  alleIn,
  openGebruiker,
  ga,
  wachtOpTekst,
  wachtOpDoc,
  schermafbeelding,
  vasteShows,
} from './hulp.js';
import { watchlistSleutel } from '../public/js/watchlist.js';
import { geplandSleutel } from '../public/js/gepland.js';
import { TIJDZONE, vandaag as vandaagAmsterdam } from '../test/datum.js';

const ACCOUNTS = {
  A: { email: 'anna@e2e.test', wachtwoord: 'geheim-anna', naam: 'Anna de Vries', gebruikersnaam: 'anna' },
  B: { email: 'bob@e2e.test', wachtwoord: 'geheim-bob', naam: 'Bob Jansen', gebruikersnaam: 'bob' },
  C: { email: 'carol@e2e.test', wachtwoord: 'geheim-carol', naam: 'Carol Smit', gebruikersnaam: 'carol' },
};
const uid = {};
const ik = {}; // A, B, C → { ctx, page, fouten }
let server;
let base;
let browser;
let shows; // drie toekomstige voorstellingen met elk een andere sleutel
let planId;

before(async () => {
  controleerEmulators();
  await wisEmulators();
  for (const [k, a] of Object.entries(ACCOUNTS)) uid[k] = await maakAccount(a);
  const data = await vasteShows();
  const alle = Array.isArray(data) ? data : data.shows;
  const vandaag = vandaagAmsterdam();
  const gezien = new Set();
  shows = [];
  for (const s of alle) {
    const k = watchlistSleutel(s.titel, s.theaterId);
    if (s.datum > vandaag && s.tijd && !gezien.has(k)) {
      gezien.add(k);
      shows.push(s);
    }
    if (shows.length === 3) break;
  }
  ({ server, base } = await startServer());
  browser = await chromium.launch();
  for (const k of ['A', 'B', 'C']) ik[k] = await openGebruiker(browser, base, ACCOUNTS[k]);
});

after(async () => {
  for (const g of Object.values(ik)) await g.ctx.close().catch(() => {});
  await browser?.close();
  await new Promise((r) => server.close(r));
});

const hash = (page) => new URL(page.url()).hash;
const tekst = (page, sel) => page.textContent(sel);
const even = (page, ms = 400) => page.waitForTimeout(ms);
const inbox = async (k) => (await lijst(`inbox/${uid[k]}/berichten`)).map((b) => b.data);

// ---------- Rondgang: profiel, vriendschap, delen ----------

test('profiel: na inloggen "Kies je gebruikersnaam", opslaan, usernames-document', async () => {
  for (const k of ['A', 'B', 'C']) {
    const { page } = ik[k];
    await page.waitForFunction(() => location.hash === '#/profiel/instellen', null, { timeout: 15000 });
    await page.fill('#profielGebruikersnaam', ACCOUNTS[k].gebruikersnaam);
    await page.fill('#profielNaam', ACCOUNTS[k].naam);
    await page.click('#profielOpslaan');
    await page.waitForFunction(() => location.hash === '#/profiel', null, { timeout: 15000 });
    await wachtOpTekst(page, '.profiel-regel', new RegExp(`@${ACCOUNTS[k].gebruikersnaam} · ${ACCOUNTS[k].naam}`));
    assert.deepEqual(await leesDoc(`usernames/${ACCOUNTS[k].gebruikersnaam}`), { uid: uid[k], gebruikersnaam: ACCOUNTS[k].gebruikersnaam, naam: ACCOUNTS[k].naam });
  }
});

test('vriendschap via verzoek (A → B): zoeken op exacte naam, teller bij B, accepteren', async () => {
  const A = ik.A.page;
  const B = ik.B.page;
  await ga(A, base, '#/vrienden');
  await wachtOpTekst(A, '#vriendenInhoud', /Nog geen vrienden/);
  await A.fill('#vriendZoekInput', 'BOB');
  await A.click('#vriendZoekForm button[type="submit"]');
  await A.click('button[aria-label="Vriendschapsverzoek sturen aan @bob"]');
  await wachtOpTekst(A, '#vriendZoekResultaat', /Verzoek verstuurd aan @bob/);
  await ga(B, base, '#/profiel');
  await wachtOpTekst(B, '#vriendenTegel', /1 nieuw verzoek/);
  await B.click('#vriendenTegel');
  await B.click('button[aria-label="Verzoek van @anna accepteren"]');
  await wachtOpTekst(B, '#vriendenInhoud', /Je bent nu vrienden met @anna/);
  assert.ok(await leesDoc(`vrienden/${uid.A}/lijst/${uid.B}`));
  assert.ok(await leesDoc(`vrienden/${uid.B}/lijst/${uid.A}`));
});

test('vriendschap via uitnodigingslink (A → C): eenmalig, daarna weg', async () => {
  const A = ik.A.page;
  const C = ik.C.page;
  await ga(A, base, '#/vrienden');
  await A.click('#vriendLinkMaak');
  await A.waitForSelector('.vriend-link-url');
  const url = await A.inputValue('.vriend-link-url');
  const token = url.split('#/vriend-link/')[1];
  assert.match(token, /^[A-Za-z0-9_-]{32}$/);
  await ga(C, base, `#/vriend-link/${token}`);
  await wachtOpTekst(C, '#vriendLinkInhoud', /Word vrienden met @anna\?/);
  await C.click('#vriendLinkInhoud >> text="Ja, word vrienden"');
  await wachtOpTekst(C, '#vriendLinkInhoud', /Je bent nu vrienden met @anna/);
  assert.equal(await leesDoc(`uitnodigingslinks/${token}`), null);
  // Een tweede keer werkt de link niet.
  await ga(ik.B.page, base, `#/vriend-link/${token}`);
  await wachtOpTekst(ik.B.page, '#vriendLinkInhoud', /werkt niet \(meer\)/);
});

test('delen: A deelt Gezien (met ★) en Watchlist; B ziet het vriendenprofiel; uitzetten → "deelt dit niet"', async () => {
  const A = ik.A.page;
  const B = ik.B.page;
  // A: Oké op de melding, twee voorstellingen op de watchlist, één daarvan "Gezien" met 5 sterren.
  await ga(A, base, '#/profiel');
  await A.click('.delen-melding >> text="Oké"');
  await wachtOpDoc(`gedeeld/${uid.A}`);
  for (const s of shows.slice(0, 2)) {
    await ga(A, base, `#/show/${encodeURIComponent(s.id)}`);
    await A.click('#detailWatchBtn');
  }
  await ga(A, base, '#/profiel');
  await A.click(`.watchlist-gezien[aria-label^="${shows[1].titel.replace(/"/g, '\\"')}"]`).catch(() => A.locator('.watchlist-gezien').last().click());
  await A.waitForSelector('#gezienList .sterren');
  await A.focus('#gezienList .sterren');
  await A.keyboard.press('End');
  await wachtOpDoc(`gedeeld/${uid.A}/onderdelen/gezien`, (d) => d?.items?.some((i) => i.beoordeling === 5));
  await wachtOpDoc(`gedeeld/${uid.A}/onderdelen/watchlist`, (d) => d?.items?.length === 1);

  await ga(B, base, '#/vrienden');
  await B.click('button[aria-label="Profiel van @anna bekijken"]');
  await wachtOpTekst(B, '#vriendInhoud', /Gezien.*★ 5.*Watchlist/s);
  assert.equal(await tekst(B, '#vriendTitel'), '@anna');
  await schermafbeelding(B, '5-vriendenprofiel');

  // A zet de watchlist uit → B ziet "deelt dit niet" (en de rules weigeren het lezen).
  await ga(A, base, '#/profiel/delen');
  await A.click('#delenSchakelaar-watchlist');
  await wachtOpDoc(`gedeeld/${uid.A}`, (d) => d?.watchlist === false);
  await ga(B, base, '#/vrienden');
  await B.click('button[aria-label="Profiel van @anna bekijken"]');
  await wachtOpTekst(B, '#vriendInhoud', /@anna deelt dit niet\./);
});

// ---------- Stap 4: uitnodigen ----------

test('uitnodigen: A plant, nodigt B en C uit; plan, leden en berichten', async () => {
  const A = ik.A.page;
  await ga(ik.B.page, base, '#/profiel'); // B blijft op Profiel staan (teller zonder herladen)
  await ga(A, base, `#/show/${encodeURIComponent(shows[2].id)}`);
  await A.click('#detailPlanBtn');
  await ga(A, base, '#/profiel');
  await A.click('#geplandList button[aria-label^="Vrienden uitnodigen"]');
  await A.waitForSelector(`#uitnodig-${uid.B}`);
  await A.check(`#uitnodig-${uid.B}`);
  await A.check(`#uitnodig-${uid.C}`);
  await schermafbeelding(A, '1-uitnodigen-lijst');
  await A.click('#uitnodigenInhoud >> text="Uitnodigen (2)"');
  await wachtOpTekst(A, '#uitnodigenInhoud .vrienden-melding', /Uitgenodigd: @bob, @carol\./);
  const plannen = await lijst('plannen');
  assert.equal(plannen.length, 1);
  planId = plannen[0].pad.split('/')[1];
  assert.deepEqual(plannen[0].data.genodigden, [uid.B, uid.C]);
  assert.equal((await leesDoc(`plannen/${planId}/leden/${uid.B}`)).status, 'uitgenodigd');
  await wachtOpDoc(`users/${uid.A}`, (d) => d?.gepland?.[0]?.planId === planId);
});

test('teller bij B zonder herladen, Berichten met de uitnodiging, titel naar het detailscherm', async () => {
  const B = ik.B.page;
  await B.waitForSelector('#profielBadge:not([hidden])', { timeout: 15000 });
  assert.equal(await tekst(B, '#profielBadge'), '1');
  assert.match(await tekst(B, '#berichtenTegel'), /1 ongelezen/);
  await schermafbeelding(B, '2-berichten-teller');
  await B.click('#berichtenTegel');
  await wachtOpTekst(B, '.bericht', /Nieuw@anna nodigt je uit voor/);
  await schermafbeelding(B, '2b-berichten');
  await B.waitForSelector('#profielBadge', { state: 'hidden', timeout: 15000 });
  await B.click('.bericht-titel');
  await B.waitForFunction(() => location.hash.startsWith('#/show/'));
  await B.click('#detailBack');
  await B.waitForFunction(() => location.hash === '#/berichten');
});

test('B gaat mee: Gepland "Met @anna"; A krijgt live een bericht', async () => {
  const B = ik.B.page;
  await B.click('.bericht >> text="Ik ga mee"');
  await wachtOpTekst(B, '.bericht', /Je gaat mee$/);
  await B.click('#berichtenBack');
  await wachtOpTekst(B, '#geplandList .plan-samen-tekst', /Met @anna/);
  await schermafbeelding(B, '3-gepland-met');
  await ga(ik.A.page, base, '#/profiel');
  await ik.A.page.waitForSelector('#profielBadge:not([hidden])', { timeout: 15000 });
  assert.ok((await inbox('A')).some((b) => b.soort === 'gaat-mee' && b.van === uid.B));
});

test('C kan niet; A ziet "@carol kan niet"; niets in Gepland van C', async () => {
  const C = ik.C.page;
  await ga(C, base, '#/berichten');
  await C.click('.bericht >> text="Kan niet"');
  await wachtOpTekst(C, '.bericht', /Afgeslagen$/);
  assert.equal(((await leesDoc(`users/${uid.C}`))?.gepland ?? []).length, 0);
  await ga(ik.A.page, base, '#/profiel');
  await wachtOpTekst(ik.A.page, '#geplandList .plan-samen-tekst', /Met @bob · @carol kan niet/);
});

test('kaarten van B zichtbaar bij A', async () => {
  await ga(ik.B.page, base, '#/profiel');
  await ik.B.page.click('#geplandList .plan-status');
  await wachtOpDoc(`plannen/${planId}/leden/${uid.B}`, (d) => d?.kaarten === true);
  await ga(ik.A.page, base, '#/profiel');
  await wachtOpTekst(ik.A.page, '#geplandList .plan-samen-tekst', /Met @bob \(kaarten ✓\)/);
});

test('intrekken: C ziet "Ingetrokken"', async () => {
  const A = ik.A.page;
  await A.click('#geplandList button[aria-label^="Vrienden uitnodigen"]');
  await A.click('button[aria-label="Uitnodiging van @carol intrekken"]');
  await wachtOpTekst(A, '#uitnodigenInhoud .vrienden-melding', /ingetrokken/);
  assert.equal(await leesDoc(`plannen/${planId}/leden/${uid.C}`), null);
  await ga(ik.C.page, base, '#/berichten');
  await wachtOpTekst(ik.C.page, '.bericht', /Ingetrokken$/);
});

test('ontdubbelen: C had dezelfde voorstelling al gepland; opnieuw uitgenodigd en meegaan koppelt, geen dubbel', async () => {
  const C = ik.C.page;
  await ga(C, base, `#/show/${encodeURIComponent(shows[2].id)}`);
  await C.click('#detailPlanBtn');
  await wachtOpDoc(`users/${uid.C}`, (d) => d?.gepland?.length === 1);
  const A = ik.A.page;
  await ga(A, base, `#/uitnodigen/${encodeURIComponent(geplandSleutel(shows[2]))}`);
  await A.waitForSelector(`#uitnodig-${uid.C}`);
  await A.check(`#uitnodig-${uid.C}`);
  await A.click('#uitnodigenInhoud >> text="Uitnodigen (1)"');
  await wachtOpDoc(`plannen/${planId}/leden/${uid.C}`, (d) => d?.status === 'uitgenodigd');
  await ga(C, base, '#/berichten');
  await C.locator('.bericht >> text="Ik ga mee"').first().click();
  await wachtOpDoc(`plannen/${planId}/leden/${uid.C}`, (d) => d?.status === 'gaat');
  const gepland = (await wachtOpDoc(`users/${uid.C}`, (d) => d?.gepland?.[0]?.planId === planId)).gepland;
  assert.equal(gepland.length, 1);
});

test('B: "Ik ga toch niet" — eerst Annuleren (niets gebeurt), daarna bevestigen', async () => {
  const B = ik.B.page;
  await ga(B, base, '#/profiel');
  const voor = (await inbox('A')).length;
  await B.click('#geplandList button[aria-label^="Ik ga toch niet"]');
  await wachtOpTekst(B, '#geplandList .plan-bevestig', /Toch niet meegaan\? @anna krijgt hiervan een bericht\./);
  await schermafbeelding(B, '4-bevestiging');
  await B.click('#geplandList .plan-bevestig >> text="Annuleren"');
  await even(B, 1000);
  assert.equal((await leesDoc(`plannen/${planId}/leden/${uid.B}`)).status, 'gaat');
  assert.equal((await inbox('A')).length, voor);
  await B.click('#geplandList button[aria-label^="Ik ga toch niet"]');
  await B.click('#geplandList .plan-bevestig >> text="Ik ga niet"');
  await wachtOpDoc(`plannen/${planId}/leden/${uid.B}`, (d) => d?.status === 'weg');
  assert.ok((await inbox('A')).some((b) => b.soort === 'weg' && b.van === uid.B));
  // saveGepland schrijft zonder te wachten: wachten tot het binnen is.
  await wachtOpDoc(`users/${uid.B}`, (d) => (d?.gepland ?? []).length === 0);
});

test('A heft het plan op (met bevestiging); C krijgt het opheffingsbericht', async () => {
  const A = ik.A.page;
  await ga(A, base, `#/show/${encodeURIComponent(shows[2].id)}`);
  await A.click('#detailPlanSamen >> text="Plan opheffen"');
  await wachtOpTekst(A, '#detailPlanSamen .plan-bevestig', /Plan opheffen\? @carol krijgt hiervan een bericht\./);
  await A.click('#detailPlanSamen .plan-bevestig >> text="Opheffen"');
  await wachtOpDoc(`plannen/${planId}`, (d) => d?.opgeheven === true);
  await wachtOpDoc(`inbox/${uid.C}/berichten/opgeheven_${planId}`);
  await ga(ik.C.page, base, '#/berichten');
  await wachtOpTekst(ik.C.page, '#berichtenInhoud', /@anna heeft het plan opgeheven voor/);
});

test('blokkeren: B blokkeert A; A kan B niet meer uitnodigen en B kan A geen verzoek sturen', async () => {
  const B = ik.B.page;
  await ga(B, base, '#/vrienden');
  await B.click('button[aria-label="Opties voor @anna"]');
  await B.click('.vriend-menu >> text="Blokkeren"');
  await B.click('.vriend-menu >> text="Ja, blokkeren"');
  await wachtOpDoc(`blokkades/${uid.B}/lijst/${uid.A}`);
  assert.equal(await leesDoc(`vrienden/${uid.A}/lijst/${uid.B}`), null);
  // A: B staat niet meer in de lijst om uit te nodigen.
  const A = ik.A.page;
  await ga(A, base, `#/uitnodigen/${encodeURIComponent(geplandSleutel(shows[2]))}`);
  await A.waitForSelector(`#uitnodig-${uid.C}`);
  assert.equal(await A.locator(`#uitnodig-${uid.B}`).count(), 0);
  // A probeert B een verzoek te sturen: neutrale melding.
  await ga(A, base, '#/vrienden');
  await A.fill('#vriendZoekInput', 'bob');
  await A.click('#vriendZoekForm button[type="submit"]');
  await A.click('button[aria-label="Vriendschapsverzoek sturen aan @bob"]');
  await wachtOpTekst(A, '#vriendZoekResultaat', /^Verzoek kan niet worden verstuurd\.$/);
});

test('offline: Berichten blijft niet hangen (berichten uit de cache of een melding); weer online laadt het', async () => {
  const { ctx, page } = ik.C;
  await ga(page, base, '#/profiel');
  await ctx.setOffline(true);
  await page.click('#berichtenTegel');
  // De echte Firestore-SDK toont offline wat hij al heeft (cache); lukt dat
  // niet, dan na de tijdslimiet "konden niet worden geladen". Nooit "Laden…".
  await wachtOpTekst(page, '#berichtenInhoud', /@anna|konden niet worden geladen/, 20000);
  assert.doesNotMatch(await tekst(page, '#berichtenInhoud'), /Laden…/);
  await schermafbeelding(page, '6-berichten-offline');
  await ctx.setOffline(false);
  const opnieuw = page.locator('#berichtenInhoud >> text="Opnieuw proberen"');
  if (await opnieuw.count()) await opnieuw.click();
  await wachtOpTekst(page, '#berichtenInhoud', /@anna/, 20000);
});

test('uitgelogd: geen teller, geen tegels; #/berichten gaat naar Profiel', async () => {
  const g = await openGebruiker(browser, base, null);
  await even(g.page, 1500);
  assert.equal(await g.page.isVisible('#profielBadge'), false);
  assert.equal(await g.page.isVisible('#profielTegels'), false);
  assert.equal(await g.page.isVisible('.google-btn'), true);
  await ga(g.page, base, '#/berichten');
  await g.page.waitForFunction(() => location.hash === '#/profiel');
  assert.deepEqual(g.fouten, []);
  await g.ctx.close();
});

test('Mail in Profiel: uitzetten en weer aanzetten (mailvoorkeur, echte rules)', async () => {
  const B = ik.B.page;
  await ga(B, base, '#/profiel');
  await B.click('#mailTegel');
  await B.waitForSelector('#mailSchakelaar');
  assert.equal(await B.getAttribute('#mailSchakelaar', 'aria-checked'), 'true');
  await B.click('#mailSchakelaar');
  await wachtOpDoc(`mailvoorkeur/${uid.B}`, (d) => d?.uitnodigingen === false);
  await wachtOpTekst(B, '#mailInhoud', /geen mail meer bij uitnodigingen/);
  assert.equal(await B.getAttribute('#mailSchakelaar', 'aria-checked'), 'false');
  await schermafbeelding(B, '7-mail');
  await B.click('#mailSchakelaar');
  await wachtOpDoc(`mailvoorkeur/${uid.B}`, (d) => d?.uitnodigingen === true);
  // De link uit de mail, uitgelogd: eerst inloggen.
  const g = await openGebruiker(browser, base, null, '#/profiel/mail');
  await wachtOpTekst(g.page, '#mailInhoud', /Log in om je mailinstelling/);
  await g.ctx.close();
});

// ---------- Na de speeldag vanzelf naar Gezien (okt 2026) ----------

test('na de speeldag: gedeeld plan zonder kaarten gaat vanzelf naar Gezien (met @anna); weghalen blijft weg', async () => {
  // Een voorstelling die zo snel mogelijk speelt (kleine klokverschuiving).
  const data = await vasteShows();
  const vandaag = vandaagAmsterdam();
  const bezet = new Set(shows.map((s) => watchlistSleutel(s.titel, s.theaterId)));
  const s = (Array.isArray(data) ? data : data.shows)
    .filter((x) => x.datum > vandaag && x.tijd && x.beschikbaarheid === 'beschikbaar' && !bezet.has(watchlistSleutel(x.titel, x.theaterId)))
    .sort((a, b) => a.datum.localeCompare(b.datum))[0];
  const sleutel = geplandSleutel(s);
  // A plant en nodigt C uit; C gaat mee (zonder kaarten).
  const A = ik.A.page;
  await ga(A, base, `#/show/${encodeURIComponent(s.id)}`);
  await A.click('#detailPlanBtn');
  await ga(A, base, `#/uitnodigen/${encodeURIComponent(sleutel)}`);
  await A.waitForSelector(`#uitnodig-${uid.C}`);
  await A.check(`#uitnodig-${uid.C}`);
  await A.click('#uitnodigenInhoud >> text="Uitnodigen (1)"');
  await wachtOpTekst(A, '#uitnodigenInhoud .vrienden-melding', /Uitgenodigd: @carol\./);
  const C = ik.C.page;
  await ga(C, base, '#/berichten');
  await C.locator('.bericht', { hasText: s.titel }).locator('text="Ik ga mee"').first().click();
  await wachtOpDoc(`users/${uid.C}`, (d) => (d?.gepland ?? []).some((i) => i.sleutel === sleutel && i.planId));
  await ga(C, base, '#/profiel');
  await wachtOpTekst(C, '#geplandList', /Met @anna/);

  // C op een tweede apparaat, de dag na de speeldag (10:00 in Amsterdam).
  const [j, m, d] = s.datum.split('-').map(Number);
  const morgen = new Date(Date.UTC(j, m - 1, d + 1, 8, 0));
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block', timezoneId: TIJDZONE });
  await ctx.clock.install({ time: morgen });
  await ctx.clock.resume();
  const page = await ctx.newPage();
  const fouten = [];
  page.on('pageerror', (e) => fouten.push(e.message));
  await page.goto(`${base}?emulator=1#/profiel`);
  await page.waitForFunction(() => typeof window.__e2eLogin === 'function');
  await page.evaluate(([e, w]) => window.__e2eLogin(e, w), [ACCOUNTS.C.email, ACCOUNTS.C.wachtwoord]);
  const doc = await wachtOpDoc(`users/${uid.C}`, (x) => (x?.gezien ?? []).some((i) => i.sleutel === watchlistSleutel(s.titel, s.theaterId)));
  assert.ok(!(doc.gepland ?? []).some((i) => i.sleutel === sleutel), 'uit de planning');
  const item = doc.gezien.find((i) => i.sleutel === watchlistSleutel(s.titel, s.theaterId));
  assert.equal(item.bron, 'planning');
  assert.deepEqual(item.bezoeken.map((b) => [b.datum, b.status, b.metWie]), [[s.datum, 'gepland', ['@anna']]]);
  await wachtOpTekst(page, '#gezienList', /met @anna/);
  assert.equal(await page.getByText('Ben je geweest?').count(), 0);
  // Bovenaan Gezien (nieuwste eerst), met sterren.
  const eerste = page.locator('#gezienList .gezien-row').first();
  assert.match(await eerste.innerText(), new RegExp(s.datum.slice(8).replace(/^0/, '')));
  assert.equal(await eerste.locator('[role="slider"]').count(), 1);
  await eerste.scrollIntoViewIfNeeded();
  await schermafbeelding(page, '8-vanzelf-gezien');
  // Ten onrechte: weghalen. Het eerste apparaat (echte tijd) en herladen zetten het niet terug.
  await eerste.locator('.gezien-weg').click();
  await wachtOpDoc(`users/${uid.C}`, (x) => (x?.gezienVerwijderd ?? []).some((t) => t.sleutel === item.sleutel));
  await page.reload();
  await page.waitForSelector('.nav-item', { state: 'attached' });
  await ga(C, base, '#/profiel');
  await even(C, 1500);
  await even(page, 1500);
  const na = await leesDoc(`users/${uid.C}`);
  assert.ok(!(na.gezien ?? []).some((i) => i.sleutel === item.sleutel), 'blijft weg');
  assert.ok(!(na.gepland ?? []).some((i) => i.sleutel === sleutel), 'niet terug in de planning');
  assert.equal(await page.locator('#gezienList .gezien-row', { hasText: s.titel }).count(), 0);
  assert.deepEqual(fouten, []);
  await ctx.close();
});

test('veldcontrole: geen e-mailadres in Firestore; berichten, plannen en leden met precies de verwachte velden', async () => {
  const collecties = ['users', 'profielen', 'usernames', 'vriendverzoeken', 'lijst', 'uitnodigingslinks', 'gedeeld', 'onderdelen', 'plannen', 'leden', 'berichten', 'mailvoorkeur'];
  const alles = [];
  for (const c of collecties) alles.push(...(await alleIn(c)));
  assert.ok(alles.length > 20, `${alles.length} documenten`);
  const json = JSON.stringify(alles);
  for (const a of Object.values(ACCOUNTS)) assert.ok(!json.includes(a.email), a.email);
  assert.ok(!json.includes('e2e.test'));
  const sleutels = (pad) => alles.filter((d) => d.pad.split('/').at(-2) === pad).map((d) => Object.keys(d.data).sort().join(','));
  for (const k of new Set(sleutels('berichten'))) assert.equal(k, 'aangemaaktOp,gelezen,planId,soort,van');
  for (const k of new Set(sleutels('leden'))) assert.match(k, /^kaarten,planId,(reactieOp,)?rol,status,uid,uitgenodigdDoor,uitgenodigdOp$/);
  for (const k of new Set(sleutels('plannen'))) assert.equal(k, 'aangemaaktOp,eigenaar,genodigden,gewijzigdOp,opgeheven,sleutel,sleutelV,speeldag,voorstelling');
  for (const k of new Set(sleutels('profielen'))) assert.equal(k, 'aangemaaktOp,gebruikersnaam,gebruikersnaamLaag,gewijzigdOp,naam,v');
});

test('geen fouten in de pagina bij A, B en C', () => {
  for (const k of ['A', 'B', 'C']) assert.deepEqual(ik[k].fouten, [], k);
});
