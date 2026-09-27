import { chromium } from 'playwright';
import path from 'node:path';

import {
  THEATERS,
  USER_AGENT,
  USER_AGENT_TOKEN,
  DEFAULT_THEATER_BUDGET_MINUTEN,
  RUN_BUDGET_MINUTEN,
} from './lib/config.js';
import { loadRobotsRules } from './lib/robots.js';
import { createPoliteWaiter } from './lib/politeness.js';
import { runRefresh } from './lib/scrapeRun.js';
import { scrapeDelamar } from './sites/delamar.js';
import { scrapeBellevue } from './sites/bellevue.js';
import { scrapeMeervaart } from './sites/meervaart.js';
import { scrapeIta } from './sites/ita.js';
import { scrapeKleineKomedie } from './sites/kleinekomedie.js';
import { scrapeFrascati } from './sites/frascati.js';
import { scrapeCarre } from './sites/carre.js';
import { scrapeAmstelveen } from './sites/amstelveen.js';
import { scrapeStadsschouwburgUtrecht } from './sites/stadsschouwburgutrecht.js';
import { scrapeTheaterKikker } from './sites/theaterkikker.js';
import { scrapeKrakeling } from './sites/krakeling.js';
import { scrapeMozaiek } from './sites/mozaiek.js';
import { scrapeMuziekgebouw } from './sites/muziekgebouw.js';
import { scrapeScala } from './sites/scala.js';
import { scrapeOmval } from './sites/omval.js';
import { scrapeDeLanding } from './sites/delanding.js';
import { scrapeZaantheater } from './sites/zaantheater.js';
import { scrapeBijlmerParktheater } from './sites/bijlmerparktheater.js';
import { scrapeCcAmstel } from './sites/ccamstel.js';
import { scrapeMarionettentheater } from './sites/marionettentheater.js';
import { scrapeGriffioen } from './sites/griffioen.js';
import { scrapePleinTheater } from './sites/pleintheater.js';
import { scrapeKaravaan } from './sites/karavaan.js';
import { scrapeSchuur } from './sites/schuur.js';
import { scrapeBostheater } from './sites/bostheater.js';
import { scrapeHogeWoerd } from './sites/hogewoerd.js';
import { scrapeFlint } from './sites/flint.js';
import { scrapeAanDeSlinger } from './sites/aandeslinger.js';
import { scrapeCorrosia } from './sites/corrosia.js';
import { scrapeKunstlinie } from './sites/kunstlinie.js';
import { scrapeHnt } from './sites/hnt.js';
import { scrapeTheaterRotterdam } from './sites/theaterrotterdam.js';
import { scrapeKoningshof } from './sites/koningshof.js';
import { scrapeMaas } from './sites/maas.js';
import { scrapeInsBlau } from './sites/insblau.js';
import { scrapeStadsgehoorzaal } from './sites/stadsgehoorzaal.js';

const SCRAPERS = {
  delamar: scrapeDelamar,
  bellevue: scrapeBellevue,
  meervaart: scrapeMeervaart,
  ita: scrapeIta,
  kleinekomedie: scrapeKleineKomedie,
  frascati: scrapeFrascati,
  carre: scrapeCarre,
  amstelveen: scrapeAmstelveen,
  stadsschouwburgutrecht: scrapeStadsschouwburgUtrecht,
  theaterkikker: scrapeTheaterKikker,
  krakeling: scrapeKrakeling,
  mozaiek: scrapeMozaiek,
  muziekgebouw: scrapeMuziekgebouw,
  scala: scrapeScala,
  omval: scrapeOmval,
  delanding: scrapeDeLanding,
  zaantheater: scrapeZaantheater,
  bijlmerparktheater: scrapeBijlmerParktheater,
  ccamstel: scrapeCcAmstel,
  marionettentheater: scrapeMarionettentheater,
  griffioen: scrapeGriffioen,
  pleintheater: scrapePleinTheater,
  karavaan: scrapeKaravaan,
  schuur: scrapeSchuur,
  bostheater: scrapeBostheater,
  hogewoerd: scrapeHogeWoerd,
  flint: scrapeFlint,
  aandeslinger: scrapeAanDeSlinger,
  corrosia: scrapeCorrosia,
  kunstlinie: scrapeKunstlinie,
  koninklijkeschouwburg: scrapeHnt,
  theateraanhetspui: scrapeHnt,
  zaal3: scrapeHnt,
  tr25: scrapeTheaterRotterdam,
  tr8: scrapeTheaterRotterdam,
  koningshof: scrapeKoningshof,
  maas: scrapeMaas,
  insblau: scrapeInsBlau,
  stadsgehoorzaal: scrapeStadsgehoorzaal,
};

// Welk bestand waarvoor dient:
// - public/data/shows.json is de getrackte, gepubliceerde data. De workflow
//   commit 'm, dus hij staat na elke checkout klaar — ook in CI. Dit is dus
//   de "vorige run" waar het vangnet op terugvalt en waar --only-runs de
//   niet-gescrapete theaters uit halen.
// - data/shows.json is alleen een lokale, ge-gitignorede kopie van dezelfde
//   output (handig om te inspecteren zonder public/ aan te raken). Er wordt
//   nooit meer uit gelezen.
// - public/data/scrape-status.json: per theater de uitkomst van de laatste
//   run (ok/leeg/terugval/fout), duur en laatste succesvolle scrape.
const PUBLIC_SHOWS_PATH = path.resolve('public/data/shows.json');
const LOCAL_SHOWS_PATH = path.resolve('data/shows.json');
const STATUS_PATH = path.resolve('public/data/scrape-status.json');

function parseArgs(argv) {
  const only = argv.find((a) => a.startsWith('--only='))?.split('=')[1];
  return { only: only ? only.split(',') : null };
}

async function main() {
  const { only } = parseArgs(process.argv.slice(2));
  const theaters = only ? THEATERS.filter((t) => only.includes(t.id)) : THEATERS;

  if (theaters.length === 0) {
    console.error(`Geen theater gevonden voor --only=${only?.join(',')}`);
    process.exit(1);
  }

  const browser = await chromium.launch();
  try {
    await runRefresh({
      theaters,
      scrapers: SCRAPERS,
      deps: {
        openPage: () => browser.newPage({ userAgent: USER_AGENT }),
        loadRobots: (theater, signal, log) =>
          loadRobotsRules(theater.baseUrl, USER_AGENT, USER_AGENT_TOKEN, { signal, log }),
        createWaiter: createPoliteWaiter,
      },
      paths: {
        previousShows: PUBLIC_SHOWS_PATH,
        showsOutputs: [LOCAL_SHOWS_PATH, PUBLIC_SHOWS_PATH],
        status: STATUS_PATH,
      },
      budgets: {
        theaterMs: (theater) => (theater.budgetMinuten ?? DEFAULT_THEATER_BUDGET_MINUTEN) * 60_000,
        totalMs: RUN_BUDGET_MINUTEN * 60_000,
      },
    });
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
