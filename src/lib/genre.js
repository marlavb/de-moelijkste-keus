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

  // Schouwburg Amstelveen
  'te gast': 'Overig', // "gastproductie"-label, geen genre op zich
  'dans/ballet': 'Dans',
  'muziek/concert': 'Muziek & Concert',
  'jeugd/familie': 'Familie & Jeugd',
  'klassieke muziek': 'Muziek & Concert',
  'nouveau cirque': 'Overig', // circus past niet echt in een van de 8 categorieën
  'opera/operette': 'Muziektheater',
  jongeren: 'Familie & Jeugd',
  'musical/show': 'Musical',
  'beeldend theater': 'Toneel',
  'storytelling/literair theater': 'Toneel',

  // Theater Kikker
  'specials & festivals': 'Overig',
  // "language no problem" en "verhuur" zijn bewust NIET gemapt: dat zijn
  // meta-labels (taal-toegankelijkheid resp. zaalverhuur), geen
  // genre-pogingen — normalizeGenreFromList() slaat ze vanzelf over.

  // Scala
  'stand up': 'Cabaret',
  comedy: 'Cabaret',
  'stand-up comedy': 'Cabaret',
  'muzikaal cabaret': 'Cabaret',
  verteltheater: 'Toneel', // zelfde concept als de al gemapte 'verhalen vertellen'/'storytelling'
  'cabareteske ted-talk': 'Overig',
  'magic show': 'Overig', // goochelen past bij geen van de 8 categorieën
  'theatrale escaperoom': 'Overig',
  'sprookjes voor volwassenen': 'Overig',
  sciencefictionkomedie: 'Overig', // theatraal verhaal met sci-fi/komedie-elementen, geen echte match
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
