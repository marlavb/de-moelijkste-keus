// Delen met vrienden (stap 3): de pure delen van public/js/gedeeld.js. De
// rules worden getest met de emulator (firebase/tests/gedeeld.test.js).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  kopieWatchlist,
  kopieGezien,
  standVan,
  schoonItems,
  sorteerKopieGezien,
  sorteerKopieWatchlist,
  MAX_ITEMS,
} from '../public/js/gedeeld.js';

const WATCHLIST = {
  watchlist: [
    { sleutel: 'titanique', titel: 'Titanique', theaterId: 'delamar', toegevoegdOp: 100, v: 4 },
    { sleutel: 'controle', titel: 'CONTROLE 12+', theaterId: 'isala', toegevoegdOp: 300, v: 4 },
  ],
  watchlistVerwijderd: [{ sleutel: 'adem', verwijderdOp: 500 }],
};
const GEZIEN = {
  gezien: [
    {
      sleutel: 'nora', titel: 'Nora', sleutelTitel: 'Nora', theaterId: 'ita', bron: 'planning', toegevoegdOp: 10, gewijzigdOp: 20, v: 4,
      beoordeling: 4.5, beoordeeldOp: 700,
      bezoeken: [
        { datum: '2026-05-01', tijd: '20:00', theaterId: 'ita', zaal: 'Rabozaal', maker: 'ITA', genre: 'Toneel', status: 'kaarten', url: 'https://x' },
        { datum: '2026-09-12', tijd: '14:00', theaterId: 'ita', zaal: 'Grote zaal' },
      ],
    },
    { sleutel: 'cabaret', titel: 'Cabaret', toegevoegdOp: 30, v: 4, bezoeken: [] },
  ],
  gezienVerwijderd: [{ sleutel: 'oud', verwijderdOp: 900 }],
};

test('kopie watchlist: alleen sleutel, titel, maker en genre; actuele gegevens uit de agenda', () => {
  const info = (s) => (s === 'controle' ? { titel: 'Controle', maker: 'Toneelgroep X', genre: 'Toneel' } : null);
  assert.deepEqual(kopieWatchlist(WATCHLIST, info), [
    { sleutel: 'controle', titel: 'Controle', maker: 'Toneelgroep X', genre: 'Toneel' },
    { sleutel: 'titanique', titel: 'Titanique' },
  ]);
});

test('kopie Gezien: laatste bezoek, aantal, sterren; geen tijd, zaal, theater, status of url', () => {
  const [cabaret, nora] = kopieGezien(GEZIEN);
  assert.deepEqual(nora, { sleutel: 'nora', titel: 'Nora', maker: 'ITA', genre: 'Toneel', beoordeling: 4.5, laatsteBezoek: '2026-09-12', aantal: 2 });
  assert.deepEqual(cabaret, { sleutel: 'cabaret', titel: 'Cabaret', aantal: 1 });
  const json = JSON.stringify(kopieGezien(GEZIEN));
  for (const verboden of ['Rabozaal', 'Grote zaal', 'ita"', 'kaarten', 'https', '20:00', 'toegevoegdOp', 'oud']) assert.ok(!json.includes(verboden), verboden);
});

test('stand: de laatste handeling, ook een verwijdering of beoordeling', () => {
  assert.equal(standVan(WATCHLIST, 'watchlist'), 500);
  assert.equal(standVan(GEZIEN, 'gezien'), 900);
  assert.equal(standVan({ gezien: [], gezienVerwijderd: [] }, 'gezien'), 0);
  assert.equal(standVan(null, 'watchlist'), 0);
});

test('kopie is stabiel (zelfde invoer → zelfde JSON), dus geen onnodige schrijfacties', () => {
  const omgekeerd = { ...WATCHLIST, watchlist: [...WATCHLIST.watchlist].reverse() };
  assert.equal(JSON.stringify(kopieWatchlist(WATCHLIST)), JSON.stringify(kopieWatchlist(omgekeerd)));
});

test('schoonmaken: onbekende velden weg, tekst ingekort, ongeldige sterren en datums weg, maximaal 1000', () => {
  const uit = schoonItems(
    [
      { sleutel: 's', titel: 'x'.repeat(300), maker: ' M ', genre: 'g'.repeat(50), beoordeling: 0.5, laatsteBezoek: '2026-1-1', aantal: 2.5, zaal: 'z' },
      { sleutel: 's2', titel: 'T', beoordeling: 3.5, laatsteBezoek: '2026-01-01', aantal: 5000 },
      { sleutel: '', titel: 'leeg' },
      null,
    ],
    'gezien'
  );
  assert.deepEqual(uit, [
    { sleutel: 's', titel: 'x'.repeat(200), maker: 'M', genre: 'g'.repeat(40), aantal: 1 },
    { sleutel: 's2', titel: 'T', beoordeling: 3.5, laatsteBezoek: '2026-01-01', aantal: 999 },
  ]);
  assert.deepEqual(schoonItems([{ sleutel: 'a', titel: 'A', beoordeling: 4, aantal: 3 }], 'watchlist'), [{ sleutel: 'a', titel: 'A' }]);
  assert.equal(schoonItems(Array.from({ length: 1200 }, (_, i) => ({ sleutel: `${i}`, titel: 't' })), 'watchlist').length, MAX_ITEMS);
  assert.deepEqual(schoonItems('geen lijst', 'gezien'), []);
});

test('sorteren: nieuwste bezoek eerst, of hoogste beoordeling eerst (gelijk: op bezoek)', () => {
  const items = [
    { sleutel: 'a', titel: 'A', laatsteBezoek: '2026-01-01', beoordeling: 5 },
    { sleutel: 'b', titel: 'B', laatsteBezoek: '2026-03-01' },
    { sleutel: 'c', titel: 'C', laatsteBezoek: '2026-02-01', beoordeling: 5 },
  ];
  assert.deepEqual(sorteerKopieGezien(items).map((i) => i.sleutel), ['b', 'c', 'a']);
  assert.deepEqual(sorteerKopieGezien(items, true).map((i) => i.sleutel), ['c', 'a', 'b']);
  assert.deepEqual(sorteerKopieWatchlist([{ titel: 'Zebra' }, { titel: 'appel' }]).map((i) => i.titel), ['appel', 'Zebra']);
});
