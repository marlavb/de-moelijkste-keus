import { createIdBuilder, todayIsoDate } from '../lib/normalize.js';
import { openDetailCache } from '../lib/detailCache.js';
import { metDevCache } from '../lib/devCache.js';

const AGENDA_PATH = '/agenda';
const API_PATH = '/api/render';
const DAG = 86_400_000;
// Producties die binnen zoveel dagen spelen: elke nacht verversen (status).
export const DAGELIJKS_BINNEN_DAGEN = 7;

const CARRE_MONTHS = {
  januari: 1,
  februari: 2,
  maart: 3,
  april: 4,
  mei: 5,
  juni: 6,
  juli: 7,
  augustus: 8,
  september: 9,
  oktober: 10,
  november: 11,
  december: 12,
};

function pad2(n) {
  return String(n).padStart(2, '0');
}

const MONTH_NAME_PATTERN = new RegExp(Object.keys(CARRE_MONTHS).join('|'), 'i');

/**
 * Carré toont per productie een datum-*bereik* als platte tekst, bv.
 * "dinsdag 1 t/m zondag 13 september 2026" of, voor een los concert,
 * "dinsdag 15 september 2026" — met maandnaam en jaartal maar één keer
 * genoemd (aan het eind, en NIET naast de startdag: "1" en "september"
 * staan niet naast elkaar in het range-geval). We parsen daarom dag,
 * maand en jaar apart: de eerste losse "<dag>" in de tekst is de
 * startdag, de (enige) maandnaam en het jaartal aan het eind gelden
 * daarvoor.
 */
function parseStartDate(text) {
  const yearMatch = text.match(/(\d{4})\s*$/);
  const monthMatch = text.match(MONTH_NAME_PATTERN);
  const dayMatch = text.match(/(\d{1,2})\b/);
  if (!yearMatch || !monthMatch || !dayMatch) return null;
  const month = CARRE_MONTHS[monthMatch[0].toLowerCase()];
  return `${yearMatch[1]}-${pad2(month)}-${pad2(parseInt(dayMatch[1], 10))}`;
}

/**
 * Status van één voorstelling, zoals de site die zelf bepaalt (app-bundel,
 * 9 okt 2026): `sales_status`, en bij "on_sale" de `statusID` uit `data`.
 * Geeft { beschikbaarheid, belOns }.
 */
export function carreStatus(salesStatus, statusID) {
  const s = String(salesStatus ?? '');
  const id = String(statusID ?? '');
  if (s === 'on_sale') {
    switch (id) {
      case '15685':
        return { beschikbaarheid: 'uitverkocht', belOns: false };
      case 'waiting_list':
        return { beschikbaarheid: 'wachtlijst', belOns: false };
      case '15680':
        return { beschikbaarheid: 'afgelast', belOns: false };
      case '15681':
        // "Bel ons": alleen via de kassa (0900 25 25 255).
        return { beschikbaarheid: 'beschikbaar', belOns: true };
      case '15684':
        return { beschikbaarheid: 'onbekend', belOns: false };
      default:
        // Ook "last_chance" (laatste kans) en "15682" (gratis).
        return { beschikbaarheid: 'beschikbaar', belOns: false };
    }
  }
  // sales_not_started, sales_finished, show_started, show_finished.
  return { beschikbaarheid: 'onbekend', belOns: false };
}

/**
 * Het compacte deel van /api/render/voorstelling/<slug> dat we bewaren:
 * per event start, status, soort en verkooplink.
 */
export function carreProductie(json) {
  const productie = Object.values(json?.productions ?? {})[0];
  if (!productie) return null;
  return {
    naam: productie.data?.name ?? null,
    events: (productie.events ?? []).map((e) => ({
      id: e.id,
      start: e.start_date,
      salesStatus: e.sales_status ?? null,
      statusID: e.data?.statusID ?? null,
      soort: e.data?.eventtype ?? null,
      salesUrl: e.sales_url ?? null,
    })),
  };
}

/** "2026-10-15T20:00:00+02:00" → { datum: "2026-10-15", tijd: "20:00" } (Amsterdamse tijd, zoals de bron). */
export function carreTijdstip(start) {
  const m = String(start ?? '').match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/);
  return m ? { datum: m[1], tijd: m[2] } : null;
}

/**
 * Haalt de agenda van Koninklijk Theater Carré op — bewust "grof": één
 * entry per productie/datumbereik, geen losse voorstellingsdata.
 *
 * Structuur (geïnspecteerd op https://carre.nl/agenda, aug 2026):
 * - Client-side gerenderd (Vue/Nuxt-achtig): de kale HTML bevat geen
 *   showdata, pas na het uitvoeren van de pagina-JS verschijnt alles. Dat
 *   is verder niets bijzonders — Playwright met networkidle lost het op,
 *   net als bij elke andere site hier.
 * - Alle maanden (van de huidige tot ver vooruit) staan al in één keer in
 *   de pagina — geen scrollen, klikken of paginering nodig om de volledige
 *   lijst te zien.
 * - Elke productie is een .news-excerpt met een tekstueel datumbereik
 *   ("dinsdag 1 t/m zondag 13 september 2026"), titel en subtitel, en een
 *   link naar de eigen /voorstelling/<slug>-pagina.
 * - Losse speeldata, tijden en status staan niet op de agenda (alleen een
 *   datumbereik per productie). De site haalt ze zelf per productie op uit
 *   /api/render/voorstelling/<slug> (JSON, sinds 9 okt 2026 gebruikt; robots.txt
 *   verbiedt alleen /fonts/): per event `start_date` (met tijd),
 *   `sales_status`, `data.statusID`, `data.eventtype` en `sales_url`
 *   (Ticketmatic). /api/render/agenda bevat geen producties. Per productie
 *   één verzoek, met een detailcache zoals MIMIK: nieuw meteen, wat binnen 7
 *   dagen speelt elke nacht, de rest wekelijks. Alleen eventtype
 *   "Voorstelling". Mislukt de API voor een productie zonder cache, dan de
 *   oude grove rij (startdatum, geen tijd).
 * - Titels en beschrijving blijven van de agenda: dezelfde titels (en
 *   watchlist-sleutels) als voorheen.
 * - Geen genre-indicatie gevonden op deze pagina — `genre` blijft null.
 */
export async function scrapeCarre({ page, theater, robots, waitForTurn, log, warn = log, vandaag = todayIsoDate(), nu = () => Date.now() }) {
  if (!robots.isAllowed(AGENDA_PATH)) {
    log(`robots.txt verbiedt ${AGENDA_PATH} op ${theater.baseUrl} — sla over.`);
    return [];
  }

  await waitForTurn();
  await page.goto(theater.agendaUrl, { waitUntil: 'networkidle', timeout: 30000 });

  const rawItems = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('.news-excerpt')).map((el) => {
      const spans = Array.from(el.querySelectorAll('.news__content > span'));
      const dateText = spans[0]?.textContent.trim() ?? null;
      const subtitle = spans.length > 1 ? spans[spans.length - 1].textContent.trim() : null;
      const titel = el.querySelector('.news__content h4')?.textContent.trim() ?? null;
      const href = el.querySelector('.news__content h4 a')?.getAttribute('href') ?? null;
      return { dateText, subtitle, titel, href };
    });
  });

  // Sanity check: de agenda toont altijd producties.
  if (rawItems.length === 0) throw new Error('geen producties (.news-excerpt) op de agenda — site veranderd of geblokkeerd?');

  // Eén productie per adres (een productie kan met meer datumbereiken op de agenda staan).
  const producties = new Map();
  for (const item of rawItems) {
    if (!item.titel || !item.dateText || !item.href) continue;
    const datum = parseStartDate(item.dateText);
    if (!datum) {
      log(`kon datumbereik niet parsen: "${item.dateText}" (${item.titel}) — overgeslagen.`);
      continue;
    }
    const detailUrl = new URL(item.href, theater.baseUrl).toString();
    if (!producties.has(detailUrl)) producties.set(detailUrl, { ...item, detailUrl, datums: [] });
    producties.get(detailUrl).datums.push(datum);
  }

  // Speeldata per productie uit de API, met detailcache.
  const cache = await openDetailCache('carre', { nu });
  const binnenkort = new Date(Date.parse(`${vandaag}T00:00:00Z`) + DAGELIJKS_BINNEN_DAGEN * DAG).toISOString().slice(0, 10);
  const leeftijd = (url) => nu() - (cache.opgehaaldOp(url) ?? 0);
  const plan = [];
  for (const p of producties.values()) {
    const apiUrl = `${theater.baseUrl}${API_PATH}${new URL(p.detailUrl).pathname}`;
    p.apiUrl = apiUrl;
    if (!robots.isAllowed(new URL(apiUrl).pathname)) continue;
    const oud = cache.get(apiUrl);
    const speelt = (oud?.events ?? []).map((e) => carreTijdstip(e.start)?.datum).filter(Boolean);
    if (!oud) plan.push({ apiUrl, reden: 'nieuw' });
    else if (speelt.some((d) => d >= vandaag && d <= binnenkort) && leeftijd(apiUrl) >= 20 * 3_600_000) plan.push({ apiUrl, reden: 'binnenkort' });
    else if (cache.moetOphalen(apiUrl)) plan.push({ apiUrl, reden: 'wekelijks' });
  }
  let mislukt = 0;
  for (const { apiUrl } of plan) {
    try {
      await cache.haal(
        apiUrl,
        async () => {
          await waitForTurn();
          const json = await metDevCache(apiUrl, '', () =>
            page.evaluate(async (url) => {
              const r = await fetch(url, { headers: { Accept: 'application/json' } });
              if (!r.ok) throw new Error(`HTTP ${r.status}`);
              return r.json();
            }, apiUrl)
          );
          const productie = carreProductie(json);
          if (!productie) throw new Error('geen productie in het antwoord');
          return productie;
        },
        { forceer: true }
      );
    } catch (err) {
      mislukt++;
      log(`API ${apiUrl}: ${err.message.split('\n')[0]} — overgeslagen.`);
    }
  }
  await cache.bewaar();
  log(`${producties.size} producties op de agenda; API opgehaald ${plan.length} (${['nieuw', 'binnenkort', 'wekelijks'].map((r) => `${r} ${plan.filter((x) => x.reden === r).length}`).join(', ')}), ${mislukt} mislukt`);
  if (mislukt > Math.max(5, plan.length / 4)) warn(`${mislukt} productie-API's mislukt.`);

  const shows = verwerkCarre([...producties.values()].map((p) => ({ ...p, data: cache.get(p.apiUrl) })), { theater, vandaag, log, warn });
  return shows;
}

/**
 * Producties (van de agenda, met de bewaarde API-gegevens) → voorstellingen.
 * Zonder API-gegevens: de grove rij van voorheen (startdatum van elk
 * datumbereik, geen tijd).
 */
export function verwerkCarre(producties, { theater, vandaag = todayIsoDate(), log = () => {}, warn = log, opgehaaldOp = new Date().toISOString() }) {
  const buildId = createIdBuilder();
  const shows = [];
  const weg = new Map();
  let grof = 0;
  const rij = (p, datum, tijd, extra) => ({
    id: buildId(theater.id, p.titel, datum, tijd),
    titel: p.titel,
    theaterId: theater.id,
    theaterNaam: theater.naam,
    stad: theater.stad,
    podiumpas: theater.podiumpas,
    datum,
    tijd,
    genre: null,
    genreRuw: null,
    beschikbaarheid: 'onbekend',
    beschrijving: p.subtitle,
    reserverenUrl: p.detailUrl,
    bron: theater.agendaUrl,
    opgehaaldOp,
    ...extra,
  });
  for (const p of producties) {
    if (!p.data) {
      grof++;
      for (const datum of p.datums) shows.push(rij(p, datum, null, {}));
      continue;
    }
    for (const e of p.data.events ?? []) {
      // Alleen voorstellingen; geen inleiding, rondleiding, film of iets anders.
      if (String(e.soort ?? '').toLowerCase() !== 'voorstelling') {
        weg.set(e.soort ?? '(leeg)', (weg.get(e.soort ?? '(leeg)') ?? 0) + 1);
        continue;
      }
      const t = carreTijdstip(e.start);
      if (!t || t.datum < vandaag) continue;
      const { beschikbaarheid, belOns } = carreStatus(e.salesStatus, e.statusID);
      shows.push(
        rij(p, t.datum, t.tijd, {
          beschikbaarheid,
          // Ticketmatic-link per voorstelling. "Bel ons" (alleen via de kassa,
          // 0900 25 25 255): de productiepagina, die het nummer toont (de app
          // kan geen tel:-link als reserveerknop tonen).
          reserverenUrl: belOns ? p.detailUrl : e.salesUrl || p.detailUrl,
        })
      );
    }
  }
  if (weg.size) log(`weggelaten (geen voorstelling): ${[...weg].map(([k, n]) => `${k} (${n})`).join(', ')}`);
  if (grof) warn(`${grof} productie(s) zonder API-gegevens: alleen het datumbereik, zonder tijd.`);
  return shows;
}
