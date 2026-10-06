// De gedeelde run-logica rond de afzonderlijke scrapers: elk theater binnen
// een tijdbudget draaien, bij falen terugvallen op de vorige data van dát
// theater, en het resultaat (shows.json + scrape-status.json) wegschrijven.
// Staat los van Playwright en het bestandssysteem-pad-gedoe in index.js, zodat
// het met nep-scrapers te testen is (zie test/scrapeRun.test.js).

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { ontdubbelShows, dubbelSleutel, ontdubbelTussenTheaters } from './dedupe.js';
import { volgNavigatie, paginaDiagnose } from './diagnose.js';
import { pasMeerderheidToe } from './weergaveMeerderheid.js';
import { pasGenreMeerderheidToe } from './genreMeerderheid.js';
import { pasMakerMeerderheidToe } from './makerMeerderheid.js';
import { metEnDash, zonderStatusWoord, isGeenMaker, makerZonderVoorvoegsel, draaiTitelEnMakerOm } from './titels.js';
import { isVervallen } from './beschikbaarheid.js';
import path from 'node:path';

import { todayIsoDate } from './normalize.js';
import { effectieveCrawlDelayMs } from './politeness.js';

export class ScrapeTimeoutError extends Error {
  name = 'ScrapeTimeoutError';
}

// De site weert ons (bv. een Cloudflare-challenge): de melding gaat zonder
// "exception:"-voorvoegsel naar scrape-status.json.
export class ScrapeBlockedError extends Error {
  name = 'ScrapeBlockedError';
}

// (c)-waarschuwing: een scherpe daling is verdacht (bv. een parser die nog
// maar een deel matcht), maar komt ook legitiem voor (einde seizoen). Dus
// alleen melden, de nieuwe data wordt gewoon gebruikt.
const DROP_WARNING_RATIO = 0.3;
const DROP_WARNING_MIN_PREVIOUS = 20;
// Meer weggehaalde dubbelingen dan dit per theater: ::warning:: (zie dedupe.js).
const DUBBEL_WARNING_MIN = 5;
// Theaters programmeren hooguit ~1,5 jaar vooruit. Een speeldatum verder dan
// dit is vrijwel zeker een parseerfout: Bijlmer Parktheater las in sep 2026
// 30 keer pagina 1, en de jaar-rollover van de datumparser maakte daar
// speeldata tot 2085 van — zonder dat het vangnet voor dubbelingen het zag.
const MAX_JAREN_VOORUIT = 2;
// Aandeel voorstellingen zonder tijd: waarschuwen als dat met minstens 20
// procentpunt stijgt t.o.v. de vorige run (en er genoeg voorstellingen zijn).
// Een theater dat structureel geen tijden geeft (Carré, Karavaan: 100%)
// stijgt niet en waarschuwt dus niet. De Kleine Komedie gaf in sep 2026
// bij 28% van de voorstellingen geen tijd, en dat viel niemand op.
const ZONDER_TIJD_STIJGING = 0.2;
const ZONDER_TIJD_MIN_AANTAL = 10;

function formatSeconds(ms) {
  return `${Math.round(ms / 100) / 10}s`;
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await readFile(file, 'utf-8'));
  } catch {
    return fallback;
  }
}

async function writeJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(value, null, 2) + '\n', 'utf-8');
}

// scrape-status.json wordt mee gepubliceerd: alleen de eerste regel van de
// foutmelding, ingekort — geen Playwright-"Call log", geen stacktrace.
const MAX_FOUT_LENGTH = 200;
function summarizeError(error) {
  const firstLine = String(error?.message ?? error).split('\n')[0].trim();
  return firstLine.length > MAX_FOUT_LENGTH ? `${firstLine.slice(0, MAX_FOUT_LENGTH - 1)}…` : firstLine;
}

function upcomingShowsOf(shows, theaterId, minDate) {
  return shows.filter((s) => s.theaterId === theaterId && s.datum >= minDate);
}

// Aantal unieke voorstellingen (zie dedupe.js). De daling-check kijkt
// hiernaar, niet naar het aantal records: Muziekgebouw leverde twee weken
// 600 records met maar 20 unieke voorstellingen (vorige keer ~360), en
// dat viel niet op omdat het aantal records gelijk bleef (sep 2026).
function uniekAantal(shows) {
  return new Set(shows.map(dubbelSleutel)).size;
}

/**
 * Beslist per theater wat er in de output komt, op basis van wat de scraper
 * deed en wat er vorige keer (na purge) nog aan komende voorstellingen stond.
 *
 * - ok:       scraper gaf voorstellingen terug → die gebruiken we.
 * - leeg:     scraper gaf [] en vorige keer was er ook niets → gewoon leeg.
 * - terugval: exception/timeout, of [] terwijl er vorige keer nog wél
 *             komende voorstellingen waren → de vorige van dit theater.
 * - fout:     exception/timeout zonder vorige data om op terug te vallen.
 */
export function evaluateOutcome({ theaterId, shows, error, previousShows, minDate }) {
  const previous = upcomingShowsOf(previousShows, theaterId, minDate);
  const vorigAantal = uniekAantal(previous);

  if (error) {
    const fout =
      error instanceof ScrapeTimeoutError || error?.name === 'ScrapeBlockedError'
        ? summarizeError(error)
        : `exception: ${summarizeError(error)}`;
    if (vorigAantal > 0) return { status: 'terugval', shows: previous, fout, vorigAantal };
    return { status: 'fout', shows: [], fout, vorigAantal };
  }

  if (shows.length === 0) {
    if (vorigAantal > 0) {
      return {
        status: 'terugval',
        shows: previous,
        fout: `0 resultaten (vorige keer ${vorigAantal} komende voorstellingen)`,
        vorigAantal,
      };
    }
    return { status: 'leeg', shows: [], fout: null, vorigAantal };
  }

  const nieuwAantal = uniekAantal(upcomingShowsOf(shows, theaterId, minDate));
  const waarschuwing =
    vorigAantal >= DROP_WARNING_MIN_PREVIOUS && nieuwAantal < vorigAantal * DROP_WARNING_RATIO
      ? `scherpe daling: ${nieuwAantal} unieke komende voorstellingen, vorige keer ${vorigAantal}`
      : null;
  return { status: 'ok', shows, fout: null, waarschuwing, vorigAantal };
}

/**
 * Draait één scraper met een harde deadline. Een Promise.race alleen zou de
 * scraper op de achtergrond laten doorlopen, dus bij de deadline:
 * - wordt de AbortSignal afgebroken; elke scraper roept vóór elke request
 *   waitForTurn() aan, en die gooit dan (ook midden in een crawl-delay-sleep),
 *   zodat er geen nieuwe request meer vertrekt;
 * - wordt de Playwright-page gesloten, zodat een lopende goto/evaluate meteen
 *   faalt in plaats van tot zijn eigen timeout te blijven hangen;
 * - gaat de run meteen door naar het volgende theater, ook als de scraper
 *   ergens hangt op iets wat geen request is.
 */
async function runWithDeadline({ theater, scraper, deps, budgetMs, log }) {
  const controller = new AbortController();
  const { signal } = controller;
  const timer = setTimeout(
    () => controller.abort(new ScrapeTimeoutError(`timeout na ${formatSeconds(budgetMs)}`)),
    budgetMs
  );
  const aborted = new Promise((_, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  });
  aborted.catch(() => {});
  // Na afloop (of na de deadline) geen gemorste logregels van een scraper die
  // nog aan het afbouwen is tussen die van het volgende theater.
  const scraperLog = (msg) => {
    if (!signal.aborted) log(msg);
  };
  // Waarschuwingen die een scraper zelf signaleert (bv. "uitsluitingslijst
  // van het theater is gewijzigd"): komen in scrape-status.json en als
  // ::warning in de run-samenvatting, zonder dat de scrape faalt.
  const warnings = [];
  const warn = (msg) => {
    if (signal.aborted) return;
    warnings.push(msg);
    log(`WAARSCHUWING: ${msg}`);
  };

  let page;
  let nav = {};
  try {
    page = await deps.openPage();
    nav = volgNavigatie(page);
    const work = (async () => {
      const robots = await deps.loadRobots(theater, signal, scraperLog);
      signal.throwIfAborted();
      scraperLog(`robots.txt gelezen (${robots.robotsUrl}), crawl-delay = ${robots.crawlDelayMs}ms`);
      // Een eigen, ruimere pauze per theater (config.js: crawlDelaySeconden)
      // gaat boven die van robots.txt, nooit eronder (zie politeness.js).
      const delayMs = effectieveCrawlDelayMs(robots.crawlDelayMs, theater.crawlDelaySeconden ?? 0);
      if (delayMs > effectieveCrawlDelayMs(robots.crawlDelayMs)) scraperLog(`eigen crawl-delay ${delayMs}ms (ruimer dan robots.txt)`);
      const waitForTurn = deps.createWaiter(delayMs, scraperLog, signal);
      const shows = await scraper({ page, theater, robots, waitForTurn, log: scraperLog, warn, signal });
      if (!Array.isArray(shows)) throw new Error('scraper gaf geen array terug');
      return shows;
    })();
    work.catch(() => {});
    return { shows: await Promise.race([work, aborted]), warnings };
  } catch (error) {
    // Wat stond er op de pagina? (sanity check gefaald, time-out van een
    // request, …) Niet na de deadline: dan is de pagina al weg.
    if (!signal.aborted && page) {
      const diagnose = await paginaDiagnose(page, nav).catch(() => null);
      if (diagnose) log(diagnose);
    }
    return { error, warnings };
  } finally {
    clearTimeout(timer);
    if (!signal.aborted) controller.abort(new Error('scrape afgerond'));
    await page?.close().catch(() => {});
  }
}

function annotateForGithub(level, title, message) {
  if (process.env.GITHUB_ACTIONS === 'true') console.log(`::${level} title=${title}::${message}`);
}

function latestOpgehaaldOp(shows) {
  return shows.reduce((max, s) => (s.opgehaaldOp && s.opgehaaldOp > max ? s.opgehaaldOp : max), '') || null;
}

/**
 * Draait alle opgegeven theaters, schrijft shows.json (naar elk pad in
 * paths.showsOutputs) en scrape-status.json, en geeft beide terug.
 *
 * paths.previousShows is de laatst gepubliceerde (getrackte) shows.json —
 * die is er in CI na de checkout, in tegenstelling tot data/shows.json.
 */
export async function runRefresh({
  theaters,
  scrapers,
  deps,
  paths,
  budgets,
  minDate = todayIsoDate(),
  now = () => new Date(),
  log = console.log,
  annotate = annotateForGithub,
}) {
  const previousShows = await readJson(paths.previousShows, []);
  const previousStatus = await readJson(paths.status, { theaters: {} });
  const runDeadline = Date.now() + budgets.totalMs;

  const resolvedShows = [];
  const theaterStatus = { ...previousStatus.theaters };

  for (const theater of theaters) {
    const theaterLog = (msg) => log(`[${theater.id}] ${msg}`);
    // Gepauzeerd (config.js, bv. omdat de site ons weert): geen enkele
    // request, geen terugval en geen rode run; de oude voorstellingen
    // vervallen (ze zouden ongemerkt verouderen). Veld weghalen = weer mee.
    if (theater.gepauzeerd) {
      theaterLog(`gepauzeerd sinds ${theater.gepauzeerd.sinds}: ${theater.gepauzeerd.reden} — overgeslagen.`);
      annotate('notice', `Gepauzeerd ${theater.id}`, `sinds ${theater.gepauzeerd.sinds}: ${theater.gepauzeerd.reden}`);
      const vorige = previousStatus.theaters?.[theater.id] ?? {};
      theaterStatus[theater.id] = {
        status: 'gepauzeerd',
        aantal: 0,
        vorigAantal: uniekAantal(upcomingShowsOf(previousShows, theater.id, minDate)),
        duurSeconden: 0,
        laatsteSucces: vorige.laatsteSucces ?? null,
        terugvalSinds: null,
        fout: null,
        waarschuwing: null,
        gepauzeerd: theater.gepauzeerd,
      };
      continue;
    }
    const startedAt = Date.now();
    const remainingMs = runDeadline - startedAt;

    let result;
    if (remainingMs <= 0) {
      theaterLog('niet gestart: totaalbudget van de run is op.');
      result = { error: new ScrapeTimeoutError(`niet gestart: totaalbudget van ${formatSeconds(budgets.totalMs)} op`) };
    } else {
      theaterLog(`start scrape (${theater.agendaUrl})`);
      result = await runWithDeadline({
        theater,
        scraper: scrapers[theater.id],
        deps,
        budgetMs: Math.min(budgets.theaterMs(theater), remainingMs),
        log: theaterLog,
      });
    }
    const duurSeconden = Math.round((Date.now() - startedAt) / 1000);

    const outcome = evaluateOutcome({
      theaterId: theater.id,
      shows: result.shows ?? [],
      error: result.error,
      previousShows,
      minDate,
    });
    resolvedShows.push(...outcome.shows);
    for (const msg of result.warnings ?? []) annotate('warning', `Let op ${theater.id}`, msg);
    const waarschuwing = [outcome.waarschuwing, ...(result.warnings ?? [])].filter(Boolean).join(' | ') || null;

    if (outcome.status === 'ok') {
      theaterLog(`${outcome.shows.length} voorstellingen gevonden (${duurSeconden}s)`);
      if (outcome.waarschuwing) {
        theaterLog(`WAARSCHUWING: ${outcome.waarschuwing}`);
        annotate('warning', `Scherpe daling ${theater.id}`, outcome.waarschuwing);
      }
    } else if (outcome.status === 'leeg') {
      theaterLog(`0 voorstellingen gevonden, vorige keer ook geen — leeg (${duurSeconden}s)`);
    } else if (outcome.status === 'terugval') {
      const msg = `${outcome.fout} — ${outcome.shows.length} voorstellingen van de vorige run behouden`;
      theaterLog(`TERUGVAL: ${msg}`);
      annotate('warning', `Terugval ${theater.id}`, msg);
    } else {
      theaterLog(`FOUT: ${outcome.fout} — geen vorige data om op terug te vallen`);
      annotate('warning', `Scraper gefaald ${theater.id}`, outcome.fout);
    }

    const vorige = previousStatus.theaters?.[theater.id] ?? {};
    const failed = outcome.status === 'terugval' || outcome.status === 'fout';
    theaterStatus[theater.id] = {
      status: outcome.status,
      aantal: outcome.shows.length,
      vorigAantal: outcome.vorigAantal,
      duurSeconden,
      laatsteSucces: failed
        ? (vorige.laatsteSucces ?? latestOpgehaaldOp(outcome.shows))
        : now().toISOString(),
      terugvalSinds: failed ? (vorige.terugvalSinds ?? now().toISOString()) : null,
      fout: outcome.fout,
      waarschuwing,
    };
  }

  // Theaters die deze run niet meededen (--only) houden hun vorige data.
  const scrapedTheaterIds = new Set(theaters.map((t) => t.id));
  const keptShows = previousShows.filter((s) => !scrapedTheaterIds.has(s.theaterId));
  const mergedShows = [...keptShows, ...resolvedShows];

  // Extra laag bovenop de ondergrens in filteredShows() aan de voorkant: een
  // theater dat een verlopen voorstelling zelf niet van hun eigen site haalt
  // (zoals Podium Mozaïek deed voor een tentoonstelling van twee maanden
  // terug) moet niet voor altijd in onze eigen data blijven staan. Geldt ook
  // voor teruggevallen data, zodat die vanzelf slinkt als een scraper
  // wekenlang stuk blijft.
  const uitersteDatum = `${Number(minDate.slice(0, 4)) + MAX_JAREN_VOORUIT}${minDate.slice(4)}`;
  const teVerPerTheater = {};
  const verseShows = mergedShows
    .filter((s) => s.datum >= minDate)
    .filter((s) => {
      if (s.datum <= uitersteDatum) return true;
      teVerPerTheater[s.theaterId] = (teVerPerTheater[s.theaterId] ?? 0) + 1;
      return false;
    })
    // `prijs` en `maker` zijn optionele schemavelden die maar een deel van de
    // theaters vult (prijs: alleen Flint, voor de podiumpas-prijsgrens; maker:
    // alleen theaters met een apart artiest/gezelschap-element) — hier
    // centraal op null gezet voor elke andere show, in plaats van dat elke
    // afzonderlijke scraper-module het zelf moet opnemen.
    // Eén scheidingsteken in titels en makers (" - " → " – ", zie titels.js).
    .map(({ titelBron, genreBron, makerBron, genres, ...s }) => {
      // Behouden voorstellingen van de vorige run: eerst terug naar de
      // brontitel, het brongenre en de bronmaker, zodat ontdubbeling en
      // stemming steeds op de bron werken (genreBron/makerBron kunnen null
      // zijn: "had geen genre/maker").
      if (genreBron !== undefined) s.genre = genreBron;
      if (makerBron !== undefined) s.maker = makerBron;
      // Omgedraaide titel en maker (titels.js, OMGEDRAAID): de scraper doet
      // dit al; hier ook voor behouden data van een theater dat faalde.
      const recht = draaiTitelEnMakerOm({ ...s, titel: titelBron ?? s.titel });
      s.maker = recht.maker;
      const bron = recht.titel;
      // Afgelast/verplaatst: het statuswoord uit de titel, het staat in het label.
      const kaal = isVervallen(s) ? zonderStatusWoord : (t) => t;
      // Nooit maker (titels.js): een content warning, "Met …", een leeftijd of
      // "reprise" gaat naar de beschrijving; "door X" / "o.l.v. X" wordt X.
      let maker = kaal(metEnDash(s.maker ?? null));
      let beschrijving = s.beschrijving ?? null;
      if (maker && isGeenMaker(maker)) {
        beschrijving = beschrijving ?? maker;
        maker = null;
      } else if (maker) {
        maker = makerZonderVoorvoegsel(maker);
      }
      return { ...s, titel: kaal(metEnDash(bron)), prijs: s.prijs ?? null, maker, beschrijving };
    });
  const purgedCount = mergedShows.length - verseShows.length;
  if (purgedCount > 0) {
    log(`${purgedCount} verlopen voorstelling(en) verwijderd (datum vóór ${minDate}).`);
  }

  // Vangnet: dubbelingen (theater, datum, tijd, titel) eruit — ook uit
  // teruggevallen en behouden data — en per theater tellen. Veel dubbelingen
  // betekent een kapotte scraper; dat moet opvallen (zie dedupe.js).
  const { shows: binnenTheater, verwijderdPerTheater } = ontdubbelShows(verseShows);
  // Dezelfde speeldatum bij twee theaters (vaste paren, zie dedupe.js): één bron.
  const { shows: ontdubbeld, verwijderd: tussenTheaters } = ontdubbelTussenTheaters(binnenTheater);
  for (const v of tussenTheaters) log(`[${v.theaterId}] "${v.titel}" ${v.datum} ${v.tijd ?? ''} staat ook bij ${v.voorrang} — daar gelaten.`);
  // Weergavetitel op meerderheid (weergaveMeerderheid.js); brontitel blijft
  // als titelBron.
  const { shows: metWeergave, gewijzigd: titelsOpMeerderheid } = pasMeerderheidToe(ontdubbeld);
  if (titelsOpMeerderheid > 0) log(`${titelsOpMeerderheid} titel(s) naar de weergave van de meeste theaters (titelBron bewaard).`);
  // Genre op productieniveau (genreMeerderheid.js); brongenre als genreBron.
  const { shows: metGenre, gewijzigd: genresOpMeerderheid } = pasGenreMeerderheidToe(metWeergave);
  if (genresOpMeerderheid > 0) log(`${genresOpMeerderheid} voorstelling(en) naar het genre van de productie (genreBron bewaard).`);
  // Maker op productieniveau (makerMeerderheid.js); bronmaker als makerBron.
  const makerConflicten = [];
  const { shows: freshShows, gewijzigd: makersOpMeerderheid } = pasMakerMeerderheidToe(metGenre, { conflicten: makerConflicten });
  if (makersOpMeerderheid > 0) log(`${makersOpMeerderheid} voorstelling(en) naar de maker van de productie (makerBron bewaard).`);
  for (const c of makerConflicten) log(`Maker van "${c.sleutel}" niet gelijkgetrokken (gelijke stand): ${c.theaters.map((t) => `${t.theaterId}: ${t.maker}`).join('; ')}.`);
  for (const theater of theaters) {
    const st = theaterStatus[theater.id];
    if (!st || theater.gepauzeerd) continue;
    st.dubbelingen = verwijderdPerTheater[theater.id] ?? 0;
    st.aantal -= st.dubbelingen;
    // Bij een ander theater gelaten (ontdubbelTussenTheaters): ook niet meetellen.
    const elders = tussenTheaters.filter((v) => v.theaterId === theater.id).length;
    if (elders) {
      st.bijAnderTheater = elders;
      st.aantal -= elders;
    }
  }
  for (const [theaterId, aantal] of Object.entries(verwijderdPerTheater)) {
    log(`[${theaterId}] ${aantal} dubbele voorstelling(en) weggehaald.`);
    if (aantal <= DUBBEL_WARNING_MIN) continue;
    const msg = `${aantal} dubbele voorstellingen weggehaald — de scraper levert dubbelingen, waarschijnlijk stuk`;
    annotate('warning', `Dubbelingen ${theaterId}`, msg);
    const st = theaterStatus[theaterId];
    if (st) st.waarschuwing = [st.waarschuwing, msg].filter(Boolean).join(' | ');
  }

  for (const [theaterId, aantal] of Object.entries(teVerPerTheater)) {
    const msg = `${aantal} voorstelling(en) na ${uitersteDatum} weggehaald — onwaarschijnlijke datum, scraper waarschijnlijk stuk`;
    log(`[${theaterId}] ${msg}`);
    annotate('warning', `Onwaarschijnlijke data ${theaterId}`, msg);
    const st = theaterStatus[theaterId];
    if (st) {
      st.aantal -= aantal;
      st.waarschuwing = [st.waarschuwing, msg].filter(Boolean).join(' | ');
    }
  }

  const vorigeKomend = previousShows.filter((s) => s.datum >= minDate);
  for (const theater of theaters) {
    const st = theaterStatus[theater.id];
    if (!st || theater.gepauzeerd) continue;
    const nu = freshShows.filter((s) => s.theaterId === theater.id);
    const vorig = vorigeKomend.filter((s) => s.theaterId === theater.id);
    st.zonderTijd = nu.filter((s) => !s.tijd).length;
    if (nu.length < ZONDER_TIJD_MIN_AANTAL || vorig.length === 0) continue;
    const aandeelNu = st.zonderTijd / nu.length;
    const aandeelVorig = vorig.filter((s) => !s.tijd).length / vorig.length;
    if (aandeelNu - aandeelVorig < ZONDER_TIJD_STIJGING) continue;
    const pct = (x) => `${Math.round(x * 100)}%`;
    const msg = `${st.zonderTijd} van ${nu.length} voorstellingen zonder tijd (${pct(aandeelNu)}, vorige keer ${pct(aandeelVorig)})`;
    annotate('warning', `Tijden ontbreken ${theater.id}`, msg);
    st.waarschuwing = [st.waarschuwing, msg].filter(Boolean).join(' | ');
  }

  const status = { bijgewerktOp: now().toISOString(), theaters: theaterStatus };
  for (const file of paths.showsOutputs) await writeJson(file, freshShows);
  await writeJson(paths.status, status);

  log(
    `\n${resolvedShows.length} voorstellingen van deze run + ${keptShows.length} eerder opgehaalde = ${freshShows.length} totaal weggeschreven naar ${paths.showsOutputs.join(' en ')}`
  );
  return { shows: freshShows, status };
}
