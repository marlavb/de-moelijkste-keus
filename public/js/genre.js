// Sommige shows hebben bewust genre: null (bv. verhuur-only listings zonder
// genre-tag op de bronsite) — zie src/lib/genre.js voor de achtergrond. In de
// data laten we die null staan zodat we kunnen blijven zien welke shows géén
// genre-tag hadden, maar in de front-end (filters, tellingen, weergave)
// behandelen we ze overal samen met "Overig". Elke plek die op show.genre
// matcht voor filtering/telling/weergave hoort deze helper te gebruiken
// i.p.v. rechtstreeks show.genre te lezen.
export function getGenreBucket(show) {
  return show.genre ?? 'Overig';
}

// Alle genres waaronder een voorstelling in het filter hoort (30 sep 2026):
// `genres` (alle echte genres van de productie, zie
// src/lib/genreMeerderheid.js), of bij oudere data zonder dat veld alleen
// de bucket van show.genre.
export function getGenres(show) {
  return Array.isArray(show.genres) && show.genres.length > 0 ? show.genres : [getGenreBucket(show)];
}

/** Genrefilter: geen selectie = alles; anders minstens één genre geselecteerd. */
export function matchtGenreFilter(show, geselecteerd) {
  return geselecteerd.size === 0 || getGenres(show).some((g) => geselecteerd.has(g));
}
