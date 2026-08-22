// De drie theaters gebruiken elk hun eigen genre-labels. Deze module mapt
// die allemaal naar één vaste, herbruikbare set categorieën waarop de app
// kan filteren. GENRE_CATEGORIES bepaalt ook de vaste volgorde van de
// filter-chips in de UI.
export const GENRE_CATEGORIES = [
  'Toneel',
  'Musical',
  'Cabaret',
  'Muziektheater',
  'Dans',
  'Familie & Jeugd',
  'Muziek & Concert',
  'Overig',
];

const GENRE_MAP = {
  // DeLaMar
  musical: 'Musical',
  toneel: 'Toneel',
  cabaret: 'Cabaret',
  jeugd: 'Familie & Jeugd',
  concert: 'Muziek & Concert',
  muziektheater: 'Muziektheater',
  dans: 'Dans',
  specials: 'Overig',

  // Theater Bellevue
  theater: 'Toneel',
  kleinkunst: 'Cabaret',
  storytelling: 'Toneel',
  'fysiek theater': 'Toneel',
  'theatrale lezing': 'Toneel',
  circustheater: 'Overig',

  // De Meervaart
  familie: 'Familie & Jeugd',
  muziek: 'Muziek & Concert',
  theatercollege: 'Overig',
  special: 'Overig',

  // ITA
  'dans-familie': 'Familie & Jeugd',
  'theater - kind': 'Familie & Jeugd',
  'theater-familie': 'Familie & Jeugd',
  perspectief: 'Overig', // lezingen/theatercolleges — geen van de 8 categorieën past echt
  'events & awards': 'Overig',

  // Frascati
  mime: 'Toneel',
  performance: 'Overig', // brede, interdisciplinaire "performance art"-tag, past nergens goed
  multidisciplinair: 'Overig',

  // De Kleine Komedie
  muzikaal: 'Muziek & Concert',
  'verhalen vertellen': 'Toneel',
  theaterconcert: 'Muziektheater',
  'stand-up': 'Cabaret',
  komedie: 'Cabaret',
  literair: 'Overig', // literaire/boek-gerelateerde programma's, geen echte match
  poëzie: 'Overig',
};

/**
 * Zet een ruwe, site-specifieke genre-string om naar één van de vaste
 * GENRE_CATEGORIES. Onbekende labels vallen terug op "Overig" (in plaats
 * van te crashen) zodat een nieuw label op de bronsite de scrape niet breekt.
 */
export function normalizeGenre(raw) {
  if (!raw) return null;
  const key = raw.trim().toLowerCase();
  return GENRE_MAP[key] ?? 'Overig';
}

/**
 * Voor sites (zoals De Kleine Komedie) die een hele lijst losse tags tonen
 * in plaats van één duidelijk eerste genre-label — veel van die tags zijn
 * geen genre (bv. "PREMIÈRE", "MET GASTEN"). Geeft de eerste tag terug die
 * wél een bekend genre is, of null als geen enkele tag herkend wordt (in
 * plaats van blind "Overig" te concluderen op basis van niet-genre-tags).
 */
export function normalizeGenreFromList(rawTags) {
  if (!rawTags || rawTags.length === 0) return null;
  for (const raw of rawTags) {
    const key = raw.trim().toLowerCase();
    if (GENRE_MAP[key]) return GENRE_MAP[key];
  }
  return null;
}
