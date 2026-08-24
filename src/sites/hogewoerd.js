import { createDutchDayParser, extractTime, createIdBuilder } from '../lib/normalize.js';
import { normalizeGenreFromList } from '../lib/genre.js';
import { USER_AGENT } from '../lib/config.js';

const AGENDA_PATH = '/agenda';
const SITEMAP_PATH = '/sitemap.xml';

function classifyBeschikbaarheid(bookable, buttonText) {
  const tekst = (buttonText ?? '').trim().toLowerCase();
  if (tekst.includes('wachtlijst')) return 'wachtlijst';
  if (!bookable || tekst.includes('uitverkocht')) return 'uitverkocht';
  return 'beschikbaar';
}

/**
 * Haalt de volledige agenda van Podium Hoge Woerd op.
 *
 * Structuur (geïnspecteerd op https://www.podiumhogewoerd.nl/agenda, aug
 * 2026):
 * - robots.txt verbiedt /views/, /mvc/, /stats/, /cgi-bin/, /test/,
 *   /controls/, geen crawl-delay. /agenda zelf is toegestaan, máár verdere
 *   voorstellingen na de eerste ~10 laden via AJAX op /mvc/event/partial —
 *   en dat pad is dus verboden. Robots-compliant pagineren op de
 *   agendalijst zelf kan hier niet.
 * - Workaround: /sitemap.xml (niet verboden) somt alle ~130 losse
 *   /agenda/<slug>-detailpagina's zelf op (plus één losse "koop-ticket"-
 *   hulppagina, geen voorstelling, die filteren we eruit). We bezoeken dus
 *   elke detailpagina rechtstreeks in plaats van de lijst te pagineren —
 *   sitemap.xml zelf is statische XML, geen Playwright/JS voor nodig,
 *   alleen een gewone fetch() (met dezelfde politeness-wachttijd ervoor).
 * - Titel: de detailpagina toont artiest/gezelschap als <h1 class="title
 *   outline"> en de eigenlijke productienaam als <h2 class="subtitle
 *   heading-4"> (bv. h1 "Kasper van der Laan", h2 "Ruim") — de h2 matcht de
 *   URL-slug en de <title>-meta, dus die gebruiken we als titel. Genre staat
 *   los als kommagescheiden <p class="subtitle"> (bv. "Muziek,
 *   Muziektheater, No Dutch? No Problem!").
 * - Eén detailpagina kan meerdere speeldata hebben (elk een eigen <div
 *   class="ticket-row flex desktop">, met een aparte ".mobile"-variant
 *   ernaast die we bewust overslaan om dubbeltellingen te voorkomen) — MAAR
 *   ditzelfde ".desktop"-blok wordt bij een voorstelling met maar één datum
 *   soms ook al dubbel gerenderd (zelfde datum, zelfde programId, kennelijk
 *   een layout-quirk). We dedupliceren daarom altijd op de combinatie
 *   datum+tijd-tekst, ongeacht hoeveel ".desktop"-blokken er zijn.
 * - Datum staat als platte Nederlandse tekst zonder jaartal ("do 04
 *   maart") — zelfde formaat als DeLaMar/Theater Kikker, dus
 *   createDutchDayParser() werkt hier ook (chronologisch toegepast over de
 *   sitemap-volgorde, die niet per se datum-gesorteerd is — zie hieronder).
 * - Boekingsknop is ofwel <a class="btn btn-secondary" href="...">Tickets</a>
 *   (boekbaar, directe Ticketmatic-link) ofwel <button class="btn
 *   btn-secondary">Uitverkocht</button> (geen href) — dat onderscheid geeft
 *   direct de boekingsstatus.
 * - Eigen podiumpas-pagina (/podiumpas), FAQ en ticketinformatie-pagina's
 *   noemen geen enkele categorie-uitsluiting (in tegenstelling tot elk
 *   ander theater in deze batch) — PodiumPas wordt daar consequent
 *   omschreven als "onbeperkt theaterbezoek bij niet-uitverkochte
 *   voorstellingen", zonder de kwalificatie die de site wél gebruikt voor
 *   hun andere kortingspas ("We Are Public bij GESELECTEERDE
 *   voorstellingen"). Daarom hier gewoon theater.podiumpas, geen per-show
 *   berekening zoals bij Bostheater.
 */
export async function scrapeHogeWoerd({ page, theater, robots, waitForTurn, log }) {
  if (!robots.isAllowed(AGENDA_PATH)) {
    log(`robots.txt verbiedt ${AGENDA_PATH} op ${theater.baseUrl} — sla over.`);
    return [];
  }
  if (!robots.isAllowed(SITEMAP_PATH)) {
    log(`robots.txt verbiedt ${SITEMAP_PATH} op ${theater.baseUrl} — sla over.`);
    return [];
  }

  await waitForTurn();
  const sitemapUrl = new URL(SITEMAP_PATH, theater.baseUrl).toString();
  let detailUrls = [];
  try {
    const res = await fetch(sitemapUrl, { headers: { 'User-Agent': USER_AGENT } });
    const xml = await res.text();
    const locs = Array.from(xml.matchAll(/<loc>([^<]+)<\/loc>/g)).map((m) => m[1]);
    detailUrls = locs.filter((u) => /\/agenda\/[^/]+$/.test(u) && !u.endsWith('/agenda/koop-ticket'));
  } catch (err) {
    log(`kon sitemap niet ophalen: ${err.message}`);
    return [];
  }

  log(`${detailUrls.length} voorstellingspagina's gevonden via sitemap.xml`);

  const buildId = createIdBuilder();
  const opgehaaldOp = new Date().toISOString();
  const shows = [];

  for (const detailUrl of detailUrls) {
    const detailPath = new URL(detailUrl).pathname;
    if (!robots.isAllowed(detailPath)) {
      log(`robots.txt verbiedt ${detailPath} — overgeslagen.`);
      continue;
    }

    await waitForTurn();
    let data;
    try {
      await page.goto(detailUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      data = await page.evaluate(() => {
        const titel = document.querySelector('h2.subtitle.heading-4')?.textContent.trim() ?? null;
        const genreTekst = document.querySelector('p.subtitle')?.textContent.trim() ?? '';
        const genres = genreTekst
          .split(',')
          .map((g) => g.trim())
          .filter(Boolean);
        const beschrijving =
          document.querySelector('meta[name="description"]')?.getAttribute('content')?.trim() ?? null;

        const rows = Array.from(document.querySelectorAll('.ticket-row.flex.desktop')).map((row) => {
          const dagTekst =
            row.querySelector('.date .ticket-value span')?.textContent.replace(/^Datum\s*/i, '').trim() ?? null;
          const tijdTekst =
            row.querySelector('.time .ticket-value span')?.textContent.replace(/^Tijd\s*/i, '').trim() ?? null;
          const btn = row.querySelector('a.btn.btn-secondary, button.btn.btn-secondary');
          const bookable = btn?.tagName === 'A' && !!btn.getAttribute('href');
          const ticketHref = bookable ? btn.getAttribute('href') : null;
          const buttonText = btn?.textContent.trim() ?? null;
          return { dagTekst, tijdTekst, bookable, ticketHref, buttonText };
        });

        return { titel, genres, beschrijving, rows };
      });
    } catch (err) {
      log(`kon detailpagina niet laden (${detailUrl}): ${err.message} — overgeslagen.`);
      continue;
    }

    if (!data.titel) {
      log(`geen titel gevonden op ${detailUrl} — overgeslagen.`);
      continue;
    }

    const parseDay = createDutchDayParser();
    const seenDateTimes = new Set();

    for (const row of data.rows) {
      if (!row.dagTekst) continue;
      const dedupeKey = `${row.dagTekst}|${row.tijdTekst}`;
      if (seenDateTimes.has(dedupeKey)) continue;
      seenDateTimes.add(dedupeKey);

      const datum = parseDay(row.dagTekst);
      if (!datum) {
        log(`kon datum-label niet parsen: "${row.dagTekst}" (${data.titel}) — overgeslagen.`);
        continue;
      }
      const tijd = extractTime(row.tijdTekst);
      const ticketUrl = row.ticketHref ? new URL(row.ticketHref, theater.baseUrl).toString() : null;

      shows.push({
        id: buildId(theater.id, data.titel, datum, tijd),
        titel: data.titel,
        theaterId: theater.id,
        theaterNaam: theater.naam,
        stad: theater.stad,
        podiumpas: theater.podiumpas,
        datum,
        tijd,
        genre: normalizeGenreFromList(data.genres),
        genreRuw: data.genres.join(', ') || null,
        beschikbaarheid: classifyBeschikbaarheid(row.bookable, row.buttonText),
        beschrijving: data.beschrijving,
        reserverenUrl: ticketUrl ?? detailUrl,
        bron: detailUrl,
        opgehaaldOp,
      });
    }
  }

  return shows;
}
