// `node scripts/e2e-fixture.js`: maakt test-e2e/fixtures/shows.json, de vaste
// agenda voor de end-to-end-tests (okt 2026; eerder lazen die de echte
// public/data/shows.json en faalden ze als een voorstelling uit een agenda
// verdween). Een selectie uit de huidige data: alle komende voorstellingen
// van een paar theaters, plus alle speeldata van de producties die de tests
// bij naam zoeken (Teckel, Dekpunt – Jan Beuving). In plaats van `datum` staat
// er `dagen` (aantal dagen na de dag van maken): test-e2e/hulp.js zet dat bij
// het laden om naar echte datums vanaf vandaag, zodat de fixture niet veroudert.
// Alleen opnieuw maken als de tests andere data nodig hebben.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { watchlistSleutel } from '../public/js/watchlist.js';
import { vandaag as vandaagAmsterdam } from '../test/datum.js';

const THEATERS = new Set(['stadsschouwburgutrecht', 'carre', 'flint', 'kleinekomedie']);
const PRODUCTIES = new Set(['teckel', 'dekpunt | jan beuving']);
const DAG = 86_400_000;

const vandaag = vandaagAmsterdam();
const alle = JSON.parse(readFileSync('public/data/shows.json', 'utf-8'));
const shows = alle
  .filter((s) => s.datum > vandaag)
  .filter((s) => THEATERS.has(s.theaterId) || PRODUCTIES.has(watchlistSleutel(s.titel, s.theaterId)))
  .map(({ datum, ...s }) => ({ dagen: Math.round((Date.parse(`${datum}T12:00:00Z`) - Date.parse(`${vandaag}T12:00:00Z`)) / DAG), ...s }));
mkdirSync('test-e2e/fixtures', { recursive: true });
writeFileSync('test-e2e/fixtures/shows.json', JSON.stringify({ gemaakt: vandaag, shows }) + '\n');
console.log(`test-e2e/fixtures/shows.json: ${shows.length} voorstellingen van ${new Set(shows.map((s) => s.theaterId)).size} theaters`);
