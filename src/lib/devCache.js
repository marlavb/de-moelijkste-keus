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

export async function installDevCache(page, { dir = path.resolve('debug/cache'), log = console.log, now = Date.now } = {}) {
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
  log(`[devcache] aan (${dir}); pagina's uit de cache worden niet opnieuw opgehaald`);
  return { stats: () => ({ hits, misses }) };
}
