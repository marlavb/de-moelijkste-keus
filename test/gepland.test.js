// Tests voor Gepland (public/js/gepland.js): sleutel, samenvoegen met
// tijdstempels, koppelen aan de huidige agenda en avondconflicten.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  geplandSleutel,
  planIn,
  zetStatus,
  haalUitPlanning,
  voegGeplandSamen,
  koppel,
  indexeerShows,
  zelfdeAvond,
  komendePlannen,
  laadGepland,
  legeGepland,
} from '../public/js/gepland.js';

const show = {
  id: 'flint-titanique-2027-01-08-2015',
  titel: 'Titanique',
  theaterId: 'flint',
  theaterNaam: 'Flint',
  stad: 'Amersfoort',
  datum: '2027-01-08',
  tijd: '20:15',
  reserverenUrl: 'https://www.flint.nl/x',
};

test('sleutel: theater|datum|tijd|ruim genormaliseerde titel', () => {
  assert.equal(geplandSleutel(show), 'flint|2027-01-08|20:15|titanique');
  assert.equal(geplandSleutel({ ...show, titel: 'TiTANiQUE de musical (try-out)' }), 'flint|2027-01-08|20:15|titanique');
  assert.equal(geplandSleutel({ ...show, tijd: null }), 'flint|2027-01-08||titanique');
});

test('plannen bewaart een momentopname met status gepland', () => {
  const p = planIn(legeGepland(), show, 10);
  assert.deepEqual(p.gepland[0], {
    sleutel: 'flint|2027-01-08|20:15|titanique',
    titel: 'Titanique',
    theaterId: 'flint',
    theaterNaam: 'Flint',
    stad: 'Amersfoort',
    datum: '2027-01-08',
    tijd: '20:15',
    reserverenUrl: 'https://www.flint.nl/x',
    status: 'gepland',
    toegevoegdOp: 10,
    gewijzigdOp: 10,
  });
});

test('status wisselen: gewijzigdOp schuift mee, toegevoegdOp niet', () => {
  let p = planIn(legeGepland(), show, 10);
  p = zetStatus(p, p.gepland[0].sleutel, 'kaarten', 20);
  assert.equal(p.gepland[0].status, 'kaarten');
  assert.equal(p.gepland[0].toegevoegdOp, 10);
  assert.equal(p.gepland[0].gewijzigdOp, 20);
  assert.throws(() => zetStatus(p, p.gepland[0].sleutel, 'misschien', 30));
});

test('samenvoegen: de laatste actie wint', () => {
  const a = planIn(legeGepland(), show, 10);
  const k = a.gepland[0].sleutel;
  const bKaarten = zetStatus(a, k, 'kaarten', 20);
  const aWeg = haalUitPlanning(a, k, 30);
  assert.deepEqual(voegGeplandSamen(bKaarten, aWeg).gepland, []);
  assert.deepEqual(voegGeplandSamen(aWeg, bKaarten).gepland, []);
  // Later opnieuw gepland op B: dan wint B, en de tombstone verdwijnt.
  const bOpnieuw = planIn(bKaarten, show, 40);
  const samen = voegGeplandSamen(aWeg, bOpnieuw);
  assert.equal(samen.gepland.length, 1);
  assert.equal(samen.gepland[0].status, 'gepland');
  assert.deepEqual(samen.geplandVerwijderd, []);
});

test('laden: twee keer laden schrijft niets; lokaal wordt samengevoegd', () => {
  const cloud = planIn(legeGepland(), show, 10);
  const lokaal = planIn(legeGepland(), { ...show, datum: '2027-02-01' }, 15);
  const eerste = laadGepland({ opgeslagen: cloud, extra: lokaal });
  assert.equal(eerste.gewijzigd, true);
  assert.equal(eerste.profiel.gepland.length, 2);
  const tweede = laadGepland({ opgeslagen: JSON.parse(JSON.stringify(eerste.profiel)), extra: lokaal });
  assert.equal(tweede.gewijzigd, false);
});

test('koppelen: exact, tijd gewijzigd, titel gewijzigd, niet meer in de agenda', () => {
  const item = planIn(legeGepland(), show, 1).gepland[0];
  assert.equal(koppel(item, indexeerShows([show])).soort, 'exact');

  const verschoven = { ...show, id: 'v', tijd: '20:30' };
  const r1 = koppel(item, indexeerShows([verschoven]));
  assert.equal(r1.soort, 'tijd');
  assert.equal(r1.show.id, 'v');

  const hernoemd = { ...show, id: 'h', titel: 'Titanique – de musical met Soy Kroon' };
  const r2 = koppel(item, indexeerShows([hernoemd]));
  assert.equal(r2.soort, 'titel');
  assert.equal(r2.show.id, 'h');

  assert.equal(koppel(item, indexeerShows([{ ...show, datum: '2027-01-09' }])).soort, 'weg');
  // Twee kandidaten met dezelfde titel op die dag: niet gokken.
  const twee = [{ ...show, tijd: '14:00' }, { ...show, tijd: '20:30' }];
  assert.equal(koppel(item, indexeerShows(twee)).soort, 'weg');
  // Ander theater telt nooit.
  assert.equal(koppel(item, indexeerShows([{ ...show, theaterId: 'stoep' }])).soort, 'weg');
});

test('zelfde avond: andere plannen op dezelfde dag', () => {
  let p = planIn(legeGepland(), show, 1);
  p = planIn(p, { ...show, theaterId: 'stoep', theaterNaam: 'Theater de Stoep', tijd: '20:00' }, 2);
  p = planIn(p, { ...show, datum: '2027-01-09' }, 3);
  const flint = p.gepland.find((i) => i.theaterId === 'flint' && i.datum === '2027-01-08');
  assert.deepEqual(zelfdeAvond(flint, p.gepland).map((i) => i.theaterId), ['stoep']);
});

test('voorbije plannen blijven bewaard, maar zijn niet komend', () => {
  let p = planIn(legeGepland(), { ...show, datum: '2026-09-01' }, 1);
  p = planIn(p, show, 2);
  assert.equal(p.gepland.length, 2);
  assert.deepEqual(komendePlannen(p.gepland, '2026-09-28').map((i) => i.datum), ['2027-01-08']);
});
