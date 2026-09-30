// Tests voor het genrefilter in de front-end (public/js/genre.js), met
// data zoals genreMeerderheid.js die maakt, en oude data zonder genres.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { pasGenreMeerderheidToe } from '../src/lib/genreMeerderheid.js';
import { getGenres, matchtGenreFilter, getGenreBucket } from '../public/js/genre.js';

let n = 0;
const s = (theaterId, genre, titel = 'SEXODUS') => ({ id: `${theaterId}-${++n}`, theaterId, titel, genre, datum: '2026-11-01', tijd: '20:00' });

test('filter vindt de voorstelling via een tweede genre; label toont het weergavegenre', () => {
  const [show] = pasGenreMeerderheidToe([s('a', 'Toneel'), s('b', 'Toneel'), s('c', 'Dans')]).shows;
  assert.equal(getGenreBucket(show), 'Toneel');
  assert.equal(matchtGenreFilter(show, new Set(['Dans'])), true);
  assert.equal(matchtGenreFilter(show, new Set(['Toneel'])), true);
  assert.equal(matchtGenreFilter(show, new Set(['Musical'])), false);
  assert.equal(matchtGenreFilter(show, new Set()), true);
});

test('oude data zonder genres: terugvallen op genre (null = Overig)', () => {
  assert.deepEqual(getGenres({ genre: 'Dans' }), ['Dans']);
  assert.deepEqual(getGenres({ genre: null }), ['Overig']);
  assert.deepEqual(getGenres({ genre: 'Dans', genres: [] }), ['Dans']);
  assert.equal(matchtGenreFilter({ genre: null }, new Set(['Overig'])), true);
  assert.equal(matchtGenreFilter({ genre: 'Dans' }, new Set(['Toneel'])), false);
});
