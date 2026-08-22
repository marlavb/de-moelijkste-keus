import { chromium } from 'playwright';
import { writeFile, readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

import { THEATERS, USER_AGENT, USER_AGENT_TOKEN } from './lib/config.js';
import { loadRobotsRules } from './lib/robots.js';
import { createPoliteWaiter } from './lib/politeness.js';
import { scrapeDelamar } from './sites/delamar.js';
import { scrapeBellevue } from './sites/bellevue.js';
import { scrapeMeervaart } from './sites/meervaart.js';
import { scrapeIta } from './sites/ita.js';
import { scrapeKleineKomedie } from './sites/kleinekomedie.js';
import { scrapeFrascati } from './sites/frascati.js';
import { scrapeCarre } from './sites/carre.js';

const SCRAPERS = {
  delamar: scrapeDelamar,
  bellevue: scrapeBellevue,
  meervaart: scrapeMeervaart,
  ita: scrapeIta,
  kleinekomedie: scrapeKleineKomedie,
  frascati: scrapeFrascati,
  carre: scrapeCarre,
};

const OUTPUT_PATH = path.resolve('data/shows.json');
// De front-end (public/) is een zelfstandig te serveren map, dus krijgt
// een eigen kopie van de data als static asset.
const PUBLIC_OUTPUT_PATH = path.resolve('public/data/shows.json');

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
  const allShows = [];

  try {
    for (const theater of theaters) {
      const log = (msg) => console.log(`[${theater.id}] ${msg}`);
      log(`start scrape (${theater.agendaUrl})`);

      const robots = await loadRobotsRules(theater.baseUrl, USER_AGENT, USER_AGENT_TOKEN);
      log(`robots.txt gelezen (${robots.robotsUrl}), crawl-delay = ${robots.crawlDelayMs}ms`);

      const waitForTurn = createPoliteWaiter(robots.crawlDelayMs, log);
      const page = await browser.newPage({ userAgent: USER_AGENT });

      const scraper = SCRAPERS[theater.id];
      try {
        const shows = await scraper({ page, theater, robots, waitForTurn, log });
        log(`${shows.length} voorstellingen gevonden`);
        allShows.push(...shows);
      } catch (err) {
        log(`FOUT tijdens scrapen: ${err.message}`);
      } finally {
        await page.close();
      }
    }
  } finally {
    await browser.close();
  }

  const scrapedTheaterIds = new Set(theaters.map((t) => t.id));
  let existingShows = [];
  try {
    existingShows = JSON.parse(await readFile(OUTPUT_PATH, 'utf-8'));
  } catch {
    // Nog geen bestaand bestand — dat is prima bij de eerste run.
  }
  const keptShows = existingShows.filter((s) => !scrapedTheaterIds.has(s.theaterId));
  const mergedShows = [...keptShows, ...allShows];

  const output = JSON.stringify(mergedShows, null, 2) + '\n';
  await mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(OUTPUT_PATH, output, 'utf-8');
  await mkdir(path.dirname(PUBLIC_OUTPUT_PATH), { recursive: true });
  await writeFile(PUBLIC_OUTPUT_PATH, output, 'utf-8');
  console.log(
    `\n${allShows.length} voorstellingen van dit run + ${keptShows.length} eerder opgehaalde = ${mergedShows.length} totaal weggeschreven naar ${OUTPUT_PATH} (en gekopieerd naar ${PUBLIC_OUTPUT_PATH})`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
