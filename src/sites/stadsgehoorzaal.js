import { createIdBuilder } from '../lib/normalize.js';
import { normalizeGenreFromList, normalizeGenre } from '../lib/genre.js';

const AGENDA_PATH = '/programma';
const MONTHS_AHEAD = 14;
const MAX_LOAD_MORE = 15;
const MONTHS = {
  januari: 1, februari: 2, maart: 3, april: 4, mei: 5, juni: 6,
  juli: 7, augustus: 8, september: 9, oktober: 10, november: 11, december: 12,
};

// Podiumpas: "geldig voor alle professionele voorstellingen … Verhuringen en
// voorstellingen waarbij de ticketverkoop in handen is van derden, zijn
// uitgesloten." Derden herkennen we aan de knop "Kaarten via de artiest".
// Tag "Gastprogramma" (verhuur) geverifieerd in het Ticketmatic-widget
// (27 sep 2026): Kiki Schippers (Cabaret) heeft een Podiumpas-prijstype,
// de Wannebiezz en Vlaardings Musical Gezelschap (Gastprogramma) niet.
// "Puur Vlaardings" zonder Gastprogramma kwam alleen voor bij een
// niet-voorstelling en is dus níet als uitsluiting opgenomen (niet gegokt).
const PODIUMPAS_EXCLUDED_TAGS = new Set(['gastprogramma']);

// Terugkerende activiteiten die in de agenda staan maar geen voorstelling
// zijn, en niet al via "Meld je aan" of een ontbrekende genre-tag wegvallen
// (zelfde defensieve aanpak als het Bosfest-dagkaartje bij Bostheater).
const NON_PERFORMANCE_TITLES = [/^koffie met de stadsvrienden/i];

function monthKeys(from, count) {
  const keys = [];
  const d = new Date(from.getFullYear(), from.getMonth(), 1);
  for (let i = 0; i < count; i++) {
    keys.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    d.setMonth(d.getMonth() + 1);
  }
  return keys;
}

function parseRowDate(text) {
  // "ZO 01 NOVEMBER 2026 - 13:30"
  const m = text?.toLowerCase().match(/(\d{1,2})\s+([a-z]+)\s+(\d{4})(?:\s*-\s*(\d{1,2})[:.](\d{2}))?/);
  if (!m || !MONTHS[m[2]]) return null;
  return {
    datum: `${m[3]}-${String(MONTHS[m[2]]).padStart(2, '0')}-${m[1].padStart(2, '0')}`,
    tijd: m[4] ? `${m[4].padStart(2, '0')}:${m[5]}` : null,
  };
}

// Knoptekst per speeldatum. null = overslaan: afgelast, of een
// aanmeldactiviteit (vrijwilligersavond, vakantieworkshop) i.p.v. een
// voorstelling.
function classifyStatus(text) {
  const t = (text ?? '').toLowerCase();
  if (t.includes('afgelast') || t.includes('geannuleerd')) return null;
  if (t.includes('meld je aan') || t.includes('aanmelden')) return null;
  if (t.includes('uitverkocht') || t.includes('wachtlijst vol')) return 'uitverkocht';
  if (t.includes('wachtlijst')) return 'wachtlijst';
  if (t.includes('kaarten') || t.includes('ticket') || t.includes('reserveer')) return 'beschikbaar';
  return 'onbekend';
}

/**
 * Stadsgehoorzaal (Vlaardingen).
 *
 * Structuur (geïnspecteerd op https://stadsgehoorzaal.nl/programma, sep 2026):
 * - De agenda werkt per maand (?d=asc&month=YYYY-MM&sort=starts_at, door
 *   robots.txt toegestaan), met een "Meer laden"-knop. Kaarten tonen alleen
 *   weekdag + dag, geen maand of tijd — daarom per productie één bezoek aan
 *   de detailpagina.
 * - Detailpagina: tags (genre) boven de h1, h1 = titel (komt overeen met de
 *   URL-slug en de listing), h2 = ondertitel of showtitel. Per speeldatum een
 *   rij "ZO 01 NOVEMBER 2026 - 13:30", prijs en een knop ("Koop kaarten" met
 *   /bestel/-link, of een status). De eerste datum staat soms dubbel (ook in
 *   een sticky kop): we ontdubbelen op datum+tijd.
 * - Sanity check: geen enkele productie in alle maanden → exception.
 */
export async function scrapeStadsgehoorzaal({ page, theater, robots, waitForTurn, log }) {
  const hrefs = new Set();
  let emptyStreak = 0;
  for (const month of monthKeys(new Date(), MONTHS_AHEAD)) {
    const path = `${AGENDA_PATH}?d=asc&month=${month}&sort=starts_at`;
    if (!robots.isAllowed(path)) {
      log(`robots.txt verbiedt ${path} — stop.`);
      break;
    }
    await waitForTurn();
    await page.goto(new URL(path, theater.baseUrl).toString(), { waitUntil: 'networkidle', timeout: 45000 });
    for (let i = 0; i < MAX_LOAD_MORE; i++) {
      const more = page.getByText('Meer laden', { exact: true });
      if ((await more.count()) === 0 || !(await more.first().isVisible())) break;
      await waitForTurn();
      await more.first().click();
      await page.waitForLoadState('networkidle').catch(() => {});
    }
    const found = await page.evaluate(() =>
      [...document.querySelectorAll('a[href]')]
        .map((a) => a.getAttribute('href'))
        .filter((h) => /^\/programma\/[a-z0-9-]+$/.test(h))
    );
    const before = hrefs.size;
    for (const h of found) hrefs.add(h);
    log(`maand ${month}: ${new Set(found).size} producties (${hrefs.size - before} nieuw)`);
    emptyStreak = found.length === 0 ? emptyStreak + 1 : 0;
    if (emptyStreak >= 2) break;
  }
  if (hrefs.size === 0) {
    throw new Error('geen enkele productie gevonden in de maandagenda — site veranderd?');
  }

  const buildId = createIdBuilder();
  const opgehaaldOp = new Date().toISOString();
  const shows = [];
  const statusTexts = {};
  let skippedNoTag = 0;

  for (const href of hrefs) {
    const detailUrl = new URL(href, theater.baseUrl).toString();
    if (!robots.isAllowed(new URL(detailUrl).pathname)) continue;
    await waitForTurn();
    let detail;
    try {
      await page.goto(detailUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      detail = await page.evaluate(() => {
        const text = (el) => el?.textContent.trim().replace(/\s+/g, ' ') || null;
        const h1 = document.querySelector('h1');
        const head = h1?.closest('.flex.flex-col')?.parentElement;
        // Elke speeldatum is een [data-ticket-row]: in de lijst de hele rij,
        // in de sticky kop (#ticket-table) alleen het linkerdeel — de knop
        // staat dan in de ouder.
        const rows = [...document.querySelectorAll('[data-ticket-row]')].map((el) => {
          const container = el.querySelector('a, button') ? el : el.parentElement;
          const action = container.querySelector('a[href*="/bestel/"], a.rounded-md, button.rounded-md, button[disabled]');
          return {
            dateText: text(el.querySelector('.font-haarlem')),
            status: text(action),
            href: action?.matches('a[href*="/bestel/"]') ? action.getAttribute('href') : null,
          };
        });
        return {
          titel: text(h1),
          ondertitel: text(h1?.nextElementSibling),
          tags: [...(head?.querySelectorAll('span.rounded-tag, span[class*="rounded-tag"]') ?? [])].map((s) => text(s)).filter(Boolean),
          rows,
        };
      });
    } catch (err) {
      log(`kon detailpagina niet laden (${detailUrl}): ${err.message} — overgeslagen.`);
      continue;
    }
    if (!detail.titel || NON_PERFORMANCE_TITLES.some((re) => re.test(detail.titel))) continue;

    // Zonder enkele genre-tag is het geen voorstelling (bv. "Info-uurtje
    // nieuwe vrijwilligers").
    if (detail.tags.length === 0) {
      skippedNoTag++;
      continue;
    }
    const tagsLower = detail.tags.map((t) => t.toLowerCase());
    const excludedByTag = tagsLower.some((t) => PODIUMPAS_EXCLUDED_TAGS.has(t));
    const seen = new Set();
    for (const row of detail.rows) {
      const when = parseRowDate(row.dateText);
      if (!when) continue;
      const key = `${when.datum} ${when.tijd}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const status = row.status ?? '(geen knop)';
      statusTexts[status] = (statusTexts[status] ?? 0) + 1;
      const beschikbaarheid = classifyStatus(status);
      if (beschikbaarheid === null) continue;
      const viaDerden = /via de artiest|via derden|externe verkoop/i.test(status);
      shows.push({
        id: buildId(theater.id, detail.titel, when.datum, when.tijd),
        titel: detail.titel,
        theaterId: theater.id,
        theaterNaam: theater.naam,
        stad: theater.stad,
        podiumpas: theater.podiumpas && !excludedByTag && !viaDerden,
        datum: when.datum,
        tijd: when.tijd,
        genre: normalizeGenreFromList(detail.tags) ?? normalizeGenre(detail.tags[0] ?? null),
        genreRuw: detail.tags.join(', ') || null,
        beschikbaarheid,
        beschrijving: detail.ondertitel,
        maker: null,
        reserverenUrl: row.href ? new URL(row.href, theater.baseUrl).toString() : detailUrl,
        bron: detailUrl,
        opgehaaldOp,
      });
    }
  }

  log(`knop/status-teksten: ${Object.entries(statusTexts).map(([t, n]) => `"${t}" (${n})`).join(', ')}`);
  if (skippedNoTag > 0) log(`${skippedNoTag} productie(s) zonder genre-tag overgeslagen (geen voorstelling).`);
  return shows;
}
