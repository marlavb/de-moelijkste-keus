// Datums in tests, in Amsterdamse tijd: zo rekent de app ook (todayIsoDate
// in app.js gebruikt de lokale tijd van het toestel; de testbrowsers krijgen
// daarom timezoneId TIJDZONE). Niet new Date().toISOString().slice(0, 10):
// dat is de UTC-datum, en die loopt tussen 00:00 en 02:00 (zomertijd) een dag
// achter. Zo faalde vriendprofiel-ui.test.js op 9 okt 2026 om 00:11.

import { amsterdamDatum } from '../public/js/plannen.js';

export const TIJDZONE = 'Europe/Amsterdam';

/** De datum van vandaag in Amsterdam ('YYYY-MM-DD'), of die op tijdstip `nu` (ms). */
export function vandaag(nu = Date.now()) {
  return amsterdamDatum(nu);
}

/** De Amsterdamse datum `n` dagen na vandaag (negatief: ervoor). */
export function dagenVerder(n, nu = Date.now()) {
  const [j, m, d] = vandaag(nu).split('-').map(Number);
  return new Date(Date.UTC(j, m - 1, d + n)).toISOString().slice(0, 10);
}

const UUR = new Intl.DateTimeFormat('en-GB', { timeZone: TIJDZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

/** Het tijdstip (ms) van `tijd` ('00:30') op `datum` in Amsterdam, in zomer- én wintertijd. */
export function amsterdamTijdstip(datum, tijd) {
  for (const verschil of [2, 1]) {
    const ms = Date.parse(`${datum}T${tijd}:00Z`) - verschil * 3_600_000;
    if (vandaag(ms) === datum && UUR.format(ms) === tijd) return ms;
  }
  throw new Error(`geen Amsterdamse tijd ${datum} ${tijd}`);
}
