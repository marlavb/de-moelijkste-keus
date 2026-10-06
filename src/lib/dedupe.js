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
import { isVervallen } from '../../public/js/weergave.js';

/**
 * theaterId|datum|tijd|genormaliseerde titel, met "|vervallen" voor een
 * afgelaste of verplaatste voorstelling: die en een gewone speeldatum op
 * hetzelfde tijdstip (vervangende voorstelling) zijn geen dubbeling.
 */
export function dubbelSleutel(show) {
  const sleutel = [show.theaterId, show.datum, show.tijd ?? '', normalizeTitle(show.titel ?? '')];
  if (isVervallen(show)) sleutel.push('vervallen');
  return sleutel.join('|');
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

/**
 * Dezelfde speeldatum bij twee theaters (okt 2026, Noord-Brabant): de
 * concerten van Willem Twee in de Toonzaal staan ook op de agenda van
 * Theater aan de Parade (Vicky Chow & Mivos Quartet, 8 okt 2026: "Bestel
 * via Willem Twee"), een voorstelling op locatie De Nieuwe Vorst ook bij
 * Schouwburg Concertzaal, en een concert "via Schouwburg Concertzaal" bij
 * Paradox. Eén bron per speeldatum: het eerste theater van elk paar gaat
 * voor; bij het tweede valt een voorstelling met dezelfde datum, tijd en
 * genormaliseerde titel weg. De scrapers filteren dit al zelf (op locatie of
 * knop); dit is het vangnet, zoals na het incident Amstelveen/De Landing.
 */
export const VOORRANG_PAREN = [
  ['willemtwee', 'theateraandeparade'],
  ['denieuwevorst', 'schouwburgconcertzaal'],
  ['schouwburgconcertzaal', 'paradox'],
];

const zelfdeSpeeldatum = (show) => [show.datum, show.tijd ?? '', normalizeTitle(show.titel ?? '')].join('|');

/** Geeft { shows, verwijderd: [{ theaterId, voorrang, titel, datum, tijd }] }. */
export function ontdubbelTussenTheaters(shows, paren = VOORRANG_PAREN) {
  const perTheater = new Map();
  for (const s of shows) {
    if (!perTheater.has(s.theaterId)) perTheater.set(s.theaterId, new Set());
    perTheater.get(s.theaterId).add(zelfdeSpeeldatum(s));
  }
  const verwijderd = [];
  const uit = shows.filter((s) => {
    for (const [voorrang, ander] of paren) {
      if (s.theaterId !== ander) continue;
      if (perTheater.get(voorrang)?.has(zelfdeSpeeldatum(s))) {
        verwijderd.push({ theaterId: s.theaterId, voorrang, titel: s.titel, datum: s.datum, tijd: s.tijd ?? null });
        return false;
      }
    }
    return true;
  });
  return { shows: uit, verwijderd };
}
