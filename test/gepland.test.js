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

test('titel uitgebreid met de voorstellingsnaam: exact gekoppeld, plan bijgewerkt, idempotent', () => {
  const oud = { ...show, theaterId: 'delamar', theaterNaam: 'DeLaMar', titel: 'Sara Kroos', datum: '2026-12-07', tijd: '20:15' };
  const nieuw = { ...oud, id: 'n', titel: 'Sara Kroos – Prikkelarme Kermis' };
  const plan = planIn(legeGepland(), oud, 10);
  const index = indexeerShows([nieuw, { ...nieuw, id: 'ander', titel: 'Iets anders', tijd: '14:00' }]);
  const r = koppel(plan.gepland[0], index);
  assert.equal(r.soort, 'exact');
  assert.equal(r.show.id, 'n');
  const eerste = laadGepland({ opgeslagen: plan, index });
  assert.equal(eerste.gewijzigd, true);
  assert.equal(eerste.profiel.gepland[0].titel, 'Sara Kroos – Prikkelarme Kermis');
  assert.equal(eerste.profiel.gepland[0].sleutel, 'delamar|2026-12-07|20:15|prikkelarme kermis | sara kroos');
  assert.equal(eerste.profiel.gepland[0].gewijzigdOp, 10);
  const tweede = laadGepland({ opgeslagen: JSON.parse(JSON.stringify(eerste.profiel)), index });
  assert.equal(tweede.gewijzigd, false);
  assert.equal(koppel(tweede.profiel.gepland[0], index).soort, 'exact');
  // Twee kandidaten die allebei de oude delen bevatten: niet gokken.
  const twee = indexeerShows([nieuw, { ...nieuw, id: 'x', titel: 'Sara Kroos – Gelukskoekje' }]);
  assert.equal(koppel(plan.gepland[0], twee).soort, 'weg');
});

test('plan op een titel die is samengevoegd (korter geworden): via titelBron gekoppeld en bijgewerkt', async () => {
  const { koppel, werkPlannenBij, indexeerShows, geplandSleutel } = await import('../public/js/gepland.js');
  const show = { id: 'kk', titel: 'KING ME – Greg Shapiro', titelBron: 'King Me – 250 years of Donald Trump – Greg Shapiro', theaterId: 'kleinekomedie', datum: '2026-11-01', tijd: '20:15' };
  const item = { sleutel: 'oud', titel: 'KING ME – 250 years of Donald Trump – Greg Shapiro', theaterId: 'kleinekomedie', datum: '2026-11-01', tijd: '20:15', status: 'gepland', toegevoegdOp: 1, gewijzigdOp: 1 };
  const index = indexeerShows([show]);
  assert.equal(koppel(item, index).soort, 'exact');
  const r = werkPlannenBij({ gepland: [item], geplandVerwijderd: [] }, index);
  assert.equal(r.profiel.gepland[0].sleutel, geplandSleutel(show));
  assert.equal(r.profiel.gepland[0].titel, 'KING ME – Greg Shapiro');
});
