// Centraal vangnet tegen dubbele voorstellingen, vlak voor het wegschrijven
// van shows.json (zie runRefresh in scrapeRun.js).
//
// Waarom: op 28 sep 2026 stond Muziekgebouw aan 't IJ 30 keer in de data met
// elke voorstelling, omdat de site een andere paginaparameter was gaan
// gebruiken en ?page=N steeds pagina 1 teruggaf. createIdBuilder maakte de
// id's uniek ("-2", "-3", …), dus niemand zag het. Dubbelingen wijzen op
// een kapotte scraper: we halen ze hier weg, maar tellen ze ook, zodat het
// in scrape-status.json en als ::warning:: zichtbaar wordt.

import { normalizeTitle } from '../../public/js/productions.js';

/** theaterId|datum|tijd|genormaliseerde titel */
export function dubbelSleutel(show) {
  return [show.theaterId, show.datum, show.tijd ?? '', normalizeTitle(show.titel ?? '')].join('|');
}

/** Aantal ingevulde velden; "onbekend" als beschikbaarheid telt als leeg. */
export function volledigheid(show) {
  let score = 0;
  for (const [veld, waarde] of Object.entries(show)) {
    if (waarde === null || waarde === undefined || waarde === '') continue;
    if (Array.isArray(waarde) && waarde.length === 0) continue;
    if (veld === 'beschikbaarheid' && waarde === 'onbekend') continue;
    score++;
  }
  return score;
}

/**
 * Houdt per sleutel één voorstelling over: de meest volledige, bij gelijke
 * stand de eerste. Het id van de eerste blijft behouden (dat is het id
 * zonder "-2"-achtervoegsel, dus links en plannen blijven werken). De
 * volgorde van de eerste keer voorkomen blijft staan.
 * Geeft { shows, verwijderdPerTheater } terug.
 */
export function ontdubbelShows(shows) {
  const perSleutel = new Map();
  const verwijderdPerTheater = {};
  for (const show of shows) {
    const sleutel = dubbelSleutel(show);
    const huidig = perSleutel.get(sleutel);
    if (!huidig) {
      perSleutel.set(sleutel, show);
      continue;
    }
    verwijderdPerTheater[show.theaterId] = (verwijderdPerTheater[show.theaterId] ?? 0) + 1;
    if (volledigheid(show) > volledigheid(huidig)) perSleutel.set(sleutel, { ...show, id: huidig.id });
  }
  return { shows: [...perSleutel.values()], verwijderdPerTheater };
}
