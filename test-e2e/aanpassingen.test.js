// End-to-end voor de aanpassingen van okt 2026 (volle data, terug na een
// datumwissel, provincievinkje), ingelogd tegen de Firebase-emulators met de
// echte firestore.rules en de echte agenda (public/data/shows.json).
// Draai met `npm run test:e2e`. De tests bouwen op elkaar voort.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

import { controleerEmulators, startServer, wisEmulators, maakAccount, openGebruiker, ga, wachtOpDoc, schermafbeelding } from './hulp.js';

const ACCOUNT = { email: 'dirk@e2e.test', wachtwoord: 'geheim-dirk', naam: 'Dirk Bos' };
let uid;
let server;
let base;
let browser;
let ik; // { ctx, page, fouten }
let shows;
const vandaag = new Date().toISOString().slice(0, 10);
const isVol = (s) => s.beschikbaarheid === 'uitverkocht' || s.beschikbaarheid === 'wachtlijst';

before(async () => {
  controleerEmulators();
  await wisEmulators();
  uid = await maakAccount(ACCOUNT);
  const data = JSON.parse(await readFile(path.join(new URL('../public/', import.meta.url).pathname, 'data/shows.json'), 'utf-8'));
  shows = (Array.isArray(data) ? data : data.shows).filter((s) => s.datum >= vandaag);
  ({ server, base } = await startServer());
  browser = await chromium.launch();
  ik = await openGebruiker(browser, base, ACCOUNT);
  // Eenmalig "Kies je gebruikersnaam" na het inloggen: eerst laten gebeuren.
  await wachtOpDoc(`users/${uid}`, (d) => d?.profielGevraagd === true);
});

after(async () => {
  await ik?.ctx.close().catch(() => {});
  await browser?.close();
  await new Promise((r) => server.close(r));
});

/** Producties (theater + titel) met hun komende data, in datumvolgorde. */
function producties() {
  const m = new Map();
  for (const s of shows) {
    const k = `${s.theaterId}|${s.titel}`;
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(s);
  }
  for (const l of m.values()) l.sort((a, b) => `${a.datum} ${a.tijd ?? ''}`.localeCompare(`${b.datum} ${b.tijd ?? ''}`));
  return [...m.values()];
}

async function zoek(page, tekst) {
  await page.evaluate(() => window.scrollTo(0, 0));
  if (!(await page.locator('#searchInput').isVisible())) await page.click('#searchToggle');
  await page.fill('#searchInput', tekst);
  await page.waitForTimeout(500);
}

// ---------- Uitverkochte en wachtlijst-data ----------

test('volle data: niet in de agenda, wel als grijze blokjes in het detail; eigen plan op een wachtlijst-datum blijft (Firestore)', async () => {
  // Een voorstelling met een gewone datum én een wachtlijst-datum, en een unieke titel.
  const titels = new Map();
  for (const s of shows) titels.set(s.titel, (titels.get(s.titel) ?? new Set()).add(s.theaterId));
  const prod = producties().find(
    (l) => titels.get(l[0].titel).size === 1 && l.length <= 12 && l.some((s) => s.beschikbaarheid === 'wachtlijst') && l.some((s) => !isVol(s))
  );
  assert.ok(prod, 'geen voorstelling met wachtlijst-data in de huidige data');
  const { page } = ik;
  await ga(page, base, '#/');
  await zoek(page, prod[0].titel);
  const rijen = page.locator('#agendaList .show-row', { hasText: prod[0].titel });
  assert.equal(await rijen.count(), prod.filter((s) => !isVol(s)).length);
  assert.equal(await page.locator('#agendaList .status-badge--wachtlijst, #agendaList .status-badge--uitverkocht').count(), 0);

  // Detail: alle data op volgorde, de volle grijs en uitgeschakeld.
  const open = prod.find((s) => !isVol(s));
  await ga(page, base, `#/show/${encodeURIComponent(open.id)}`);
  await page.waitForSelector('#detailOtherDates .chip');
  const chips = page.locator('#detailOtherDates .chip');
  assert.equal(await chips.count(), prod.length);
  const vol = await chips.evaluateAll((els) => els.map((e) => e.classList.contains('chip--vol') && e.disabled && e.getAttribute('aria-disabled') === 'true'));
  assert.deepEqual(vol, prod.map(isVol));
  const wl = prod.findIndex((s) => s.beschikbaarheid === 'wachtlijst');
  assert.match(await chips.nth(wl).getAttribute('aria-label'), /, wachtlijst$/);
  await chips.nth(wl).scrollIntoViewIfNeeded();
  await schermafbeelding(page, '9-volle-data');

  // Een eigen plan op de wachtlijst-datum (via een directe link): blijft staan.
  const wachtlijst = prod[wl];
  await ga(page, base, `#/show/${encodeURIComponent(wachtlijst.id)}`);
  await page.click('#detailPlanBtn');
  await wachtOpDoc(`users/${uid}`, (d) => (d?.gepland ?? []).some((i) => i.datum === wachtlijst.datum && i.theaterId === wachtlijst.theaterId));
  await ga(page, base, '#/profiel');
  await page.waitForSelector('#geplandList .plan-row');
  assert.equal(await page.locator('#geplandList .plan-row .plan-flag').count(), 0);
  await page.locator('#geplandList .plan-info').first().click();
  await page.waitForFunction((id) => location.hash === `#/show/${encodeURIComponent(id)}`, wachtlijst.id);
  assert.equal(await page.locator('#detailOtherDates .chip.is-active.chip--vol').count(), 1);
  assert.deepEqual(ik.fouten, []);
});

// ---------- Terug na een datumwissel ----------

test('terug na een datumwissel: vanuit Gepland naar een andere datum, terug (knop en browser) gaat meteen naar Profiel', async () => {
  const { page } = ik;
  for (const terug of [() => page.click('#detailBack'), () => page.goBack()]) {
    await ga(page, base, '#/profiel');
    await page.waitForSelector('#geplandList .plan-info');
    await page.locator('#geplandList .plan-info').first().click();
    await page.waitForFunction(() => location.hash.startsWith('#/show/'));
    const eerste = page.url();
    await page.locator('#detailOtherDates .chip:not(.chip--vol):not(.is-active)').first().click();
    await page.waitForFunction((u) => location.href !== u, eerste);
    assert.match(page.url(), /#\/show\//);
    await terug();
    await page.waitForFunction(() => location.hash === '#/profiel');
    assert.equal(await page.locator('#screen-profiel').isVisible(), true);
  }
  assert.deepEqual(ik.fouten, []);
});

// ---------- Theaters: vinkje per provincie ----------

test('provincievinkje: uit (echte rules), tweede apparaat ziet "uit"; één theater aan → deels; tik → alles aan', async () => {
  const { page } = ik;
  const vak = (p) => p.getByRole('checkbox', { name: 'Alle theaters in Zuid-Holland' });
  const stand = (p) => vak(p).evaluate((v) => (v.indeterminate ? 'deels' : v.checked ? 'aan' : 'uit'));
  await ga(page, base, '#/theaters');
  await page.waitForSelector('.provincie-vak');
  assert.equal(await stand(page), 'aan');
  await vak(page).click();
  const doc = await wachtOpDoc(`users/${uid}`, (d) => d?.enabledTheaters?.isala === false);
  const zh = Object.entries(doc.enabledTheaters).filter(([, v]) => v === false).map(([id]) => id);
  assert.ok(zh.length >= 3, zh.join(','));
  await schermafbeelding(page, '10-provincievinkje');

  // Tweede apparaat: zelfde keuze.
  const twee = await openGebruiker(browser, base, ACCOUNT, '#/theaters');
  await twee.page.waitForSelector('.provincie-vak');
  await twee.page.waitForFunction(() => {
    const v = [...document.querySelectorAll('.provincie-vak')].find((x) => x.dataset.provincie === 'Zuid-Holland');
    return v && !v.checked && !v.indeterminate;
  });
  // Daar één theater weer aan: deels; en de keuze gaat terug naar Firestore.
  const stad = twee.page.locator('#theatersList .theaters-province-head', { hasText: 'Zuid-Holland' }).locator('xpath=following-sibling::div[contains(@class,"theaters-city-section")][.//button[contains(@class,"switch")]][1]');
  await stad.locator('.theaters-city-header > span').last().click();
  await stad.locator('.switch').first().click();
  assert.equal(await stand(twee.page), 'deels');
  await wachtOpDoc(`users/${uid}`, (d) => Object.values(d?.enabledTheaters ?? {}).filter((v) => v === false).length === zh.length - 1);
  await vak(twee.page).click();
  assert.equal(await stand(twee.page), 'aan');
  await wachtOpDoc(`users/${uid}`, (d) => !Object.values(d?.enabledTheaters ?? {}).includes(false));
  // Het eerste apparaat volgt.
  await ga(page, base, '#/theaters');
  await page.waitForSelector('.provincie-vak');
  assert.equal(await stand(page), 'aan');
  assert.deepEqual(twee.fouten, []);
  assert.deepEqual(ik.fouten, []);
  await twee.ctx.close();
});
