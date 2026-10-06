// End-to-end voor de watchlist-stand en de maker (okt 2026): afgelast en
// "niet meer in de agenda" in Profiel → Watchlist, altijd kunnen verwijderen
// (ook via het eenvoudige scherm), en de maker in Gezien. Ingelogd tegen de
// Firebase-emulators met de echte firestore.rules. De agenda komt uit
// public/data/shows.json, in drie standen via de browser geserveerd:
//   0. zoals hij is (Teckel bij Stadsschouwburg Utrecht zonder maker);
//   1. na de maker op productieniveau (makerMeerderheid.js, de volgende nacht);
//   2. daarna: één voorstelling uit de agenda, één helemaal afgelast, Teckel weg.
// Draai met `npm run test:e2e`. De tests bouwen op elkaar voort.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

import { controleerEmulators, startServer, wisEmulators, maakAccount, openGebruiker, ga, wachtOpTekst, wachtOpDoc, schermafbeelding } from './hulp.js';
import { watchlistSleutel } from '../public/js/watchlist.js';
import { weergaveTitel, watchlistStand } from '../public/js/weergave.js';
import { pasMakerMeerderheidToe } from '../src/lib/makerMeerderheid.js';

const ACCOUNT = { email: 'wim@e2e.test', wachtwoord: 'geheim-wim', naam: 'Wim Kok', gebruikersnaam: 'wim' };
const vandaag = new Date().toISOString().slice(0, 10);
let uid;
let server;
let base;
let browser;
let ik; // { ctx, page, fouten }
const data = {}; // stand → shows
let stand = 0;
let teckelSsu; // Teckel bij Stadsschouwburg Utrecht (zonder maker in de bron)
let teckelMaker; // de maker na stand 1
let weg; // voorstelling die in stand 2 uit de agenda is
let afgelast; // voorstelling die in stand 2 helemaal afgelast is
let deels; // Dekpunt – Jan Beuving: een deel van de data afgelast

const sleutel = (s) => watchlistSleutel(s.titel, s.theaterId);

before(async () => {
  controleerEmulators();
  await wisEmulators();
  uid = await maakAccount(ACCOUNT);
  const ruw = JSON.parse(await readFile(path.join(new URL('../public/', import.meta.url).pathname, 'data/shows.json'), 'utf-8'));
  data[0] = Array.isArray(ruw) ? ruw : ruw.shows;
  data[1] = pasMakerMeerderheidToe(data[0]).shows;

  teckelSsu = data[0].find((s) => s.theaterId === 'stadsschouwburgutrecht' && sleutel(s) === 'teckel' && s.datum >= vandaag);
  assert.ok(teckelSsu, 'Teckel bij Stadsschouwburg Utrecht staat niet (meer) in de data');
  assert.equal(teckelSsu.maker ?? null, null, 'Teckel bij SSU heeft al een maker in de bron');
  teckelMaker = data[1].find((s) => s.id === teckelSsu.id).maker;
  assert.ok(teckelMaker, 'Teckel krijgt geen maker op productieniveau');

  // Twee voorstellingen bij één theater, met een sleutel die nergens anders
  // voorkomt, alleen gewone komende data.
  const perSleutel = new Map();
  for (const s of data[1]) {
    if (!perSleutel.has(sleutel(s))) perSleutel.set(sleutel(s), []);
    perSleutel.get(sleutel(s)).push(s);
  }
  const kandidaten = [...perSleutel.entries()]
    .filter(([k, l]) => !k.includes('::') && /^[a-z ]{6,30}$/.test(k) && new Set(l.map((s) => s.theaterId)).size === 1)
    .filter(([, l]) => l.every((s) => s.datum > vandaag && s.beschikbaarheid === 'beschikbaar') && l.length <= 3)
    .map(([, l]) => l.sort((a, b) => a.datum.localeCompare(b.datum))[0]);
  [weg, afgelast] = kandidaten;
  assert.ok(weg && afgelast, 'geen geschikte voorstellingen in de data');
  deels = data[1].find((s) => sleutel(s) === 'dekpunt | jan beuving' && s.datum >= vandaag && s.beschikbaarheid !== 'afgelast');
  assert.ok(deels, 'Dekpunt – Jan Beuving staat niet (meer) in de data');

  data[2] = data[1]
    .filter((s) => sleutel(s) !== sleutel(weg) && sleutel(s) !== 'teckel')
    .map((s) => (sleutel(s) === sleutel(afgelast) ? { ...s, beschikbaarheid: 'afgelast' } : s));

  ({ server, base } = await startServer());
  browser = await chromium.launch();
  ik = await openGebruiker(browser, base, ACCOUNT);
  await ik.ctx.route(/\/data\/shows\.json/, (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify(data[stand]) }));
});

after(async () => {
  await ik?.ctx.close().catch(() => {});
  await browser?.close();
  await new Promise((r) => server.close(r));
});

// Andere datastand: de pagina echt herladen (een andere hash alleen laadt niets opnieuw).
async function nieuweStand(page, n, hash) {
  stand = n;
  await ga(page, base, hash);
  await page.reload();
  await page.waitForSelector('.nav-item', { state: 'attached' });
}

const gebruiker = (test) => wachtOpDoc(`users/${uid}`, test);
const kopie = (onderdeel, test) => wachtOpDoc(`gedeeld/${uid}/onderdelen/${onderdeel}`, test);
const teckelItem = (d) => d?.gezien?.find((i) => i.sleutel === 'teckel');

test('profiel en delen aan (Oké)', async () => {
  const { page } = ik;
  await page.waitForFunction(() => location.hash === '#/profiel/instellen', null, { timeout: 15000 });
  await page.fill('#profielGebruikersnaam', ACCOUNT.gebruikersnaam);
  await page.fill('#profielNaam', ACCOUNT.naam);
  await page.click('#profielOpslaan');
  await page.waitForFunction(() => location.hash === '#/profiel', null, { timeout: 15000 });
  await page.click('.delen-melding >> text="Oké"');
  await wachtOpDoc(`gedeeld/${uid}`, (d) => d?.gezien === true && d?.watchlist === true);
});

test('Gezien: Teckel zelf aangevinkt zonder maker; na de maker op productieniveau aangevuld (Firestore, kopie voor vrienden, eenvoudig scherm)', async () => {
  const { page } = ik;
  stand = 0;
  await ga(page, base, `#/show/${encodeURIComponent(teckelSsu.id)}`);
  await page.waitForSelector('#screen-detail:not([hidden])');
  assert.equal(await page.isVisible('#detailMaker'), false);
  await page.click('#detailGezienBtn');
  const zonder = teckelItem(await gebruiker((d) => teckelItem(d)));
  assert.equal(zonder.maker, undefined);
  assert.deepEqual(zonder.bezoeken, []);

  // De volgende nacht: de maker op productieniveau.
  await nieuweStand(page, 1, '#/profiel');
  const met = teckelItem(await gebruiker((d) => teckelItem(d)?.maker));
  assert.equal(met.maker, teckelMaker);
  assert.equal(met.genre, 'Toneel');
  assert.equal(met.gewijzigdOp, zonder.gewijzigdOp);
  const k = await kopie('gezien', (d) => d?.items?.find((i) => i.sleutel === 'teckel')?.maker);
  assert.equal(k.items.find((i) => i.sleutel === 'teckel').maker, teckelMaker);

  // Uit de agenda: het eenvoudige Gezien-scherm toont de bewaarde maker.
  await nieuweStand(page, 2, '#/profiel');
  await page.locator('#gezienList .gezien-titel', { hasText: 'Teckel' }).click();
  await page.waitForSelector('#screen-gezien:not([hidden])');
  await wachtOpTekst(page, '#gezienMaker', new RegExp(teckelMaker.replace(/[/]/g, '.')));
  assert.equal(await page.isVisible('#gezienMaker'), true);
  await wachtOpTekst(page, '#gezienBezoeken', /Zelf als gezien aangevinkt/);
  await schermafbeelding(page, '11-gezien-maker');
});

test('watchlist: stand per item ("Afgelast", "x van y data afgelast", "Niet meer in de agenda"), afgelast in agenda en detail', async () => {
  const { page } = ik;
  await nieuweStand(page, 1, '#/');
  for (const s of [weg, afgelast, deels]) {
    await ga(page, base, `#/show/${encodeURIComponent(s.id)}`);
    await page.waitForSelector('#screen-detail:not([hidden])');
    await page.click('#detailWatchIcon');
    await page.waitForSelector('#detailWatchIcon.is-on');
  }
  await gebruiker((d) => d?.watchlist?.length === 3);
  await kopie('watchlist', (d) => d?.items?.length === 3);

  await nieuweStand(page, 2, '#/profiel');
  const rij = (s) => page.locator('#favoritesList .watchlist-item', { hasText: weergaveTitel(s) });
  await rij(afgelast).waitFor();
  assert.equal((await rij(afgelast).locator('.watchlist-stand').textContent()).trim(), 'Afgelast');
  assert.equal((await rij(weg).locator('.watchlist-stand').textContent()).trim(), 'Niet meer in de agenda');
  const deelsStand = watchlistStand(data[2].filter((s) => sleutel(s) === sleutel(deels)), vandaag);
  assert.match(deelsStand.label, /^\d+ van \d+ data afgelast/);
  assert.equal((await rij(deels).locator('.watchlist-stand').textContent()).trim(), deelsStand.label);
  await page.locator('#favoritesList').scrollIntoViewIfNeeded();
  await schermafbeelding(page, '12-watchlist-stand');

  // Afgelast: de rij opent het detailscherm, met "Afgelast".
  await rij(afgelast).locator('.show-row').click();
  await page.waitForSelector('#screen-detail:not([hidden])');
  await wachtOpTekst(page, '#detailStatusBadge', /^Afgelast$/);
  assert.equal(await page.isVisible('#detailVervallenNotice'), true);
  assert.equal(await page.getAttribute('#detailWatchIcon', 'aria-pressed'), 'true');
  await schermafbeelding(page, '13-afgelast-detail');

  // En in de agenda: label "Afgelast" en de bladwijzer.
  await ga(page, base, '#/');
  if (!(await page.locator('#searchInput').isVisible())) await page.click('#searchToggle');
  await page.fill('#searchInput', afgelast.titel);
  await page.waitForTimeout(500);
  const agendaRij = page.locator('#agendaList .show-row', { hasText: afgelast.titel }).first();
  assert.equal(await agendaRij.locator('.status-badge--afgelast').textContent(), 'Afgelast');
  assert.equal(await agendaRij.locator('.watchlist-icon').count(), 1);
  await schermafbeelding(page, '14-afgelast-agenda');
});

test('watchlist: niet meer in de agenda → eenvoudig scherm, bladwijzer haalt weg (tombstone, Firestore, kopie); afgelast weg via de knop in de lijst', async () => {
  const { page } = ik;
  stand = 2;
  await ga(page, base, '#/profiel');
  const rij = (s) => page.locator('#favoritesList .watchlist-item', { hasText: weergaveTitel(s) });
  await rij(weg).locator('.show-row').click();
  await page.waitForSelector('#screen-watchlist:not([hidden])');
  await wachtOpTekst(page, '#watchlistItemTitel', new RegExp(weg.titel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.equal(await page.getAttribute('#watchlistItemIcon', 'aria-pressed'), 'true');
  await schermafbeelding(page, '15-watchlist-eenvoudig');
  await page.click('#watchlistItemIcon');
  await page.waitForSelector('#watchlistItemIcon:not(.is-on)');
  let d = await gebruiker((x) => x?.watchlist?.length === 2);
  assert.ok(d.watchlistVerwijderd.some((t) => t.sleutel === sleutel(weg)));
  await kopie('watchlist', (x) => x?.items?.length === 2 && !x.items.some((i) => i.sleutel === sleutel(weg)));

  // Helemaal afgelast: weg via de bladwijzer-knop in de lijst (≥ 44 px).
  await ga(page, base, '#/profiel');
  const knop = page.locator(`#favoritesList button[aria-label="Verwijder ${weergaveTitel(afgelast)} van watchlist"]`);
  const maat = await knop.boundingBox();
  assert.ok(maat.width >= 44 && maat.height >= 44, JSON.stringify(maat));
  await knop.click();
  await wachtOpTekst(page, '#melding', /Van je watchlist gehaald/);
  d = await gebruiker((x) => x?.watchlist?.length === 1);
  assert.ok(d.watchlistVerwijderd.some((t) => t.sleutel === sleutel(afgelast)));
  assert.equal(d.watchlist[0].sleutel, sleutel(deels));
  await kopie('watchlist', (x) => x?.items?.length === 1 && x.items[0].sleutel === sleutel(deels));
  assert.equal(await rij(afgelast).count(), 0);
  await schermafbeelding(page, '16-watchlist-na-verwijderen');
  assert.deepEqual(ik.fouten, []);
});
