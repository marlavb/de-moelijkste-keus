import { chromium } from 'playwright';
import path from 'node:path';
import { writeFile } from 'node:fs/promises';

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
import { buildTheatersJson } from './lib/theatersJson.js';
import { devCacheEnabled, installDevCache } from './lib/devCache.js';
import { scrapeDelamar } from './sites/delamar.js';
import { scrapeBellevue } from './sites/bellevue.js';
import { scrapeMeervaart } from './sites/meervaart.js';
import { scrapeIta } from './sites/ita.js';
import { scrapeKleineKomedie } from './sites/kleinekomedie.js';
import { scrapeFrascati } from './sites/frascati.js';
import { scrapeCarre } from './sites/carre.js';
import { scrapeAmstelveenGroep } from './sites/amstelveen.js';
import { scrapeStadsschouwburgUtrecht } from './sites/stadsschouwburgutrecht.js';
import { scrapeTheaterKikker } from './sites/theaterkikker.js';
import { scrapeKrakeling } from './sites/krakeling.js';
import { scrapeMozaiek } from './sites/mozaiek.js';
import { scrapeMuziekgebouw } from './sites/muziekgebouw.js';
import { scrapeScala } from './sites/scala.js';
import { scrapeOmval } from './sites/omval.js';
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
import { scrapeKruispunt } from './sites/kruispunt.js';
import { scrapeIsala } from './sites/isala.js';
import { scrapeStoep } from './sites/stoep.js';
import { scrapeMaaspoort } from './sites/maaspoort.js';
import { scrapeDok6 } from './sites/dok6.js';
import { scrapeKennemerTheater } from './sites/kennemertheater.js';
import { scrapeCpunt } from './sites/cpunt.js';
import { scrapeKattendans } from './sites/kattendans.js';
import { scrapeParadox } from './sites/paradox.js';
import { scrapeCenakelGroep } from './sites/cenakel.js';
import { scrapeMarkant } from './sites/markant.js';
import { scrapeSpeelhuis } from './sites/speelhuis.js';
import { scrapeSchouwburgConcertzaal } from './sites/schouwburgconcertzaal.js';
import { scrapeWillemTwee } from './sites/willemtwee.js';
import { scrapeTheaterAanDeParade } from './sites/theateraandeparade.js';
import { scrapeDeNieuweVorst } from './sites/denieuwevorst.js';
import { scrapeHofnar } from './sites/hofnar.js';
import { scrapeParktheater } from './sites/parktheater.js';
import { scrapeVrijthofGroep } from './sites/vrijthof.js';
import { scrapePltGroep } from './sites/plt.js';
import { scrapeOranjerie } from './sites/oranjerie.js';
import { scrapeMunttheater } from './sites/munttheater.js';
import { scrapeOrpheus } from './sites/orpheus.js';

const SCRAPERS = {
  delamar: scrapeDelamar,
  bellevue: scrapeBellevue,
  meervaart: scrapeMeervaart,
  ita: scrapeIta,
  kleinekomedie: scrapeKleineKomedie,
  frascati: scrapeFrascati,
  carre: scrapeCarre,
  amstelveen: scrapeAmstelveenGroep,
  stadsschouwburgutrecht: scrapeStadsschouwburgUtrecht,
  theaterkikker: scrapeTheaterKikker,
  krakeling: scrapeKrakeling,
  mozaiek: scrapeMozaiek,
  muziekgebouw: scrapeMuziekgebouw,
  scala: scrapeScala,
  omval: scrapeOmval,
  delanding: scrapeAmstelveenGroep,
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
  kruispunt: scrapeKruispunt,
  isala: scrapeIsala,
  stoep: scrapeStoep,
  maaspoort: scrapeMaaspoort,
  dok6: scrapeDok6,
  kennemertheater: scrapeKennemerTheater,
  cpunt: scrapeCpunt,
  kattendans: scrapeKattendans,
  paradox: scrapeParadox,
  delink: scrapeCenakelGroep,
  smet: scrapeCenakelGroep,
  markant: scrapeMarkant,
  speelhuis: scrapeSpeelhuis,
  schouwburgconcertzaal: scrapeSchouwburgConcertzaal,
  willemtwee: scrapeWillemTwee,
  theateraandeparade: scrapeTheaterAanDeParade,
  denieuwevorst: scrapeDeNieuweVorst,
  hofnar: scrapeHofnar,
  parktheater: scrapeParktheater,
  vrijthof: scrapeVrijthofGroep,
  ainsi: scrapeVrijthofGroep,
  pltheerlen: scrapePltGroep,
  pltkerkrade: scrapePltGroep,
  pltsittard: scrapePltGroep,
  oranjerie: scrapeOranjerie,
  munttheater: scrapeMunttheater,
  orpheus: scrapeOrpheus,
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
// - public/data/theaters.json: per theater naam/stad/podiumpas en, waar
//   nodig, hoe je met de Podiumpas reserveert (uit config.js).
const THEATERS_PATH = path.resolve('public/data/theaters.json');

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

  console.log(`user-agent: ${USER_AGENT}`);
  const useDevCache = devCacheEnabled();
  if (process.env.SCRAPE_CACHE === '1' && !useDevCache) {
    console.log('[devcache] SCRAPE_CACHE=1 genegeerd: in CI wordt nooit uit de cache gelezen.');
  }
  const browser = await chromium.launch();
  try {
    await runRefresh({
      theaters,
      scrapers: SCRAPERS,
      deps: {
        openPage: async () => {
          const page = await browser.newPage({ userAgent: USER_AGENT });
          if (useDevCache) await installDevCache(page, { log: () => {} });
          return page;
        },
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
  await writeFile(THEATERS_PATH, JSON.stringify(buildTheatersJson(THEATERS), null, 2) + '\n', 'utf-8');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
