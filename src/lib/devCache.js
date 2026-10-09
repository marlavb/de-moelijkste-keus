// Lokale HTML-cache voor tijdens het bouwen, zodat testruns niet steeds de
// echte site raken (werkafspraak in CLAUDE.md). Alleen aan met
// SCRAPE_CACHE=1, en nooit in CI: daar negeren we de vlag.
//
// Werking: voor elke pagina-navigatie (resourceType "document") kijken we in
// debug/cache/<host>/<hash>.html. Is die er en jonger dan een dag, dan krijgt
// de browser die HTML; anders halen we de pagina één keer echt op en slaan we
// hem op. Scripts, XHR en afbeeldingen gaan gewoon naar de site (een pagina
// die zijn agenda via JS laadt, raakt de site dus nog wel).

import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

const MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** Aan alleen met SCRAPE_CACHE=1 én niet in CI (CI of GITHUB_ACTIONS gezet). */
export function devCacheEnabled(env = process.env) {
  const requested = env.SCRAPE_CACHE === '1';
  const inCi = env.CI === 'true' || env.GITHUB_ACTIONS === 'true';
  return requested && !inCi;
}

export function cacheFileFor(dir, url) {
  const u = new URL(url);
  const hash = createHash('sha1').update(u.toString()).digest('hex').slice(0, 16);
  return path.join(dir, u.hostname, `${hash}.html`);
}

// Met SCRAPE_OFFLINE=1 (naast SCRAPE_CACHE=1) gaat een pagina die niet in de
// cache staat niet naar de site maar wordt afgebroken: een herhaalde lokale
// run doet dan gegarandeerd geen echte verzoeken (7 okt 2026: een tweede
// Schaffelaar-run haalde de pagina's achter de grens per run echt op).
export async function installDevCache(page, { dir = path.resolve('debug/cache'), log = console.log, now = Date.now, offline = process.env.SCRAPE_OFFLINE === '1' } = {}) {
  let hits = 0;
  let misses = 0;
  await page.route('**/*', async (route) => {
    const request = route.request();
    // Alleen navigaties van de pagina zelf; iframes (bv. een YouTube-embed)
    // en al het andere gaan gewoon door.
    const hoofdpagina =
      request.resourceType() === 'document' && request.isNavigationRequest() && request.frame() === page.mainFrame();
    if (!hoofdpagina || request.method() !== 'GET') return route.continue().catch(() => {});
    const file = cacheFileFor(dir, request.url());
    try {
      const info = await stat(file);
      if (now() - info.mtimeMs < MAX_AGE_MS) {
        hits++;
        return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: await readFile(file, 'utf-8') });
      }
    } catch {
      // niet in de cache
    }
    misses++;
    if (offline) return route.abort('internetdisconnected').catch(() => {});
    try {
      const response = await route.fetch();
      const body = await response.text();
      if (response.ok()) {
        await mkdir(path.dirname(file), { recursive: true });
        await writeFile(file, body, 'utf-8');
      }
      return await route.fulfill({ response, body });
    } catch {
      // Pagina of browser al dicht (einde van een run): niets meer te doen.
      return route.abort().catch(() => {});
    }
  });
  log(`[devcache] aan (${dir}); pagina's uit de cache worden niet opnieuw opgehaald${offline ? '; offline: niets nieuws ophalen' : ''}`);
  return { stats: () => ({ hits, misses }) };
}

/**
 * Dezelfde lokale cache voor verzoeken die geen paginanavigatie zijn (een
 * POST naar een API via page.request, bv. Zwolse Theaters): die gaan niet
 * door page.route en dus niet door installDevCache. `sleutel` is de URL plus
 * eventueel de body. Zonder SCRAPE_CACHE=1 (of in CI) gewoon `ophalen()`.
 * Met SCRAPE_OFFLINE=1 en niets in de cache: een fout, geen verzoek
 * (9 okt 2026: een "offline" run deed zo toch 39 API-verzoeken).
 */
export async function metDevCache(url, sleutel, ophalen, { dir = path.resolve('debug/cache'), env = process.env, now = Date.now } = {}) {
  if (!devCacheEnabled(env)) return ophalen();
  const u = new URL(url);
  const hash = createHash('sha1').update(`${u.toString()}\n${sleutel ?? ''}`).digest('hex').slice(0, 16);
  const file = path.join(dir, u.hostname, `${hash}.json`);
  try {
    const info = await stat(file);
    if (now() - info.mtimeMs < MAX_AGE_MS) return JSON.parse(await readFile(file, 'utf-8'));
  } catch {
    // niet in de cache
  }
  if (env.SCRAPE_OFFLINE === '1') throw new Error(`offline (SCRAPE_OFFLINE=1) en niet in de cache: ${url}`);
  const data = await ophalen();
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(data), 'utf-8');
  return data;
}

/**
 * robots.txt in dezelfde lokale cache (10 okt 2026: een "offline" run haalde
 * robots.txt nog echt op, want dat gaat niet via de browser). Bestand
 * debug/cache/<host>/robots-<hash>.txt. Online (SCRAPE_CACHE=1) telt alleen
 * een cache van minder dan een dag; offline elke leeftijd (een oude
 * robots.txt is behoudender dan geen). Geeft de tekst of null.
 */
export function robotsCacheBestand(dir, url) {
  const u = new URL(url);
  const hash = createHash('sha1').update(u.toString()).digest('hex').slice(0, 16);
  return path.join(dir, u.hostname, `robots-${hash}.txt`);
}

export async function leesRobotsUitCache(url, { dir = path.resolve('debug/cache'), offline = false, now = Date.now } = {}) {
  const file = robotsCacheBestand(dir, url);
  try {
    const info = await stat(file);
    if (offline || now() - info.mtimeMs < MAX_AGE_MS) return await readFile(file, 'utf-8');
  } catch {
    // niet in de cache
  }
  return null;
}

export async function bewaarRobotsInCache(url, tekst, { dir = path.resolve('debug/cache') } = {}) {
  const file = robotsCacheBestand(dir, url);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, tekst, 'utf-8');
}
