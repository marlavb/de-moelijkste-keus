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
//   "Muziek, Film") blijft; ook een onbekende tag ("Special") laat hem staan.
// - Duidelijke filmvertoningen op titel (zonder filmgenre bij het theater).

const WORKSHOP = /^(?:[^\s–:]+\s+){0,2}(?:workshop|cursus|masterclass)\b/iu;
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

const FILMTITELS = [/^cinekid festival\b/i, /^underground cinema\b/i, /^european outdoor film tour\b/i, /^diner zin in film\b/i];

/** 'workshop', 'film' of null. */
export function geenVoorstelling({ titel, genreRuw }) {
  const t = String(titel ?? '').trim();
  if (WORKSHOP.test(t) && !WEL_VOORSTELLING.some((r) => r.test(t))) return 'workshop';
  const tags = String(genreRuw ?? '').split(/\s*[,|/;]\s*/).map((g) => g.trim().toLowerCase()).filter(Boolean);
  if (tags.some((g) => FILM.has(g)) && tags.every((g) => FILMTAGS.has(g))) return 'film';
  if (FILMTITELS.some((r) => r.test(t))) return 'film';
  return null;
}
