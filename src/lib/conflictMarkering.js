// Conflictmarkeringen in een bestand (pre-commit-check, scripts/precommit.js).
// <<<<<<< en >>>>>>> aan het begin van een regel tellen altijd; een losse
// ======= ook, behalve in Markdown, waar dat een kop-onderstreping kan zijn
// (daar alleen samen met <<<<<<< of >>>>>>>).

const BUITEN = /^(<{7}|>{7})(\s|$)/;
const MIDDEN = /^={7}$/;

/** Eerste regel met een markering ({ regel, tekst }), of null. */
export function vindMarkering(inhoud, bestand = '') {
  const regels = String(inhoud).split('\n').map((r) => r.replace(/\r$/, ''));
  const md = /\.md$/i.test(bestand);
  const heeftBuiten = regels.some((r) => BUITEN.test(r));
  const n = regels.findIndex((r) => BUITEN.test(r) || (MIDDEN.test(r) && (!md || heeftBuiten)));
  return n < 0 ? null : { regel: n + 1, tekst: regels[n] };
}
