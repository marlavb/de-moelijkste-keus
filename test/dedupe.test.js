// Tests voor het centrale vangnet tegen dubbele voorstellingen
// (src/lib/dedupe.js), plus een controle op de gepubliceerde shows.json.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { dubbelSleutel, ontdubbelShows, volledigheid } from '../src/lib/dedupe.js';
import { planIn, koppel, indexeerShows, legeGepland } from '../public/js/gepland.js';
import { watchlistSleutel } from '../public/js/watchlist.js';

const basis = {
  id: 'muziekgebouw-menu-de-saison-2026-09-30-2015',
  titel: 'Menu de Saison',
  theaterId: 'muziekgebouw',
  datum: '2026-09-30',
  tijd: '20:15',
  beschikbaarheid: 'beschikbaar',
  beschrijving: 'Calefax',
  maker: null,
};

test('sleutel: theater, datum, tijd en genormaliseerde titel', () => {
  assert.equal(dubbelSleutel(basis), 'muziekgebouw|2026-09-30|20:15|menu de saison');
  assert.equal(dubbelSleutel({ ...basis, titel: 'MENU DE SAISON!' }), dubbelSleutel(basis));
  assert.equal(dubbelSleutel({ ...basis, tijd: null }), 'muziekgebouw|2026-09-30||menu de saison');
});

test('30 kopieën (id -2 … -30) worden er één, met het eerste id', () => {
  const kopieen = Array.from({ length: 30 }, (_, i) => ({ ...basis, id: i === 0 ? basis.id : `${basis.id}-${i + 1}` }));
  const { shows, verwijderdPerTheater } = ontdubbelShows(kopieen);
  assert.equal(shows.length, 1);
  assert.equal(shows[0].id, basis.id);
  assert.deepEqual(verwijderdPerTheater, { muziekgebouw: 29 });
});

test('de meest volledige wint, met het id van de eerste', () => {
  const kaal = { ...basis, beschikbaarheid: 'onbekend', beschrijving: null };
  const vol = { ...basis, id: `${basis.id}-2`, maker: 'Calefax' };
  const { shows } = ontdubbelShows([kaal, vol]);
  assert.equal(shows.length, 1);
  assert.equal(shows[0].id, basis.id);
  assert.equal(shows[0].maker, 'Calefax');
  assert.equal(shows[0].beschikbaarheid, 'beschikbaar');
  // Gelijke stand: de eerste blijft.
  const a = { ...basis, reserverenUrl: 'a' };
  const b = { ...basis, id: 'x', reserverenUrl: 'b' };
  assert.equal(ontdubbelShows([a, b]).shows[0].reserverenUrl, 'a');
});

test('volledigheid telt "onbekend" en lege waarden niet mee', () => {
  assert.ok(volledigheid(basis) > volledigheid({ ...basis, beschikbaarheid: 'onbekend' }));
  assert.equal(volledigheid({ a: null, b: '', c: [], d: 'x' }), 1);
});

test('wat verschilt, blijft staan: ander theater, andere tijd, andere titel', () => {
  const lijst = [
    basis,
    { ...basis, id: 'b', theaterId: 'bimhuis' },
    { ...basis, id: 'c', tijd: '14:00' },
    { ...basis, id: 'd', titel: 'Menu de Saison II' },
  ];
  const { shows, verwijderdPerTheater } = ontdubbelShows(lijst);
  assert.equal(shows.length, 4);
  assert.deepEqual(verwijderdPerTheater, {});
});

test('volgorde van eerste voorkomen blijft staan', () => {
  const a = { ...basis, id: 'a', titel: 'A' };
  const b = { ...basis, id: 'b', titel: 'B' };
  const { shows } = ontdubbelShows([a, b, { ...a, id: 'a-2' }]);
  assert.deepEqual(shows.map((s) => s.id), ['a', 'b']);
});

test('gepland en watchlist koppelen na het ontdubbelen nog exact', () => {
  const kopieen = Array.from({ length: 30 }, (_, i) => ({ ...basis, id: i ? `${basis.id}-${i + 1}` : basis.id }));
  // Gepland op een van de kopieën (bv. de 17e), vóór de reparatie.
  const plan = planIn(legeGepland(), kopieen[16], 1).gepland[0];
  const { shows } = ontdubbelShows(kopieen);
  const r = koppel(plan, indexeerShows(shows));
  assert.equal(r.soort, 'exact');
  assert.equal(r.show.id, basis.id);
  assert.equal(watchlistSleutel(shows[0].titel, shows[0].theaterId), watchlistSleutel(kopieen[16].titel, kopieen[16].theaterId));
});

test('gepubliceerde shows.json bevat geen dubbelingen', () => {
  const shows = JSON.parse(readFileSync(new URL('../public/data/shows.json', import.meta.url), 'utf-8'));
  const { verwijderdPerTheater } = ontdubbelShows(shows);
  assert.deepEqual(verwijderdPerTheater, {}, `dubbelingen in shows.json: ${JSON.stringify(verwijderdPerTheater)}`);
});

test('afgelast en gewoon op hetzelfde tijdstip: geen dubbeling, plan koppelt aan de gewone', () => {
  const afgelast = { ...basis, id: `${basis.id}-2`, beschikbaarheid: 'afgelast' };
  assert.notEqual(dubbelSleutel(afgelast), dubbelSleutel(basis));
  const { shows, verwijderdPerTheater } = ontdubbelShows([afgelast, basis]);
  assert.equal(shows.length, 2);
  assert.deepEqual(verwijderdPerTheater, {});
  // Twee afgelaste kopieën zijn wél een dubbeling.
  assert.equal(ontdubbelShows([afgelast, { ...afgelast, id: 'x' }]).shows.length, 1);

  const plan = planIn(legeGepland(), { ...basis, theaterNaam: 'Muziekgebouw' }).gepland[0];
  assert.equal(koppel(plan, indexeerShows([afgelast, basis])).show, basis);
  assert.equal(koppel(plan, indexeerShows([afgelast])).show, afgelast);
  assert.equal(koppel(plan, indexeerShows([afgelast])).soort, 'exact');
});
