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

  // De Maaspoort en DOK6 (30 sep 2026): sitecategorieën die geen genre zijn
  // (en bij beide ook geen Podiumpas geven, zie hun scrapers), en "Show".
  'uit de regio': 'Overig',
  'uit-de-regio': 'Overig',
  events: 'Overig',
  educatie: 'Overig',
  show: 'Overig',

  // Cpunt (Hoofddorp, 1 okt 2026). "Toneel/Muziektheater" is allebei: Toneel,
  // en de genrestemming op productieniveau kiest bij een ander theater met
  // Muziektheater het specifiekste.
  'cabaret/stand-up/comedy': 'Cabaret',
  'toneel/muziektheater': 'Toneel',
  'kids/jeugd': 'Familie & Jeugd',
  infotainment: 'Overig',

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

  // Corrosia / Kunstlinie (Flevoland-batch)
  'familie & jeugd': 'Familie & Jeugd', // omgekeerde woordvolgorde t.o.v. het al gemapte 'jeugd & familie'
  show: 'Overig',
  urban: 'Overig',
  'zaal x': 'Overig', // Kunstlinie's eigen zaal-/programmastrand-label, geen genre op zich
  'externe programmering': 'Overig', // gastprogrammering, geen genre op zich
  // Zuid-Holland
  danstheater: 'Dans', // Maas theater en dans
  'dans/beweging': 'Dans', // Theater Ins Blau
  opera: 'Muziektheater', // zelfde keuze als 'opera/operette'
  tribute: 'Muziek & Concert', // tributebands (Stadsgehoorzaal)
  'cabaret/kleinkunst': 'Cabaret', // Isala; via de canonieke vorm ook "cabaret & kleinkunst" (Kruispunt)
  'musical / show / variété': 'Musical', // Isala, zoals 'musical/show'
  klassiek: 'Muziek & Concert', // Stoep, Isala
  jazz: 'Muziek & Concert', // Stoep

  // Noord-Brabant (okt 2026; akkoord op debug/noord-brabant-inventarisatie.md §7.8)
  'cabaret & comedy': 'Cabaret', // Parktheater, Markant, Schouwburg Concertzaal
  'musical & muziektheater': 'Musical', // Schouwburg Concertzaal, zoals 'musical/show'
  'circus & variété': 'Overig', // zelfde afweging als 'circus'
  'sta-concert': 'Muziek & Concert', // Markant
  college: 'Overig', // Speelhuis, zoals 'theatercollege'
  'kennis & personality': 'Overig', // Parktheater, zoals 'theatercollege'
  'personality show': 'Overig', // Kattendans, zoals 'show'
  entertainment: 'Overig', // Kattendans
  'toegepast theater': 'Overig', // Kattendans: bedrijfs-/educatief theater, geen genre op zich
  taal: 'Overig', // De Nieuwe Vorst (schrijfavonden, voordrachten)
  'lezing / debat': 'Overig', // De Nieuwe Vorst
  divers: 'Overig', // Speelhuis
  lokaal: 'Overig', // Speelhuis: lokale (amateur)producties, geen genre op zich (zoals 'uit de regio')
  evenement: 'Overig', // Hofnar
  event: 'Overig', // Markant
  carnaval: 'Overig', // Theater aan de Parade
  'echt bosch': 'Overig', // Theater aan de Parade: lokale reeks, geen genre
  spellen: 'Overig', // Parktheater: "Moord in het Parktheater" (interactief spel)

  // Limburg (okt 2026; zie debug/limburg-2-inventarisatie.md)
  'theatercollege en literair': 'Overig', // Vrijthof, zoals 'theatercollege'
  'cabaret & stand-up': 'Cabaret', // PLT
  'toneel & taal': 'Toneel', // PLT
  'klassiek & opera': 'Muziek & Concert', // PLT: opera niet te onderscheiden op de tegel
  'kennis & interactie': 'Overig', // PLT, zoals 'kennis & personality'
  regio: 'Overig', // PLT, zoals 'uit de regio'
  speciaal: 'Overig', // Munttheater, zoals 'special'
  'weert respecteert': 'Overig', // Munttheater: lokale reeks
  verhuring: 'Overig', // De Oranjerie
};

// Samengestelde labels komen in allerlei varianten voor ("jeugd & familie",
// "Familie & jeugd", "jeugd/familie", "Jeugd en familie" bij ITA). In plaats
// van elke variant los op te nemen, zoeken we óók op een canonieke vorm:
// kleine letters, gesplitst op & / , + en " en ", onderdelen gesorteerd.
// Een streepje splitst bewust niet ("hip-hop", "dans-familie").
function canonicalGenreKey(raw) {
  return raw
    .trim()
    .toLowerCase()
    .split(/\s*(?:&|\/|,|\+|\s+en\s+)\s*/)
    .map((part) => part.trim())
    .filter(Boolean)
    .sort()
    .join(' & ');
}
const CANONICAL_GENRE_MAP = new Map(Object.entries(GENRE_MAP).map(([key, value]) => [canonicalGenreKey(key), value]));

function lookupGenre(raw) {
  const key = raw.trim().toLowerCase();
  return GENRE_MAP[key] ?? CANONICAL_GENRE_MAP.get(canonicalGenreKey(raw)) ?? null;
}

/**
 * Zet een ruwe, site-specifieke genre-string om naar één van de vaste
 * GENRE_CATEGORIES. Onbekende labels vallen terug op "Overig" (in plaats
 * van te crashen) zodat een nieuw label op de bronsite de scrape niet breekt.
 */
export function normalizeGenre(raw) {
  if (!raw) return null;
  return lookupGenre(raw) ?? 'Overig';
}

/**
 * Is dit een bekend brongenre (staat het in de mapping)? Voor scrapers die
 * onbekende labels willen melden in plaats van ze stil op "Overig" te zetten.
 */
export function isBekendGenre(raw) {
  return Boolean(raw) && lookupGenre(raw) !== null;
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
    const genre = lookupGenre(raw);
    if (genre) return genre;
  }
  return null;
}
