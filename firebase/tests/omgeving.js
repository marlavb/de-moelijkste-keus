// Gedeelde opzet voor de rules-tests: één testomgeving tegen de Firestore-
// emulator (gestart door `firebase emulators:exec`, die FIRESTORE_EMULATOR_HOST
// zet), met de rules uit ../../firestore.rules. Project-id begint met "demo-",
// zodat niets ooit het echte project raakt.

import { readFile } from 'node:fs/promises';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';

export const PROJECT_ID = 'demo-podiumagenda';

export async function maakOmgeving() {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error('Geen emulator: draai deze tests via `npm run test:rules` in de root.');
  }
  const rules = await readFile(new URL('../../firestore.rules', import.meta.url), 'utf8');
  return initializeTestEnvironment({ projectId: PROJECT_ID, firestore: { rules } });
}

/** Firestore als ingelogde gebruiker `uid`, of uitgelogd (uid null). */
export function als(omgeving, uid) {
  return uid ? omgeving.authenticatedContext(uid).firestore() : omgeving.unauthenticatedContext().firestore();
}

/** Data klaarzetten zonder rules (zoals de console of een oude app-versie). */
export async function zonderRules(omgeving, fn) {
  await omgeving.withSecurityRulesDisabled(async (ctx) => fn(ctx.firestore()));
}
