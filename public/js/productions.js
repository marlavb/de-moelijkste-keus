// Touring-producties spelen vaak bij meerdere van onze theaters, soms met
// kleine spellingsverschillen in de titel per bronsite (bv. "Aladdin De
// Musical (4+)" vs "Aladdin de Musical (4+)"). Genormaliseerd matchen (geen
// hoofdletters/leestekens/spaties) vangt die varianten, maar loopt risico bij
// korte/generieke titels die toevallig hetzelfde heten terwijl het om
// verschillende producties gaat.
//
// Dit is een aparte groepering van de bestaande "productieSleutel"
// (theaterId + titel, gebruikt voor favorieten en de "andere data"-chips
// BINNEN één theater) — die blijft ongemoeid. Deze module groepeert alleen
// voor de "Ook te zien bij"-sectie op het detailscherm, over theaters heen.
function normalizeTitle(titel) {
  return titel
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

// Genormaliseerde titels die bij handmatige steekproef (bij het bouwen van
// "Ook te zien bij") bleken te gaan om twee of meer duidelijk verschillende
// producties met toevallig dezelfde naam — nooit cross-theater koppelen, ook
// niet als ze verder aan de matchcriteria voldoen.
const EXCLUDED_NORMALIZED_TITLES = new Set([
  // theaterkikker: eigentijdse bewerking van de Griekse mythe. aandeslinger
  // en hogewoerd: Ellen ten Damme & Magpie Orchestra-productie. Twee
  // volledig verschillende stukken.
  'medusa',
  // zaantheater en hogewoerd hebben geen overlappende beschrijvingstekst en
  // een ander genre — te onzeker om te bevestigen dat dit dezelfde productie is.
  'contra',
  // krakeling, zaantheater en bijlmerparktheater: te weinig beschrijvingstekst
  // om te bevestigen, genre wijkt ook af tussen de theaters.
  'diep',
  // krakeling en ccamstel hebben allebei een eigen Peter Pan-achtige
  // bewerking met duidelijk verschillende tekst/invalshoek — geen
  // touring-productie, toevallig dezelfde naam.
  'pan',
]);

/**
 * Groepeert de shows van dezelfde productie bij ANDERE theaters dan die van
 * `show`, per theaterId, gesorteerd op datum/tijd. Geeft een lege Map terug
 * als de titel op de uitsluitlijst staat of nergens anders speelt.
 */
export function getOtherTheaterShows(show, allShows) {
  const key = normalizeTitle(show.titel);
  const byTheater = new Map();
  if (EXCLUDED_NORMALIZED_TITLES.has(key)) return byTheater;

  for (const s of allShows) {
    if (s.theaterId === show.theaterId || normalizeTitle(s.titel) !== key) continue;
    if (!byTheater.has(s.theaterId)) byTheater.set(s.theaterId, []);
    byTheater.get(s.theaterId).push(s);
  }

  for (const list of byTheater.values()) {
    list.sort((a, b) => `${a.datum}T${a.tijd ?? '99:99'}`.localeCompare(`${b.datum}T${b.tijd ?? '99:99'}`));
  }

  return byTheater;
}
