// Tests voor de watchlist (public/js/watchlist.js): de vaste titeltest voor
// de normalisatie, samenvoegen met tijdstempels, en de migratie van oude
// favorieten. Wijzig je de normalisatie of de uitsluitlijst, verhoog dan
// NORMALISATIE_VERSIE en werk de vaste titeltest bij (zie CLAUDE.md).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  NORMALISATIE_VERSIE,
  watchlistSleutel,
  voegToe,
  verwijder,
  voegSamen,
  renormaliseer,
  favorietNaarItem,
  laadWatchlist,
  bekendeSleutels,
  legeWatchlist,
} from '../public/js/watchlist.js';

const sleutels = (profiel) => profiel.watchlist.map((i) => i.sleutel);

test('vaste titeltest: varianten per theater vallen samen', () => {
  const groepen = {
    'juf braaksel': [
      'Juf Braaksel de Musical (6+)',
      'Juf Braaksel: De Musical (6+)',
      'Juf Braaksel De Musical (6-13 jaar)',
      'Juf Braaksel – De Musical (6+)',
      'Juf Braaksel - De Musical (6+)',
    ],
    titanique: ['Titanique', 'TiTANiQUE de musical'],
    controle: ['Controle', 'CONTROLE 12+', 'CONTROLE', 'Controle (12+)', 'CONTROLE (12+)'],
    'jorgen raymann': ['Jörgen Raymann', 'Jorgen Raymann'],
    'sara kroos': ['Sara Kroos'],
    familiecarrousel: ['Familiecarrousel (4+)', 'Familiecarrousel (6+)', 'Familiecarrousel (8+)'],
  };
  for (const [verwacht, titels] of Object.entries(groepen)) {
    for (const t of titels) assert.equal(watchlistSleutel(t, 'x'), verwacht, t);
  }
});

test('vaste titeltest: wat níet mag samenvallen', () => {
  assert.equal(watchlistSleutel('Alles onder controle', 'x'), 'alles onder controle');
  assert.equal(watchlistSleutel('Adem van het Woud', 'x'), 'adem van het woud');
  assert.equal(watchlistSleutel('Sara Kroos - Prikkelarme kermis', 'x'), 'sara kroos prikkelarme kermis');
  assert.equal(watchlistSleutel('CABARETDUBBEL', 'x'), 'cabaretdubbel');
});

test('vaste titeltest: titels op de uitsluitlijst zijn theatergebonden', () => {
  assert.equal(watchlistSleutel('Nora', 'delamar'), 'delamar::nora');
  assert.notEqual(watchlistSleutel('Nora', 'delamar'), watchlistSleutel('Nora', 'flint'));
  assert.equal(watchlistSleutel('ADEM', 'schuur'), 'schuur::adem');
  assert.equal(watchlistSleutel('Adem', 'zaantheater'), 'zaantheater::adem');
  assert.equal(watchlistSleutel('Cabaret', 'kunstlinie'), 'kunstlinie::cabaret');
  const item = voegToe(legeWatchlist(), { titel: 'Nora', theaterId: 'flint' }, 5).watchlist[0];
  assert.equal(item.theaterId, 'flint');
  assert.equal(watchlistSleutel('Blind Date', 'kunstlinie'), 'kunstlinie::blind date');
  assert.equal(watchlistSleutel('Blind Date (4+)', 'kunstlinie'), 'kunstlinie::blind date');
  assert.equal(watchlistSleutel('BLIND DATE', 'karavaan'), 'karavaan::blind date');
  assert.equal(watchlistSleutel('Blind date DANS', 'aandeslinger'), 'blind date dans');
  // Een globale sleutel onthoudt ook het theater van herkomst.
  const t = voegToe(legeWatchlist(), { titel: 'Titanique', theaterId: 'flint' }, 5).watchlist[0];
  assert.equal(t.sleutel, 'titanique');
  assert.equal(t.theaterId, 'flint');
});

test('verwijderen en herladen: item blijft weg', () => {
  let p = voegToe(legeWatchlist(), { titel: 'Titanique', theaterId: 'flint' }, 10);
  p = verwijder(p, 'titanique', 20);
  assert.deepEqual(sleutels(p), []);
  const opnieuw = laadWatchlist({ opgeslagen: JSON.parse(JSON.stringify(p)) });
  assert.deepEqual(sleutels(opnieuw.profiel), []);
  assert.equal(opnieuw.gewijzigd, false);
});

test('oude favoriet verwijderen: komt niet terug uit het favorites-veld', () => {
  const eerste = laadWatchlist({ opgeslagen: null, favorieten: ['delamar::Titanique'] });
  assert.deepEqual(sleutels(eerste.profiel), ['titanique']);
  assert.equal(eerste.profiel.watchlist[0].toegevoegdOp, 0);
  const weg = verwijder(eerste.profiel, 'titanique', 1000);
  const tweede = laadWatchlist({ opgeslagen: weg, favorieten: ['delamar::Titanique'] });
  assert.deepEqual(sleutels(tweede.profiel), []);
  assert.equal(tweede.gewijzigd, false);
});

test('verwijderen op A, samenvoegen met B: de laatste actie wint', () => {
  const b = voegToe(legeWatchlist(), { titel: 'Titanique', theaterId: 'flint' }, 10);
  const a = verwijder(b, 'titanique', 20);
  assert.deepEqual(sleutels(voegSamen(a, b)), []);
  assert.deepEqual(sleutels(voegSamen(b, a)), []);
  // Later op B opnieuw toegevoegd: dan wint B.
  const bLater = voegToe(b, { titel: 'Titanique', theaterId: 'flint' }, 30);
  assert.deepEqual(sleutels(voegSamen(a, bLater)), ['titanique']);
});

test('opnieuw toevoegen na verwijderen ruimt de tombstone op', () => {
  let p = voegToe(legeWatchlist(), { titel: 'Titanique', theaterId: 'flint' }, 10);
  p = verwijder(p, 'titanique', 20);
  assert.equal(p.watchlistVerwijderd.length, 1);
  p = voegToe(p, { titel: 'Titanique', theaterId: 'zaantheater' }, 30);
  assert.deepEqual(sleutels(p), ['titanique']);
  assert.deepEqual(p.watchlistVerwijderd, []);
});

test('bij gelijke tijd wint de verwijdering', () => {
  const p = voegSamen(
    { watchlist: [{ sleutel: 'x', titel: 'X', toegevoegdOp: 5 }], watchlistVerwijderd: [] },
    { watchlist: [], watchlistVerwijderd: [{ sleutel: 'x', verwijderdOp: 5 }] }
  );
  assert.deepEqual(sleutels(p), []);
});

test('twee keer laden schrijft niets', () => {
  const bekend = new Map([['marcel van roosmalen', 'Marcel van Roosmalen']]);
  const favorieten = ['delamar::Titanique', 'delamar-marcel-van-roosmalen-2026-09-18-2030', 'ita::GONE -  Inspired by Benjamin Clementine'];
  const eerste = laadWatchlist({ opgeslagen: null, favorieten, bekend });
  assert.equal(eerste.gewijzigd, true);
  const tweede = laadWatchlist({ opgeslagen: JSON.parse(JSON.stringify(eerste.profiel)), favorieten, bekend });
  assert.equal(tweede.gewijzigd, false);
  assert.deepEqual(tweede.profiel, eerste.profiel);
});

test('ITA-hernoemingen gaan voor de omzetting', () => {
  const r = favorietNaarItem('ita::GONE -  Inspired by Benjamin Clementine');
  assert.equal(r.item.sleutel, 'gone');
  assert.equal(r.item.titel, 'GONE');
});

test('oude slug: letterlijk als die in de data bestaat', () => {
  const bekend = new Map([['marcel van roosmalen', 'Marcel van Roosmalen']]);
  const r = favorietNaarItem('delamar-marcel-van-roosmalen-2026-09-18-2030', bekend);
  assert.equal(r.bron, 'oude-slug');
  assert.equal(r.variant, 'letterlijk');
  assert.equal(r.item.sleutel, 'marcel van roosmalen');
  assert.equal(r.item.titel, 'Marcel van Roosmalen');
});

test('oude slug: zonder achterliggend getal of "de musical"', () => {
  const bekend = new Map([['juf braaksel', 'Juf Braaksel De Musical (6+)'], ['boer zoekt vrouw', 'Boer zoekt vrouw']]);
  const a = favorietNaarItem('stoep-juf-braaksel-de-musical-6-2026-10-04-1400', bekend);
  assert.equal(a.item.sleutel, 'juf braaksel');
  const b = favorietNaarItem('flint-boer-zoekt-vrouw-2-2026-11-01-2015', bekend);
  assert.equal(b.item.sleutel, 'boer zoekt vrouw');
  assert.equal(b.variant, 'boer zoekt vrouw');
});

test('oude slug niet in de data: letterlijke slug', () => {
  const r = favorietNaarItem('flint-iets-onbekends-2026-09-01-2015', new Map());
  assert.equal(r.item.sleutel, 'iets onbekends');
  assert.equal(r.variant, 'letterlijk');
  assert.equal(favorietNaarItem('iets zonder formaat'), null);
});

test('oude slug met titel op de uitsluitlijst blijft theatergebonden', () => {
  const r = favorietNaarItem('flint-nora-2026-10-01-2015', new Map([['flint::nora', 'Nora']]));
  assert.equal(r.item.sleutel, 'flint::nora');
  assert.equal(r.item.theaterId, 'flint');
});

test('her-normaliseren: alleen items met een oudere versie, idempotent', () => {
  const oud = { watchlist: [{ sleutel: 'Juf Braaksel De Musical', titel: 'Juf Braaksel De Musical (6+)', toegevoegdOp: 3, v: 0 }], watchlistVerwijderd: [] };
  const een = renormaliseer(oud);
  assert.deepEqual(sleutels(een), ['juf braaksel']);
  assert.equal(een.watchlist[0].v, NORMALISATIE_VERSIE);
  assert.deepEqual(renormaliseer(een), een);
});

test('versie 1 → 2: "blind date" wordt theatergebonden, via titel en theater', () => {
  assert.equal(NORMALISATIE_VERSIE, 2);
  const v1 = {
    watchlist: [
      { sleutel: 'blind date', titel: 'Blind Date (4+)', theaterId: 'kunstlinie', toegevoegdOp: 7, v: 1 },
      { sleutel: 'titanique', titel: 'Titanique', toegevoegdOp: 0, v: 1 },
    ],
    watchlistVerwijderd: [],
  };
  const v2 = renormaliseer(v1);
  assert.deepEqual(sleutels(v2), ['kunstlinie::blind date', 'titanique']);
  assert.ok(v2.watchlist.every((i) => i.v === 2));
  assert.equal(v2.watchlist[0].toegevoegdOp, 7);
  assert.deepEqual(renormaliseer(v2), v2);
});

test('versie 1 → 2: gemigreerde favoriet zonder theater komt terug mét theater', () => {
  // Zo stond het er in v1 na de migratie: sleutel zonder theater.
  const v1 = { watchlist: [{ sleutel: 'blind date', titel: 'Blind Date', toegevoegdOp: 0, v: 1 }], watchlistVerwijderd: [] };
  const favorieten = ['karavaan::BLIND DATE'];
  const eerste = laadWatchlist({ opgeslagen: v1, favorieten });
  assert.deepEqual(sleutels(eerste.profiel), ['karavaan::blind date']);
  assert.equal(eerste.gewijzigd, true);
  const tweede = laadWatchlist({ opgeslagen: JSON.parse(JSON.stringify(eerste.profiel)), favorieten });
  assert.equal(tweede.gewijzigd, false);
});

test('versie 1 → 2: een bij v1 gemigreerd item krijgt alsnog zijn theater', () => {
  const v1 = { watchlist: [{ sleutel: 'titanique', titel: 'Titanique', toegevoegdOp: 0, v: 1 }], watchlistVerwijderd: [] };
  const r = laadWatchlist({ opgeslagen: v1, favorieten: ['delamar::Titanique'] });
  assert.equal(r.profiel.watchlist[0].theaterId, 'delamar');
  assert.equal(laadWatchlist({ opgeslagen: JSON.parse(JSON.stringify(r.profiel)), favorieten: ['delamar::Titanique'] }).gewijzigd, false);
});

test('bekendeSleutels uit de shows', () => {
  const bekend = bekendeSleutels([
    { titel: 'Nora', theaterId: 'flint' },
    { titel: 'TiTANiQUE de musical', theaterId: 'kunstlinie' },
  ]);
  assert.deepEqual([...bekend.keys()].sort(), ['flint::nora', 'titanique']);
});
