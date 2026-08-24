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

  // Zaantheater
  'jeugd & familie': 'Familie & Jeugd',
  'theater & toneel': 'Toneel',
  theatershow: 'Toneel',
  'theatercolleges & salons': 'Overig', // zelfde soort lezing/collegevorm als de al gemapte 'theatercollege'
  stadsprogrammering: 'Overig', // gemeentelijk/publieksevenement, geen genre op zich
  'young adult': 'Familie & Jeugd', // Engelse variant van het al gemapte 'jongeren'
  zaantheaterexpositie: 'Overig', // expositie-opening, geen theatervoorstelling maar wel in dezelfde agenda-feed

  // CC Amstel
  circus: 'Overig', // zelfde afweging als 'circustheater'/'nouveau cirque' — circus past niet echt in een van de 8 categorieën
  'muziek(theater)': 'Muziektheater',
  festival: 'Overig',
  'sociaal-artistiek': 'Overig', // gemeenschapskunst/participatietheater, geen genre op zich
  workshop: 'Overig',

  // VU Griffioen
  // ("cabaret" was al gemapt via DeLaMar hierboven — geen nieuwe entry nodig)
  podcast: 'Overig',
  mix: 'Overig', // "gemengd programma"-label, geen genre op zich
  'live journalistiek': 'Overig',

  // Plein Theater (Engelstalige categorieën — Market/Food, kitchen/
  // Workshop, class/Film worden al uitgefilterd vóór normalizeGenre())
  theatre: 'Toneel', // Engelse variant van het al gemapte 'theater'
  'dance performance': 'Dans',
  kids: 'Familie & Jeugd',
  'poetry, reading, literature': 'Overig',
  talk: 'Overig', // lezing/gesprek, geen genre op zich
  'electronic music, party': 'Muziek & Concert',
  'exhibition, art': 'Overig',

  // Schuur
  jeugdtheater: 'Familie & Jeugd',
  'live muziek': 'Muziek & Concert',
  jeugddans: 'Familie & Jeugd', // zelfde afweging als het al gemapte 'dans-familie' (ITA)
  // "Theater in de middag" is bewust NIET gemapt: dat is een tijdslot-label
  // (net als "verhuur"/"language no problem" bij Kikker), geen genre-poging
  // — staat altijd naast een los genre-label in de tag-lijst.

  // Aan de Slinger / Podium Hoge Woerd / Flint (provincie Utrecht-batch)
  film: 'Overig', // filmvertoning, geen theatervoorstelling maar wel in dezelfde agenda-feed
  gastbespeling: 'Overig', // "gastvoorstelling"-label bij Aan de Slinger, geen genre op zich
  'houten presenteert': 'Overig', // lokale gemeente-programmering, geen genre op zich (zelfde afweging als 'stadsprogrammering')
  'no dutch? no problem!': 'Overig', // taal-toegankelijkheidslabel bij Hoge Woerd, geen genre
  talks: 'Overig', // Engelse meervoudsvorm van het al gemapte 'talk'
  theatertour: 'Overig', // rondleiding, geen voorstelling op zich
  verhuur: 'Overig', // zaalverhuur-categorie, komt in de praktijk niet als los agenda-item voor
  verrassing: 'Overig', // mystery-programmering, geen eigen genre
  bijzonder: 'Overig', // Flint's eigen "bijzonder"-label, staat meestal naast een echt genre in de tag-lijst
  'musical & show': 'Musical',
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
