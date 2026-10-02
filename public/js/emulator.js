// Testmodus voor de end-to-end-tests (npm run test:e2e): de app verbindt dan
// met de Firebase-emulators (Auth en Firestore) op deze computer, project
// demo-podiumagenda. Alleen op localhost/127.0.0.1 én met ?emulator=1 (die
// keuze blijft voor dit tabblad bewaard, zodat hash-links en een geopende
// uitnodigingslink in de testmodus blijven). Op de live site kan dit nooit:
// daar is de hostnaam anders.

export const EMULATOR_PROJECT = 'demo-podiumagenda';
export const EMULATOR_AUTH = 'http://127.0.0.1:9099';
export const EMULATOR_FIRESTORE = { host: '127.0.0.1', port: 8085 };
const LOKAAL = new Set(['localhost', '127.0.0.1']);
const SLEUTEL = 'podiumagenda:emulator';

/** Moet de app met de emulators verbinden? `plek` = location, `opslag` = sessionStorage. */
export function gebruikEmulator(plek, opslag) {
  if (!plek || !LOKAAL.has(plek.hostname)) return false;
  const uitUrl = new URLSearchParams(plek.search ?? '').get('emulator') === '1';
  try {
    if (uitUrl) opslag?.setItem(SLEUTEL, '1');
    return uitUrl || opslag?.getItem(SLEUTEL) === '1';
  } catch {
    return uitUrl;
  }
}
