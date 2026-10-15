// Geen voorstelling (12 okt 2026): workshops, cursussen, masterclasses en
// filmvertoningen vallen centraal weg, bij alle theaters, ook in behouden
// data. Een scraper die ze zelf al weglaat (MIMIK, Mozaïek, TAR, Agnietenhof,
// Aan de Slinger) doet dat met zijn eigen regels; dit is het vangnet.
//
// - Workshop: de titel begint met Workshop, Cursus of Masterclass, of met
//   hooguit twee woorden daarvoor ("SoundLAB workshop …", "Ouder-kind
//   workshop …"). "Workshopvoorstelling" blijft (geen los woord).
// - Film: het genre van het theater bestaat alleen uit filmtags ("Film",
//   "film, Familiefilm", "Animatie, Familiefilm", "Drama, film" bij
//   Koningshof, "Film | Jeugd" bij Corrosia). Film als extra tag naast een
//   podiumgenre ("Theater, Dans, Performance, Film" bij Bijlmer Parktheater,
//   "Muziek, Film") blijft (zie PODIUM; sinds 15 okt laat een andere tag
//   zonder podiumgenre, zoals "Special" of "Horror", hem niet meer staan).
// - Duidelijke filmvertoningen op titel (zonder filmgenre bij het theater).
// - Strakker (15 okt 2026, nachtcontrole): ook een samengesteld woord of een
//   meervoud ergens in de titel ("Theaterworkshop 4+", "Danscursus:
//   Beweegredenen", "Kookworkshop", "Danscarrousel verschillende workshops"),
//   en het genre "Workshop" als enige soort ("Cooking Mom" bij TR8;
//   "Sessie/Workshop" bij Paradox blijft). "Workshoporkest" blijft (het woord
//   loopt door). Film: ook met andere tags, zolang geen enkele tag een
//   podiumgenre is ("Horror, film", "Komedie, film, Special" bij Koningshof;
//   "Film, Festival"); "Filmvertoning: …" en "… film:" / "… film (AL)" op
//   titel ("De Club van Sinterklaas film: …" bij Corrosia). Filmmuziek en
//   filmorkesten ("Films live in Concert", "CineMusic Filmorkest") blijven.
// - Quiz (13 okt 2026): een woord in de titel dat op "quiz" eindigt
//   ("Pubquiz", "Musical pubquiz", "Jaarquiz 2026", "Muziekquiz"), niet
//   "Quizmaster" of "quizzen". Uitzonderingen bij twijfel hieronder.

const WORKSHOP = /^(?:[^\s–:]+\s+){0,2}(?:workshop|cursus|masterclass)\b/iu;
// Ergens in de titel een samengesteld woord ("Circusworkshop", "Danscursus")
// of een meervoud ("verschillende workshops"). Het losse woord alleen vooraan
// (WORKSHOP): "Het is een lange weg naar de workshop" blijft.
const WORKSHOP_WOORD = /(^|[^\p{L}])(?:\p{L}+(?:workshops?|cursus(?:sen)?|masterclass(?:es)?)|workshops|cursussen|masterclasses)($|[^\p{L}])/iu;
const WORKSHOPTAGS = new Set(['workshop', 'workshops', 'cursus', 'cursussen', 'masterclass']);
// Wel een voorstelling, ondanks de titel:
// - "Masterclass Igone de Jongh": tournee-avond in de grote zaal, pupillen
//   dansen live met piano (https://theaterdestoep.nl/voorstelling/igone-de-jongh-2627,
//   12 okt 2026; bij DeLaMar als "Igone de Jongh", Dans).
// - "Masterclass REVOLTA": appeltaartmatinee, een inleiding door Annette
//   Embrechts en Tijmen Wehlburg bij de voorstelling REVOLTA (PLT Heerlen,
//   12 okt 2026); een talk, en talks blijven (zoals bij Mozaïek).
const WEL_VOORSTELLING = [/^masterclass igone de jongh\b/i, /^masterclass revolta\b/i];

// Tags die bij een film horen; staat er "film" of "familiefilm" bij en verder
// alleen deze, dan is het een filmvertoning.
const FILMTAGS = new Set(['film', 'films', 'familiefilm', 'jeugdfilm', 'animatie', 'actie', 'arthouse', 'drama', 'komedie', 'documentaire', 'jeugd']);
const FILM = new Set(['film', 'films', 'familiefilm', 'jeugdfilm']);
// Een tag met een podiumgenre: dan is "Film" een extra tag en blijft het een
// voorstelling (Bijlmer Parktheater "Theater, Dans, Performance, Film",
// Hoge Woerd "Muziek, Film").
const PODIUM = /theater|theatre|toneel|dans|ballet|muziek|music|concert|cabaret|comedy|stand-up|musical|opera|klassiek|show|performance|circus|kleinkunst|spoken word|poëzie|jazz|(^|\s)pop($|\s)|voorstelling/i;

const QUIZ = /(^|[^\p{L}])\p{L}*quiz($|[^\p{L}])/iu;
// Wel een voorstelling (of bij twijfel laten staan, 13 okt 2026):
// - "Niet zomaar een Pubquiz – Flunknarf": een reeks van het comedygezelschap
//   Flunknarf, genre Cabaret bij de Stadsschouwburg Utrecht.
// - "Interactieve muziekquiz – De Hitbingo Band": met live band (Griffioen,
//   genre Muziek).
const QUIZ_WEL_VOORSTELLING = [/^niet zomaar een pubquiz\b/i, /^interactieve muziekquiz\b/i];

const FILMTITELS = [
  /^cinekid festival\b/i, /^underground cinema\b/i, /^european outdoor film tour\b/i, /^diner zin in film\b/i,
  /^filmvertoning\b/i,
  // "… film:" of "… film (AL)" als einde van een titeldeel, niet "a film
  // unfolding in space" (Mozaïek) of "Filmmuziek".
  /\bfilm\s*(?::|\s[–|]\s|\((?:al|\d+\+)\)|$)/i,
];

/** 'workshop', 'film', 'quiz' of null. */
export function geenVoorstelling({ titel, genreRuw }) {
  const t = String(titel ?? '').trim();
  const tags = String(genreRuw ?? '').split(/\s*[,|/;]\s*/).map((g) => g.trim().toLowerCase()).filter(Boolean);
  if ((WORKSHOP.test(t) || WORKSHOP_WOORD.test(t) || (tags.length && tags.every((g) => WORKSHOPTAGS.has(g)))) && !WEL_VOORSTELLING.some((r) => r.test(t))) return 'workshop';
  if (tags.some((g) => FILM.has(g)) && (tags.every((g) => FILMTAGS.has(g)) || !tags.some((g) => PODIUM.test(g)))) return 'film';
  if (FILMTITELS.some((r) => r.test(t))) return 'film';
  if (QUIZ.test(t) && !QUIZ_WEL_VOORSTELLING.some((r) => r.test(t))) return 'quiz';
  return null;
}
