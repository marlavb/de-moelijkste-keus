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
  assert.equal(watchlistSleutel('Sara Kroos - Prikkelarme kermis', 'x'), 'prikkelarme kermis | sara kroos');
  assert.notEqual(watchlistSleutel('Sara Kroos – Gelukskoekje', 'x'), watchlistSleutel('Sara Kroos – Prikkelarme kermis', 'x'));
  assert.notEqual(watchlistSleutel('Sara Kroos', 'x'), watchlistSleutel('Sara Kroos – Prikkelarme kermis', 'x'));
  assert.equal(watchlistSleutel('CABARETDUBBEL', 'x'), 'cabaretdubbel');
});

test('vaste titeltest: artiest – voorstelling, scheidingstekens en volgorde (v3)', () => {
  const k = (t) => watchlistSleutel(t, 'x');
  // Scheidingsteken maakt niet uit.
  for (const t of ['Sara Kroos – Prikkelarme kermis', 'Sara Kroos - Prikkelarme kermis', 'Sara Kroos | Prikkelarme kermis', 'Sara Kroos: Prikkelarme kermis', 'SARA KROOS - Prikkelarme Kermis (reprise)']) {
    assert.equal(k(t), 'prikkelarme kermis | sara kroos', t);
  }
  // Volgorde van de delen maakt niet uit; woorden binnen een deel wel.
  assert.equal(k('Grijs – Timzingt'), k('Timzingt – Grijs'));
  assert.notEqual(k('Kermis Prikkelarme – Sara Kroos'), k('Prikkelarme kermis – Sara Kroos'));
  // Ruis gaat over de hele titel, vóór het splitsen.
  assert.equal(k('Juf Braaksel – De Musical (6+)'), 'juf braaksel');
  assert.equal(k('Merijn Scholten – Lemming - reprise'), k('Merijn Scholten – LEMMING'));
  // "&" = "en".
  assert.equal(k('Maartje & Kine – De Bingo Show'), k('Maartje en Kine - De Bingo Show'));
  assert.equal(k('Spruijt & Opperman'), 'spruijt en opperman');
  // Streepjes in een woord splitsen niet.
  assert.equal(k('Try-(H)outen'), 'try h outen');
});

test('vaste titeltest: uitsluitlijst werkt nog; "Cabaret" als titel ≠ genre', () => {
  assert.equal(watchlistSleutel('Nora', 'flint'), 'flint::nora');
  assert.equal(watchlistSleutel('ADEM', 'schuur'), 'schuur::adem');
  assert.equal(watchlistSleutel('Blind Date (4+)', 'kunstlinie'), 'kunstlinie::blind date');
  assert.equal(watchlistSleutel('Cabaret', 'delamar'), 'delamar::cabaret');
  // Een titel met meerdere delen is niet de kale uitgesloten titel.
  assert.equal(watchlistSleutel('Cabaret – De Cabaret Club', 'stoep'), 'cabaret | de cabaret club');
  assert.equal(watchlistSleutel('Nora – Judith Noyons', 'flint'), 'judith noyons | nora');
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
  assert.ok(NORMALISATIE_VERSIE >= 2);
  const v1 = {
    watchlist: [
      { sleutel: 'blind date', titel: 'Blind Date (4+)', theaterId: 'kunstlinie', toegevoegdOp: 7, v: 1 },
      { sleutel: 'titanique', titel: 'Titanique', toegevoegdOp: 0, v: 1 },
    ],
    watchlistVerwijderd: [],
  };
  const v2 = renormaliseer(v1);
  assert.deepEqual(sleutels(v2), ['kunstlinie::blind date', 'titanique']);
  assert.ok(v2.watchlist.every((i) => i.v === NORMALISATIE_VERSIE));
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

// ---------- Titelconventie (v3): mapping oude sleutel → nieuwe ----------

const MAPPING = new Map([
  [
    'sara kroos',
    [
      { sleutel: 'prikkelarme kermis | sara kroos', titel: 'Sara Kroos – Prikkelarme kermis' },
      { sleutel: 'gelukskoekje | sara kroos', titel: 'Sara Kroos – Gelukskoekje' },
    ],
  ],
]);
// Na de omzetting: "Sara Kroos" als losse titel bestaat nergens meer.
const BEKEND_NA = new Map([
  ['prikkelarme kermis | sara kroos', 'Sara Kroos – Prikkelarme kermis'],
  ['gelukskoekje | sara kroos', 'Sara Kroos – Gelukskoekje'],
  ['titanique', 'Titanique'],
]);

test('titelmapping: bladwijzer "sara kroos" (DeLaMar) → beide voorstellingen', () => {
  const opgeslagen = {
    watchlist: [
      { sleutel: 'sara kroos', titel: 'Sara Kroos', theaterId: 'delamar', toegevoegdOp: 100, v: 2 },
      { sleutel: 'titanique', titel: 'Titanique', theaterId: 'flint', toegevoegdOp: 50, v: 2 },
    ],
    watchlistVerwijderd: [],
  };
  const r = laadWatchlist({ opgeslagen, bekend: BEKEND_NA, mapping: MAPPING });
  assert.deepEqual(sleutels(r.profiel), ['gelukskoekje | sara kroos', 'prikkelarme kermis | sara kroos', 'titanique']);
  const pk = r.profiel.watchlist.find((i) => i.sleutel === 'prikkelarme kermis | sara kroos');
  assert.equal(pk.toegevoegdOp, 100);
  assert.equal(pk.titel, 'Sara Kroos – Prikkelarme kermis');
  assert.equal(r.gewijzigd, true);
  // "prikkelarme kermis | sara kroos" is ook de sleutel van Carré, KS en De Stoep na de omzetting.
  for (const t of ['Sara Kroos - Prikkelarme kermis', 'Sara Kroos – Prikkelarme kermis', 'Sara Kroos – Prikkelarme Kermis (reprise)']) {
    assert.equal(watchlistSleutel(t, 'carre'), 'prikkelarme kermis | sara kroos');
  }
  // Twee keer laden schrijft niets.
  const tweede = laadWatchlist({ opgeslagen: JSON.parse(JSON.stringify(r.profiel)), bekend: BEKEND_NA, mapping: MAPPING });
  assert.equal(tweede.gewijzigd, false);
});

test('titelmapping: ook via het oude favorites-veld, en idempotent', () => {
  const r = laadWatchlist({ opgeslagen: null, favorieten: ['delamar::Sara Kroos'], bekend: BEKEND_NA, mapping: MAPPING });
  assert.deepEqual(sleutels(r.profiel), ['gelukskoekje | sara kroos', 'prikkelarme kermis | sara kroos']);
  const tweede = laadWatchlist({ opgeslagen: JSON.parse(JSON.stringify(r.profiel)), favorieten: ['delamar::Sara Kroos'], bekend: BEKEND_NA, mapping: MAPPING });
  assert.equal(tweede.gewijzigd, false);
});

test('titelmapping: item zonder mapping blijft; verwijderd blijft weg', () => {
  // Verwijderd vóór de omzetting (tombstone op de oude sleutel), en de oude favoriet bestaat nog.
  const weg = laadWatchlist({
    opgeslagen: { watchlist: [], watchlistVerwijderd: [{ sleutel: 'sara kroos', verwijderdOp: 200 }] },
    favorieten: ['delamar::Sara Kroos'],
    bekend: BEKEND_NA,
    mapping: MAPPING,
  });
  assert.deepEqual(sleutels(weg.profiel), []);
  // Na de omzetting één van de twee verwijderd: blijft weg, ook met de oude favoriet erbij.
  const eerst = laadWatchlist({ opgeslagen: null, favorieten: ['delamar::Sara Kroos'], bekend: BEKEND_NA, mapping: MAPPING }).profiel;
  const zonder = verwijder(eerst, 'gelukskoekje | sara kroos', 300);
  const daarna = laadWatchlist({ opgeslagen: zonder, favorieten: ['delamar::Sara Kroos'], bekend: BEKEND_NA, mapping: MAPPING });
  assert.deepEqual(sleutels(daarna.profiel), ['prikkelarme kermis | sara kroos']);
  assert.equal(daarna.gewijzigd, false);
});

test('titelmapping: bestaat de oude sleutel nog in de data, dan blijft het oude item ook', () => {
  const bekend = new Map([...BEKEND_NA, ['sara kroos', 'Sara Kroos']]);
  const r = laadWatchlist({
    opgeslagen: { watchlist: [{ sleutel: 'sara kroos', titel: 'Sara Kroos', theaterId: 'delamar', toegevoegdOp: 100, v: 2 }], watchlistVerwijderd: [] },
    bekend,
    mapping: MAPPING,
  });
  assert.deepEqual(sleutels(r.profiel), ['gelukskoekje | sara kroos', 'prikkelarme kermis | sara kroos', 'sara kroos']);
  assert.equal(laadWatchlist({ opgeslagen: JSON.parse(JSON.stringify(r.profiel)), bekend, mapping: MAPPING }).gewijzigd, false);
});

test('vaste titeltest v4: ruis per deel, ook midden in de titel ("Voorstelling – Artiest")', () => {
  const k = (t) => watchlistSleutel(t, 'x');
  assert.equal(k('Keanu Reprise – Henry van Loon'), k('Henry van Loon – Keanu'));
  assert.equal(k('Lemming - reprise – Merijn Scholten'), k('Merijn Scholten – Lemming - reprise'));
  assert.equal(k('CONTROLE 12+ – 155'), k('155 – Controle'));
  assert.equal(k('Try-out: Nothing Beats Reality'), 'nothing beats reality');
  assert.equal(k('Juf Braaksel – De Musical (6+)'), 'juf braaksel');
});

test('her-normaliseren v3 → v4 via de opgeslagen titel, idempotent', () => {
  const v3 = { watchlist: [{ sleutel: 'nothing beats reality | try out', titel: 'Try-out: Nothing Beats Reality', theaterId: 'kunstlinie', toegevoegdOp: 5, v: 3 }], watchlistVerwijderd: [] };
  const v4 = renormaliseer(v3);
  assert.deepEqual(sleutels(v4), ['nothing beats reality']);
  assert.equal(v4.watchlist[0].v, NORMALISATIE_VERSIE);
  assert.deepEqual(renormaliseer(v4), v4);
});

test('Griffioen-omzetting (30 sep 2026): oude bladwijzer krijgt de nieuwe sleutel, idempotent', () => {
  const opgeslagen = {
    watchlist: [{ sleutel: 'kompagnie kistemaker', titel: 'Kompagnie Kistemaker', theaterId: 'griffioen', toegevoegdOp: 5, v: 4 }],
    watchlistVerwijderd: [],
  };
  const bekend = new Map([['buikzwam | kompagnie kistemaker', 'Buikzwam – Kompagnie Kistemaker']]);
  const r = laadWatchlist({ opgeslagen, bekend });
  assert.deepEqual(r.profiel.watchlist.map((i) => i.sleutel), ['buikzwam | kompagnie kistemaker']);
  assert.equal(r.profiel.watchlist[0].toegevoegdOp, 5);
  assert.equal(laadWatchlist({ opgeslagen: JSON.parse(JSON.stringify(r.profiel)), bekend }).gewijzigd, false);
});

// ---------- Stand, maker en genre (okt 2026) ----------

import { vulWatchlistAan, infoPerSleutel } from '../public/js/watchlist.js';
import { watchlistStand } from '../public/js/weergave.js';

const VANDAAG = '2026-10-06';
const d = (datum, beschikbaarheid, extra = {}) => ({ id: `x-${datum}-${beschikbaarheid}`, titel: 'Dekpunt – Jan Beuving', theaterId: 'kleinekomedie', theaterNaam: 'De Kleine Komedie', datum, tijd: '20:15', beschikbaarheid, ...extra });

test('watchlistStand: deels afgelast → "2 van 5 data afgelast", eerstvolgende die doorgaat', () => {
  const st = watchlistStand([d('2026-10-14', 'afgelast'), d('2026-10-15', 'afgelast'), d('2027-01-21', 'beschikbaar'), d('2027-01-22', 'uitverkocht'), d('2027-01-23', 'beschikbaar'), d('2026-09-01', 'afgelast')], VANDAAG);
  assert.equal(st.soort, 'komend');
  assert.equal(st.label, '2 van 5 data afgelast');
  assert.equal(st.soonest.datum, '2027-01-21');
  assert.equal(st.eerste, st.soonest);
});

test('watchlistStand: alles afgelast → "Afgelast", met de eerste afgelaste datum om te openen', () => {
  const st = watchlistStand([d('2027-02-20', 'afgelast'), d('2027-01-10', 'afgelast')], VANDAAG);
  assert.equal(st.soort, 'vervallen');
  assert.equal(st.label, 'Afgelast');
  assert.equal(st.soonest, null);
  assert.equal(st.eerste.datum, '2027-01-10');
  assert.equal(watchlistStand([d('2027-01-10', 'verplaatst')], VANDAAG).label, 'Verplaatst');
  assert.equal(watchlistStand([d('2027-01-10', 'verplaatst'), d('2027-01-11', 'afgelast')], VANDAAG).label, 'Afgelast');
  assert.equal(watchlistStand([d('2027-01-10', 'verplaatst'), d('2027-01-11', 'afgelast'), d('2027-01-12', 'beschikbaar')], VANDAAG).label, '2 van 3 data afgelast of verplaatst');
});

test('watchlistStand: niet meer in de agenda (of alleen voorbije data) → "Niet meer in de agenda"', () => {
  for (const shows of [[], undefined, [d('2026-09-01', 'beschikbaar')]]) {
    const st = watchlistStand(shows, VANDAAG);
    assert.equal(st.soort, 'weg');
    assert.equal(st.label, 'Niet meer in de agenda');
    assert.equal(st.eerste, null);
  }
});

test('watchlistStand: oude data zonder beschikbaarheid telt als gewoon; geen label', () => {
  const st = watchlistStand([{ id: 'a', titel: 'X', theaterId: 't', datum: '2027-01-01' }], VANDAAG);
  assert.equal(st.soort, 'komend');
  assert.equal(st.label, null);
});

test('voegToe bewaart maker en genre (optioneel); verwijderen geeft een tombstone', () => {
  const p = voegToe(legeWatchlist(), { titel: 'Teckel', theaterId: 'bellevue', maker: 'Nina van Tongeren', genre: 'Toneel' }, 5);
  assert.deepEqual(p.watchlist[0], { sleutel: 'teckel', titel: 'Teckel', theaterId: 'bellevue', toegevoegdOp: 5, v: NORMALISATIE_VERSIE, maker: 'Nina van Tongeren', genre: 'Toneel' });
  assert.equal('maker' in voegToe(legeWatchlist(), { titel: 'Teckel', theaterId: 'bellevue' }, 5).watchlist[0], false);
  const weg = verwijder(p, 'teckel', 6);
  assert.deepEqual(weg, { watchlist: [], watchlistVerwijderd: [{ sleutel: 'teckel', verwijderdOp: 6 }] });
});

test('vulWatchlistAan en laadWatchlist met info: oude items zonder maker/genre aangevuld, nooit overschreven, idempotent', () => {
  const oud = { sleutel: 'teckel', titel: 'Teckel', theaterId: 'ssu', toegevoegdOp: 5, v: NORMALISATIE_VERSIE };
  const eigen = { sleutel: 'flint::nora', titel: 'Nora', theaterId: 'flint', toegevoegdOp: 5, v: NORMALISATIE_VERSIE, maker: 'Eigen' };
  const info = infoPerSleutel([
    { titel: 'Teckel', theaterId: 'ssu', maker: 'Nina van Tongeren', genre: 'Toneel' },
    { titel: 'Nora', theaterId: 'flint', maker: 'Anders', genre: 'Toneel' },
  ]);
  const { profiel, gewijzigd } = vulWatchlistAan({ watchlist: [oud], watchlistVerwijderd: [] }, info);
  assert.equal(gewijzigd, true);
  assert.equal(profiel.watchlist[0].maker, 'Nina van Tongeren');
  assert.equal(profiel.watchlist[0].toegevoegdOp, 5);
  assert.equal(vulWatchlistAan(profiel, info).gewijzigd, false);
  const r = laadWatchlist({ opgeslagen: { watchlist: [oud, eigen], watchlistVerwijderd: [] }, info });
  assert.equal(r.gewijzigd, true);
  assert.equal(r.profiel.watchlist.find((i) => i.sleutel === 'teckel').genre, 'Toneel');
  assert.equal(r.profiel.watchlist.find((i) => i.sleutel === 'flint::nora').maker, 'Eigen');
  // Zonder info en zonder nieuwe velden: niets te schrijven.
  assert.equal(laadWatchlist({ opgeslagen: { watchlist: [oud], watchlistVerwijderd: [] } }).gewijzigd, false);
});

test('samenvoegen: maker/genre van een oudere kopie vullen de nieuwere aan; tombstone wint nog steeds', () => {
  const oud = { sleutel: 'teckel', titel: 'Teckel', theaterId: 'ssu', toegevoegdOp: 5, v: NORMALISATIE_VERSIE, maker: 'Nina van Tongeren' };
  const nieuw = { sleutel: 'teckel', titel: 'Teckel', theaterId: 'ssu', toegevoegdOp: 9, v: NORMALISATIE_VERSIE };
  const p = voegSamen({ watchlist: [oud] }, { watchlist: [nieuw] });
  assert.equal(p.watchlist[0].toegevoegdOp, 9);
  assert.equal(p.watchlist[0].maker, 'Nina van Tongeren');
  const weg = voegSamen(p, { watchlist: [], watchlistVerwijderd: [{ sleutel: 'teckel', verwijderdOp: 10 }] });
  assert.equal(weg.watchlist.length, 0);
});

test('Alain Clark → Date Night (okt 2026): watchlist-item migreert, alleen als het vóór de einddatum is toegevoegd', () => {
  const okt = Date.parse('2026-10-05T12:00:00Z');
  const item = { sleutel: 'alain clark', titel: 'Alain Clark', theaterId: 'stoep', toegevoegdOp: okt, v: NORMALISATIE_VERSIE };
  const r = laadWatchlist({ opgeslagen: { watchlist: [item], watchlistVerwijderd: [] }, bekend: new Map([['date night', 'Date Night']]) });
  // Ook naar Griffioens "Date Night – Alain Clark" (al in TITEL_MAPPING sinds 29 sep): liever een bladwijzer te veel.
  assert.deepEqual(r.profiel.watchlist.map((i) => i.sleutel), ['alain clark | date night', 'date night']);
  assert.equal(r.profiel.watchlist[0].toegevoegdOp, okt);
  assert.equal(r.profiel.watchlist[0].theaterId, 'stoep');
  // Idempotent.
  assert.equal(laadWatchlist({ opgeslagen: r.profiel, bekend: new Map([['date night', 'Date Night']]) }).gewijzigd, false);
  // Staat "Alain Clark" nog in de agenda (vóór de nachtrun), dan blijft het oude item er ook.
  const nogBekend = laadWatchlist({ opgeslagen: { watchlist: [item], watchlistVerwijderd: [] }, bekend: new Map([['alain clark', 'Alain Clark']]) });
  assert.deepEqual(nogBekend.profiel.watchlist.map((i) => i.sleutel).sort(), ['alain clark', 'alain clark | date night', 'date night']);
  // Na de einddatum toegevoegd: een andere voorstelling, niet migreren.
  const later = { ...item, toegevoegdOp: Date.parse('2027-02-01T12:00:00Z') };
  const naEind = laadWatchlist({ opgeslagen: { watchlist: [later], watchlistVerwijderd: [] } }).profiel.watchlist.map((i) => i.sleutel);
  assert.equal(naEind.includes('date night'), false);
});

// ---------- Samengevoegde producties (okt 2026) ----------

import { samenvoegMapping, pasSamenvoegingToe, groepeerWatchlist } from '../public/js/watchlist.js';

const samenData = [
  { titel: 'KING ME – Greg Shapiro', titelBron: 'Greg Shapiro', theaterId: 'stadsgehoorzaal' },
  { titel: 'KING ME – Greg Shapiro', titelBron: 'King Me – 250 years of Donald Trump – Greg Shapiro', theaterId: 'kleinekomedie' },
  { titel: 'KING ME – Greg Shapiro', theaterId: 'stoep' },
];

test('samenvoegMapping: oude sleutel → samengevoegde sleutel, alleen eenduidig en niet meer in de data', () => {
  const m = samenvoegMapping(samenData);
  assert.equal(m.get('greg shapiro'), 'greg shapiro | king me');
  assert.equal(m.get('250 years of donald trump | greg shapiro | king me'), 'greg shapiro | king me');
  // Staat de oude sleutel nog in de data, dan niet.
  assert.equal(samenvoegMapping([...samenData, { titel: 'Greg Shapiro', theaterId: 'x' }]).has('greg shapiro'), false);
});

test('Greg Shapiro: drie items (TITEL_MAPPING) worden na het samenvoegen één item; tombstone blijft gelden', () => {
  const t = Date.parse('2026-10-05T12:00:00Z');
  const opgeslagen = { watchlist: [{ sleutel: 'greg shapiro', titel: 'Greg Shapiro', theaterId: 'stadsgehoorzaal', toegevoegdOp: t, v: NORMALISATIE_VERSIE }], watchlistVerwijderd: [] };
  // Vóór het samenvoegen (oude data): de TITEL_MAPPING maakt er drie van.
  const voor = laadWatchlist({ opgeslagen, bekend: new Map([['greg shapiro', 'Greg Shapiro']]) });
  assert.equal(voor.profiel.watchlist.length, 3);
  // Eén regel in Profiel: zelfde toegevoegdOp en theater.
  assert.equal(groepeerWatchlist(voor.profiel.watchlist).length, 1);
  // Na de nachtrun (samengevoegde data): één item.
  const bekend = bekendeSleutels(samenData);
  const na = laadWatchlist({ opgeslagen: voor.profiel, bekend, samenvoeging: samenvoegMapping(samenData) });
  assert.deepEqual(na.profiel.watchlist.map((i) => i.sleutel), ['greg shapiro | king me']);
  assert.equal(laadWatchlist({ opgeslagen: na.profiel, bekend, samenvoeging: samenvoegMapping(samenData) }).gewijzigd, false);
  // Een latere verwijdering op de oude sleutel wint ook na het omzetten.
  const weg = pasSamenvoegingToe({ watchlist: [{ sleutel: 'greg shapiro', titel: 'Greg Shapiro', theaterId: 'x', toegevoegdOp: 1 }], watchlistVerwijderd: [{ sleutel: 'greg shapiro', verwijderdOp: 2 }] }, samenvoegMapping(samenData));
  assert.deepEqual(weg.profiel.watchlist, []);
  assert.deepEqual(weg.profiel.watchlistVerwijderd, [{ sleutel: 'greg shapiro | king me', verwijderdOp: 2 }]);
});

test('groepeerWatchlist: losse items (andere tijd, favoriet zonder tijd) blijven apart', () => {
  const g = groepeerWatchlist([
    { sleutel: 'a', theaterId: 't', toegevoegdOp: 5 },
    { sleutel: 'b', theaterId: 't', toegevoegdOp: 5 },
    { sleutel: 'c', theaterId: 't', toegevoegdOp: 6 },
    { sleutel: 'd', theaterId: 't', toegevoegdOp: 0 },
    { sleutel: 'e', theaterId: 't', toegevoegdOp: 0 },
  ]);
  assert.deepEqual(g.map((x) => x.map((i) => i.sleutel)), [['a', 'b'], ['c'], ['d'], ['e']]);
});

// Labels uit titels (okt 2026, labels-alle-theaters): een item met de oude
// titel komt één keer uit bij de nieuwe; voor "(try out)"/"(voorpremière)",
// waar de sleutel echt verandert, via titelBron (samenvoegMapping).
test('label uit de titel: "Grip (reprise) – Rayen Panday" komt één keer uit bij "Grip – Rayen Panday"', async () => {
  const { labelsUitTitel } = await import('../src/lib/titels.js');
  const oud = 'Grip (reprise) – Rayen Panday';
  const nieuw = labelsUitTitel(oud).tekst;
  assert.equal(nieuw, 'Grip – Rayen Panday');
  const shows = [{ titel: nieuw, titelBron: oud, theaterId: 'kunstlinie' }, { titel: nieuw, theaterId: 'markant' }];
  const opgeslagen = {
    watchlist: [
      { sleutel: watchlistSleutel(oud, 'kunstlinie'), titel: oud, theaterId: 'kunstlinie', toegevoegdOp: 10, v: NORMALISATIE_VERSIE },
      { sleutel: watchlistSleutel(nieuw, 'markant'), titel: nieuw, theaterId: 'markant', toegevoegdOp: 20, v: NORMALISATIE_VERSIE },
    ],
    watchlistVerwijderd: [],
  };
  const { profiel } = laadWatchlist({ opgeslagen, samenvoeging: samenvoegMapping(shows) });
  assert.deepEqual(profiel.watchlist.map((i) => i.sleutel), ['grip | rayen panday']);
  assert.equal(watchlistSleutel(oud), watchlistSleutel(nieuw), 'de sleutel was al gelijk (zonderRuis)');
});

test('label uit de titel waar de sleutel wél verandert ("(try out)"): via titelBron naar de nieuwe sleutel, zonder dubbel', async () => {
  const oud = 'Wagyu (try out) – Rundfunk';
  const nieuw = 'Wagyu – Rundfunk';
  assert.notEqual(watchlistSleutel(oud), watchlistSleutel(nieuw));
  const shows = [{ titel: nieuw, titelBron: oud, theaterId: 'hofnar' }, { titel: nieuw, theaterId: 'griffioen' }];
  const opgeslagen = {
    watchlist: [
      { sleutel: watchlistSleutel(oud), titel: oud, theaterId: 'hofnar', toegevoegdOp: 10, v: NORMALISATIE_VERSIE },
      { sleutel: watchlistSleutel(nieuw), titel: nieuw, theaterId: 'griffioen', toegevoegdOp: 20, v: NORMALISATIE_VERSIE },
    ],
    watchlistVerwijderd: [],
  };
  const eerst = laadWatchlist({ opgeslagen, samenvoeging: samenvoegMapping(shows) });
  assert.deepEqual(eerst.profiel.watchlist.map((i) => i.sleutel), [watchlistSleutel(nieuw)]);
  const tweede = laadWatchlist({ opgeslagen: eerst.profiel, samenvoeging: samenvoegMapping(shows) });
  assert.equal(tweede.gewijzigd, false, 'idempotent');
});

// Reeksnaam uit de titel (titels-ronde-1, R4, 9 okt 2026): het item met de
// oude titel gaat via titelBron mee naar de nieuwe sleutel.
test('reeks uit de titel: "Herfststukjes: Het Koffertje 4+" (watchlist en tombstone) → "Het Koffertje 4+"', () => {
  const data = [{ titel: 'Het Koffertje 4+', titelBron: 'Herfststukjes: Het Koffertje 4+', theaterId: 'theaterkikker' }];
  const oud = watchlistSleutel('Herfststukjes: Het Koffertje 4+', 'theaterkikker');
  const nieuw = watchlistSleutel('Het Koffertje 4+', 'theaterkikker');
  assert.notEqual(oud, nieuw);
  assert.equal(samenvoegMapping(data).get(oud), nieuw);
  const r = pasSamenvoegingToe({ watchlist: [{ sleutel: oud, titel: 'Herfststukjes: Het Koffertje 4+', theaterId: 'theaterkikker', toegevoegdOp: 1 }], watchlistVerwijderd: [] }, samenvoegMapping(data));
  assert.deepEqual(r.profiel.watchlist.map((i) => i.sleutel), [nieuw]);
  assert.equal(pasSamenvoegingToe(r.profiel, samenvoegMapping(data)).gewijzigd, false);
});

// Aliaslijst (titels-ronde-2): een sleutel van na ronde 1 (titelVoorAlias)
// gaat ook mee, naast die van de brontitel.
test('samenvoegMapping: ook via titelVoorAlias', () => {
  const data = [{ titel: 'Dekpunt – Jan Beuving', titelBron: 'Dekpunt (try-out) – Jan Beuving & Tom Dicke', titelVoorAlias: 'Dekpunt – Jan Beuving & Tom Dicke', theaterId: 'flint' }];
  const m = samenvoegMapping(data);
  assert.equal(m.get('dekpunt | jan beuving en tom dicke'), 'dekpunt | jan beuving');
});
