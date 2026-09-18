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
