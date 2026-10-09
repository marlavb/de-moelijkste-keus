import { createIdBuilder } from '../lib/normalize.js';
import { normalizeGenre, isBekendGenre } from '../lib/genre.js';
import { titelUitKopEnOndertitel, metEnDash } from '../lib/titels.js';
import { vervallenStatus } from '../lib/beschikbaarheid.js';
import { gaNaar } from '../lib/diagnose.js';
import { blokkeerZwareBronnen } from '../lib/zwareBronnen.js';
import { ScrapeBlockedError } from '../lib/scrapeRun.js';

const AGENDA_PATH = '/programma';
// De lijst is een Phoenix LiveView: "Bekijk meer" werkt via een websocket,
// maar ?resultaten=N in de URL geeft server-side N+1 blokken van 10. Met 30
// stond op 8 okt 2026 alles erop (152 speeldata tot okt 2027); staat de knop
// "meer" er dan nog, dan één keer met het dubbele.
const RESULTATEN = [30, 60];

const MAANDEN = { januari: 1, februari: 2, maart: 3, april: 4, mei: 5, juni: 6, juli: 7, augustus: 8, september: 9, oktober: 10, november: 11, december: 12 };

/** "zaterdag 10 oktober 2026 20.00 uur" → { datum, tijd }. */
export function tamboerDatum(tekst) {
  const m = /(\d{1,2})\s+([a-z]+)\s+(\d{4})(?:\s+(\d{1,2})[.:](\d{2}))?/i.exec(String(tekst ?? ''));
  if (!m || !MAANDEN[m[2].toLowerCase()]) return null;
  const pad = (n) => String(n).padStart(2, '0');
  return { datum: `${m[3]}-${pad(MAANDEN[m[2].toLowerCase()])}-${pad(m[1])}`, tijd: m[4] ? `${pad(m[4])}:${m[5]}` : null };
}

/** Tekst van de verkoopknop → beschikbaarheid. */
export function tamboerBeschikbaarheid(knop) {
  const t = String(knop ?? '').trim();
  const vervallen = vervallenStatus(t);
  if (vervallen) return vervallen;
  if (/^uitverkocht$/i.test(t)) return 'uitverkocht';
  if (/^wachtlijst$/i.test(t)) return 'wachtlijst';
  if (/^bestel(len)?$/i.test(t)) return 'beschikbaar';
  return 'onbekend';
}

// Draait in de browser: de productiekaarten van de lijst.
function leesKaarten() {
  const t = (e) => e?.textContent.trim().replace(/\s+/g, ' ') || null;
  const gtm = (kaart) => {
    const klik = kaart.querySelector('[onclick*="pushProductClick"]')?.getAttribute('onclick') ?? '';
    const m = /pushProductClick\([^,]*,\s*(\{.*\})\)/.exec(klik);
    try {
      return m ? JSON.parse(m[1]) : null;
    } catch {
      return null;
    }
  };
  return {
    kaarten: [...document.querySelectorAll('[data-id="production-card"]')].map((k) => {
      const knop = k.querySelector('[data-id="sales_button"]');
      const info = k.querySelector('[data-id="info_button"]');
      const g = gtm(k);
      return {
        datum: t(k.querySelector('[data-id="date"]')),
        genres: t(k.querySelector('[data-id="genres"]')),
        kop: t(k.querySelector('[data-id="heading"]')),
        onder: t(k.querySelector('[data-id="subheading"]')),
        plek: t(k.querySelector('[data-class="production-location-tag"] div')),
        knop: t(knop) ?? t(k.querySelector('[data-id="sales_button"], .sales-button')),
        bestel: knop?.getAttribute('href') ?? null,
        href: info?.getAttribute('href') ?? k.querySelector('[data-id="heading"] a')?.getAttribute('href') ?? null,
        prijs: g?.price ?? null,
      };
    }),
    meer: Boolean(document.querySelector('[data-id="load_more_button"]')),
    titel: document.title,
  };
}

/**
 * De Tamboer (Hoogeveen). Phoenix LiveView achter Cloudflare, kaartverkoop
 * via Ticketmatic. Eén verzoek: /programma?resultaten=30 (alle speeldata).
 * Per kaart: datum met jaar en tijd, genre, titel en ondertitel, de plek
 * ("Het Podium", het poppodium in hetzelfde gebouw) en de verkoopknop.
 * Een Cloudflare-challenge of 403 respecteren we: geen omweg (zie CLAUDE.md).
 */
export async function scrapeTamboer({ page, theater, robots, waitForTurn, log, warn }) {
  if (!robots.isAllowed(AGENDA_PATH)) throw new Error(`robots.txt verbiedt ${AGENDA_PATH} — niet scrapen`);
  const zwaar = await blokkeerZwareBronnen(page, { ookScripts: true, ookOverig: true });
  let r;
  for (const n of RESULTATEN) {
    const url = `${theater.baseUrl}${AGENDA_PATH}?resultaten=${n}`;
    await waitForTurn();
    const res = await gaNaar(page, url, { timeout: 45000 });
    const status = res?.status();
    if (status === 403 || status === 503) throw new ScrapeBlockedError(`geblokkeerd (HTTP ${status}) op ${url}`);
    if (status !== 200) throw new Error(`programma gaf HTTP ${status ?? '?'} op ${url}`);
    r = await page.evaluate(leesKaarten);
    if (/just a moment|attention required/i.test(r.titel ?? '')) throw new ScrapeBlockedError(`geblokkeerd (Cloudflare-challenge) op ${url}`);
    // Sanity check: er moeten kaarten zijn.
    if (r.kaarten.length === 0) throw new Error(`geen productiekaarten op ${url} — site veranderd of geblokkeerd?`);
    if (!r.meer) break;
    if (n === RESULTATEN.at(-1)) warn(`ook met resultaten=${n} staat de knop "Bekijk meer" er nog — niet alles gelezen.`);
  }
  const shows = verwerkTamboer(r.kaarten, { theater, log });
  log(`${zwaar.verzoeken()} verzoeken`);
  return shows;
}

/** De kaarten → voorstellingen (los te testen). */
export function verwerkTamboer(kaarten, { theater, log = () => {}, opgehaaldOp = new Date().toISOString() }) {
  const buildId = createIdBuilder();
  const shows = [];
  const onbekend = {};
  const zonder = [];
  const tel = (o, k) => (o[k] = (o[k] ?? 0) + 1);
  for (const k of kaarten) {
    const d = tamboerDatum(k.datum);
    if (!k.kop || !d) {
      if (k.kop) zonder.push(k.kop);
      continue;
    }
    const genreRuw = k.genres?.split(/\s{2,}|,\s*/)[0]?.trim() || null;
    if (genreRuw && !isBekendGenre(genreRuw)) tel(onbekend, genreRuw);
    const cabaret = /cabaret|comedy/i.test(genreRuw ?? '');
    const kop = metEnDash(k.kop);
    const basis = titelUitKopEnOndertitel({ beschrijving: null }, { kop, ondertitel: k.onder ? metEnDash(k.onder) : null, volgorde: cabaret ? 'maker-titel' : 'titel-beschrijving' });
    const bron = k.href ? new URL(k.href, theater.baseUrl).toString() : theater.agendaUrl;
    const prijs = Number.parseFloat(k.prijs);
    shows.push({
      id: buildId(theater.id, basis.titel, d.datum, d.tijd),
      titel: basis.titel,
      theaterId: theater.id,
      theaterNaam: theater.naam,
      stad: theater.stad,
      podiumpas: theater.podiumpas,
      datum: d.datum,
      tijd: d.tijd,
      genre: normalizeGenre(genreRuw),
      genreRuw,
      beschikbaarheid: tamboerBeschikbaarheid(k.knop),
      beschrijving: basis.beschrijving ?? null,
      maker: basis.maker,
      prijs: Number.isFinite(prijs) && prijs > 0 ? prijs : null,
      ...(k.plek ? { zaal: k.plek } : {}),
      reserverenUrl: k.bestel ? new URL(k.bestel, theater.baseUrl).toString().replace(/\?terug=.*$/, '') : bron,
      bron,
      opgehaaldOp,
    });
  }
  const lijst = (o) => Object.entries(o).map(([x, n]) => `${x} (${n})`).join(', ');
  if (zonder.length) log(`zonder datum (overgeslagen): ${zonder.join('; ')}`);
  if (Object.keys(onbekend).length) log(`onbekende genres: ${lijst(onbekend)}`);
  return shows;
}
