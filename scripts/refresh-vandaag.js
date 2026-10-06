// Controle aan het begin van refresh-data.yml: is de data vandaag
// (Amsterdamse datum) al ververst? Dan stopt de run meteen. Zo geeft de
// start om 05:00 (Cloud Function) plus de cron als vangnet hooguit één
// refresh per dag, ook als GitHub de cron uren later start.
//
// "Vandaag ververst" = bijgewerktOp in public/data/scrape-status.json (op
// main) valt op vandaag. Dat schrijft src/index.js aan het eind van elke
// run, ook als een theater is teruggevallen op zijn vorige data; zo'n dag
// geeft dus geen tweede volledige run langs alle theaters. Handmatig toch
// draaien: workflow_dispatch met forceer = true.
//
// Als script: schrijft al_gedaan=true|false naar $GITHUB_OUTPUT.

import { readFileSync, appendFileSync } from 'node:fs';

const AMSTERDAM = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Amsterdam', year: 'numeric', month: '2-digit', day: '2-digit' });

/** 'YYYY-MM-DD' in Amsterdam. */
export function amsterdamDatum(moment) {
  const d = Object.fromEntries(AMSTERDAM.formatToParts(new Date(moment)).map((p) => [p.type, p.value]));
  return `${d.year}-${d.month}-${d.day}`;
}

/** { alGedaan, reden } */
export function alVandaagVerversd(scrapeStatus, { nu = Date.now(), forceer = false } = {}) {
  if (forceer) return { alGedaan: false, reden: 'forceer staat aan' };
  const op = scrapeStatus?.bijgewerktOp;
  if (!op || Number.isNaN(Date.parse(op))) return { alGedaan: false, reden: 'geen bijgewerktOp in scrape-status.json' };
  const vandaag = amsterdamDatum(nu);
  return amsterdamDatum(op) === vandaag
    ? { alGedaan: true, reden: `de data is vandaag (${vandaag}) al ververst, om ${op}` }
    : { alGedaan: false, reden: `laatst ververst op ${amsterdamDatum(op)}, vandaag is ${vandaag}` };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  let status = null;
  try {
    status = JSON.parse(readFileSync('public/data/scrape-status.json', 'utf-8'));
  } catch {
    // niet te lezen: dan gewoon verversen
  }
  const { alGedaan, reden } = alVandaagVerversd(status, { forceer: process.env.FORCEER === 'true' });
  console.log(alGedaan ? `Overslaan: ${reden}.` : `Verversen: ${reden}.`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `al_gedaan=${alGedaan}\n`);
}
