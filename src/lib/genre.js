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
