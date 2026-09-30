// Tests voor het genre op productieniveau (src/lib/genreMeerderheid.js).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { pasGenreMeerderheidToe, kiesGenre, SPECIFIEK_NAAR_BREED } from '../src/lib/genreMeerderheid.js';
import { GENRE_CATEGORIES } from '../src/lib/genre.js';

let n = 0;
const s = (theaterId, genre, titel = 'SEXODUS') => ({ id: `${theaterId}-${++n}`, theaterId, titel, genre, datum: '2026-11-01', tijd: '20:00' });

test('overig en leeg nemen het ene echte genre over; genreBron bewaard (ook null)', () => {
  const { shows, gewijzigd } = pasGenreMeerderheidToe([s('kunstlinie', 'Muziektheater'), s('ssu', 'Muziektheater'), s('frascati', 'Overig'), s('x', null)]);
  assert.deepEqual(shows.map((x) => x.genre), Array(4).fill('Muziektheater'));
  assert.equal(shows[2].genreBron, 'Overig');
  assert.equal(shows[3].genreBron, null);
  assert.ok('genreBron' in shows[3]);
  assert.equal('genreBron' in shows[0], false);
  assert.deepEqual(shows[2].genres, ['Muziektheater']);
  assert.equal(gewijzigd, 2);
});

test('alleen overig/leeg: blijft zo, geen genres-veld', () => {
  const { shows, gewijzigd } = pasGenreMeerderheidToe([s('a', 'Overig'), s('b', null)]);
  assert.equal(gewijzigd, 0);
  assert.equal(shows[0].genre, 'Overig');
  assert.equal(shows[1].genre, null);
  assert.equal(shows[0].genres, undefined);
});

test('conflict: meerderheid van de theaters wint; genres zonder Overig, in vaste volgorde', () => {
  const { shows } = pasGenreMeerderheidToe([s('a', 'Toneel'), s('b', 'Toneel'), s('c', 'Dans'), s('d', 'Overig')]);
  assert.deepEqual(shows.map((x) => x.genre), Array(4).fill('Toneel'));
  assert.deepEqual(shows[0].genres, ['Toneel', 'Dans']);
  assert.equal(shows[2].genreBron, 'Dans');
  // Eén stem per theater: tien speeldata bij één theater tellen als één.
  const veel = Array.from({ length: 10 }, () => s('a', 'Dans'));
  assert.equal(pasGenreMeerderheidToe([...veel, s('b', 'Toneel'), s('c', 'Toneel')]).shows[0].genre, 'Toneel');
});

test('gelijke stand: specifiekste genre, onafhankelijk van de volgorde', () => {
  assert.deepEqual(SPECIFIEK_NAAR_BREED.slice().sort(), GENRE_CATEGORIES.filter((g) => g !== 'Overig').sort());
  assert.equal(kiesGenre(['Toneel', 'Cabaret']).genre, 'Cabaret');
  assert.equal(kiesGenre(['Cabaret', 'Toneel']).genre, 'Cabaret');
  assert.equal(kiesGenre(['Muziektheater', 'Musical']).genre, 'Musical');
  assert.equal(kiesGenre(['Muziek & Concert', 'Muziektheater']).reden, 'gelijk: specifiekste');
  assert.equal(kiesGenre(['Muziek & Concert', 'Muziektheater']).genre, 'Muziektheater');
  assert.equal(kiesGenre([]), null);
});

test('idempotent: terug naar genreBron en opnieuw toepassen geeft hetzelfde', () => {
  const invoer = [s('a', 'Toneel'), s('b', 'Cabaret'), s('c', 'Cabaret'), s('d', null)];
  const { shows } = pasGenreMeerderheidToe(invoer);
  const terug = shows.map(({ genreBron, genres, ...x }) => (genreBron !== undefined ? { ...x, genre: genreBron } : x));
  assert.deepEqual(terug, invoer);
  assert.deepEqual(pasGenreMeerderheidToe(terug).shows, shows);
});

test('theatergebonden titel (uitsluitlijst) doet niet mee', () => {
  const { gewijzigd } = pasGenreMeerderheidToe([s('ita', 'Toneel', 'Nora'), s('delamar', 'Musical', 'Nora'), s('x', null, 'Nora')]);
  assert.equal(gewijzigd, 0);
});
