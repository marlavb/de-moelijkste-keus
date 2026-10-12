// De vaste agenda voor de tests (test-e2e/fixtures/shows.json, gemaakt met
// scripts/e2e-fixture.js): `dagen` → `datum` vanaf vandaag (Amsterdam), zodat
// de tests niet afhangen van de echte public/data/shows.json (die verandert
// elke nacht) en de fixture niet veroudert. Voor de UI-tests in test/ en de
// e2e-tests (test-e2e/hulp.js).

import { readFile } from 'node:fs/promises';
import { vandaag as vandaagAmsterdam } from './datum.js';

const FIXTURE = new URL('../test-e2e/fixtures/shows.json', import.meta.url);

/** De voorstellingen van de vaste agenda, met datums vanaf vandaag. */
export async function vasteShows() {
  const { shows } = JSON.parse(await readFile(FIXTURE, 'utf-8'));
  const basis = Date.parse(`${vandaagAmsterdam()}T12:00:00Z`);
  return shows.map(({ dagen, ...s }) => ({ ...s, datum: new Date(basis + dagen * 86_400_000).toISOString().slice(0, 10) }));
}

/**
 * Voor de lokale testservers: geeft true (en beantwoordt het verzoek) als
 * het om /data/shows.json gaat, met de vaste agenda.
 */
export async function serveerVasteAgenda(pad, res) {
  if (pad !== '/data/shows.json') return false;
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify(await vasteShows()));
  return true;
}
