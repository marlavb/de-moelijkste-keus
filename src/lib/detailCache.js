// Cache van gegevens uit detailpagina's, tussen nachtelijke runs (okt 2026).
//
// Sommige theaters (Musis/Stadstheater Arnhem, Schaffelaartheater) geven de
// zaal, uitsluitingen of speeldata alleen op een detailpagina per productie.
// Elke nacht alle detailpagina's ophalen kost honderden verzoeken. Daarom:
// - een nieuwe productie (URL niet in de cache): meteen ophalen;
// - een bekende productie: hooguit één keer per week verversen, verdeeld over
//   de week (elke URL heeft een vaste weekdag, `emmer`), zodat er geen piek
//   ontstaat zeven dagen na de eerste run;
// - wat we niet ophalen, komt uit de cache (kan dus tot een week achterlopen).
//
// Opslag: één JSON-bestand per theater in cache/detail/<theaterId>.json, in de
// repo. De refresh-workflow commit het samen met public/data/ (zie
// refresh-data.yml). Waarom geen Actions-cache: die wordt na 7 dagen zonder
// gebruik gewist, sleutels zijn onveranderlijk en lokaal is hij niet te
// testen; een bestand in de repo is zichtbaar, overleeft alles en een
// teruggevallen run raakt het niet (er wordt alleen geschreven na een
// geslaagde scrape). Lokaal (SCRAPE_CACHE=1) schrijft een testrun het
// bestand ook: vóór een commit terugzetten (zie CLAUDE.md).
//
// Een productie die niet meer in de agenda staat, blijft nog BEWAAR_DAGEN
// staan (een agenda die een nacht half laadt, gooit zo niet alles weg) en
// verdwijnt daarna.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const DAG = 86_400_000;
export const MAX_DAGEN = 7;
export const BEWAAR_DAGEN = 21;
export const DETAIL_CACHE_DIR = path.resolve(process.env.DETAIL_CACHE_DIR ?? 'cache/detail');

/** Vaste weekdag (0–6) per URL, voor het spreiden van het verversen. */
export function emmer(url) {
  let h = 5381;
  for (const c of String(url)) h = ((h * 33) ^ c.charCodeAt(0)) >>> 0;
  return h % 7;
}

/**
 * Moet deze URL (opnieuw) worden opgehaald? Ja als hij nieuw is, ouder dan
 * MAX_DAGEN, of als het vandaag zijn weekdag is en hij minstens 20 uur oud is.
 */
export function moetVerversen(entry, url, nu = Date.now(), maxDagen = MAX_DAGEN) {
  const op = Date.parse(entry?.opgehaaldOp ?? '');
  if (!entry || Number.isNaN(op)) return true;
  const leeftijd = nu - op;
  if (leeftijd < 0 || leeftijd >= maxDagen * DAG) return true;
  return emmer(url) === Math.floor(nu / DAG) % 7 && leeftijd >= 20 * 3_600_000;
}

/**
 * Opent de cache van één theater. Geeft { moetOphalen(url), get(url),
 * zet(url, data), gezien(url), bewaar(), stats }.
 */
export async function openDetailCache(theaterId, { dir = DETAIL_CACHE_DIR, nu = () => Date.now() } = {}) {
  const bestand = path.join(dir, `${theaterId}.json`);
  let data = {};
  try {
    data = JSON.parse(await readFile(bestand, 'utf-8'));
  } catch {
    // nog geen cache (eerste run) of onleesbaar: dan alles ophalen
  }
  const items = new Map(Object.entries(data.items ?? {}));
  const gezienDezeRun = new Set();
  const stats = { nieuw: 0, ververst: 0, uitCache: 0 };
  return {
    stats,
    moetOphalen(url) {
      return moetVerversen(items.get(url), url, nu());
    },
    get(url) {
      gezienDezeRun.add(url);
      return items.get(url)?.data ?? null;
    },
    /** Wanneer deze URL het laatst is opgehaald (ms), of null. */
    opgehaaldOp(url) {
      const op = Date.parse(items.get(url)?.opgehaaldOp ?? '');
      return Number.isNaN(op) ? null : op;
    },
    gezien(url) {
      gezienDezeRun.add(url);
      if (items.has(url)) stats.uitCache++;
    },
    zet(url, waarde) {
      gezienDezeRun.add(url);
      if (items.has(url)) stats.ververst++;
      else stats.nieuw++;
      items.set(url, { opgehaaldOp: new Date(nu()).toISOString(), data: waarde });
    },
    /**
     * Uit de cache als dat mag, anders `ophalen()` en bewaren. Mislukt het
     * ophalen en is er een oudere versie, dan die (met `oud: true`). Met
     * `forceer` altijd ophalen (bv. de pagina is sindsdien gewijzigd).
     */
    async haal(url, ophalen, { forceer = false } = {}) {
      const e = items.get(url);
      if (e && !forceer && !moetVerversen(e, url, nu())) {
        gezienDezeRun.add(url);
        stats.uitCache++;
        return { data: e.data, uitCache: true };
      }
      try {
        const waarde = await ophalen();
        this.zet(url, waarde);
        return { data: waarde, uitCache: false };
      } catch (err) {
        if (!e) throw err;
        gezienDezeRun.add(url);
        stats.uitCache++;
        return { data: e.data, uitCache: true, oud: true, fout: err };
      }
    },
    async bewaar() {
      const grens = nu() - BEWAAR_DAGEN * DAG;
      const uit = {};
      for (const url of [...items.keys()].sort()) {
        const e = items.get(url);
        if (gezienDezeRun.has(url) || Date.parse(e.opgehaaldOp) >= grens) uit[url] = e;
      }
      await mkdir(dir, { recursive: true });
      await writeFile(bestand, `${JSON.stringify({ theaterId, items: uit }, null, 1)}\n`, 'utf-8');
    },
  };
}
