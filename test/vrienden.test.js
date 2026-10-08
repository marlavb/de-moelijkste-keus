// Vrienden (stap 2): de pure delen van public/js/vrienden.js. De rules en de
// Firestore-kant worden getest met de emulator (firebase/tests/vrienden.test.js).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  maakToken,
  isGeldigToken,
  linkUrl,
  linkVerlooptOp,
  isLinkVerlopen,
  verzoekId,
  LINK_GELDIG_DAGEN,
} from '../public/js/vrienden.js';

const DAG = 24 * 60 * 60 * 1000;

test('token: 32 tekens base64url (192 bits uit crypto.getRandomValues), steeds anders', () => {
  const tokens = new Set(Array.from({ length: 200 }, () => maakToken()));
  assert.equal(tokens.size, 200);
  for (const t of tokens) {
    assert.match(t, /^[A-Za-z0-9_-]{32}$/);
    assert.equal(isGeldigToken(t), true);
  }
});

test('token gebruikt crypto.getRandomValues met 24 bytes', () => {
  let gevraagd = 0;
  const nep = { getRandomValues: (a) => { gevraagd = a.length; a.fill(255); return a; } };
  assert.equal(maakToken(nep), '_'.repeat(32));
  assert.equal(gevraagd, 24);
});

test('ongeldige tokens', () => {
  for (const t of ['', 'abc', 'a'.repeat(31), 'a'.repeat(33), 'a'.repeat(31) + '/', null, 42]) assert.equal(isGeldigToken(t), false, String(t));
});

test('link-URL op dezelfde plek als de app', () => {
  assert.equal(linkUrl('T'.repeat(32), { origin: 'https://marlavb.github.io', pathname: '/de-moelijkste-keus/' }),
    `https://marlavb.github.io/de-moelijkste-keus/#/vriend-link/${'T'.repeat(32)}`);
  assert.equal(linkUrl('x', { origin: 'http://localhost:8080', pathname: '/' }), 'http://localhost:8080/#/vriend-link/x');
});

test('link is 7 dagen geldig vanaf aangemaaktOp (Timestamp, Date of getal)', () => {
  assert.equal(LINK_GELDIG_DAGEN, 7);
  const t0 = Date.UTC(2026, 9, 1, 12);
  for (const aangemaaktOp of [t0, new Date(t0), { toMillis: () => t0 }]) {
    assert.equal(linkVerlooptOp({ aangemaaktOp }), t0 + 7 * DAG);
    assert.equal(isLinkVerlopen({ aangemaaktOp }, t0 + 7 * DAG - 1), false);
    assert.equal(isLinkVerlopen({ aangemaaktOp }, t0 + 7 * DAG), true);
  }
});

test('verzoek-id is van_naar', () => {
  assert.equal(verzoekId('a1', 'b2'), 'a1_b2');
});

test('een net gemaakte link zonder bevestigde servertijd (aangemaaktOp null) is niet verlopen', () => {
  for (const aangemaaktOp of [null, undefined, NaN, 0]) {
    assert.equal(linkVerlooptOp({ aangemaaktOp }), null, String(aangemaaktOp));
    assert.equal(isLinkVerlopen({ aangemaaktOp }), false, String(aangemaaktOp));
  }
  assert.equal(isLinkVerlopen({}), false);
});

// ---------- Zoeken op volledige naam (okt 2026) ----------

import { isNaamInvoer, zoekOpNaam, VriendFout as Fout } from '../public/js/vrienden.js';

test('isNaamInvoer: met een spatie is het een naam, anders een gebruikersnaam', () => {
  assert.equal(isNaamInvoer('Anna de Vries'), true);
  assert.equal(isNaamInvoer('  anna  '), false);
  assert.equal(isNaamInvoer('@anna'), false);
  assert.equal(isNaamInvoer(''), false);
});

test('zoekOpNaam: roept de callable met de naam aan, geeft de treffers; fouten van de functie als VriendFout', async () => {
  const geroepen = [];
  const treffers = await zoekOpNaam({ roep: async (naam, data) => (geroepen.push([naam, data]), { data: { treffers: [{ gebruikersnaam: 'anna', naam: 'Anna de Vries' }] } }), invoer: ' Anna de Vries ' });
  assert.deepEqual(geroepen, [['zoekOpNaam', { naam: 'Anna de Vries' }]]);
  assert.deepEqual(treffers, [{ gebruikersnaam: 'anna', naam: 'Anna de Vries' }]);
  const fout = (code) => async () => {
    throw Object.assign(new Error('x'), { code });
  };
  await assert.rejects(zoekOpNaam({ roep: fout('functions/invalid-argument'), invoer: 'a b' }), (e) => e instanceof Fout && e.code === 'ongeldig');
  await assert.rejects(zoekOpNaam({ roep: fout('functions/resource-exhausted'), invoer: 'a b' }), (e) => e instanceof Fout && e.code === 'limiet');
  await assert.rejects(zoekOpNaam({ roep: fout('functions/unavailable'), invoer: 'a b' }), (e) => !(e instanceof Fout));
});
