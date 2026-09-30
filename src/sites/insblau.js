import { createIdBuilder } from '../lib/normalize.js';
import { normalizeGenre } from '../lib/genre.js';
import { vervallenStatus } from '../lib/beschikbaarheid.js';

const AGENDA_PATH = '/programma';
const MONTHS = {
  januari: 1, februari: 2, maart: 3, april: 4, mei: 5, juni: 6,
  juli: 7, augustus: 8, september: 9, oktober: 10, november: 11, december: 12,
};

function parseDate(dateText, timeText) {
  // "Wo 30 September 2026" + "20:30 Uur"
  const m = dateText?.toLowerCase().match(/(\d{1,2})\s+([a-z]+)\s+(\d{4})/);
  if (!m || !MONTHS[m[2]]) return null;
  const t = timeText?.match(/(\d{1,2})[:.](\d{2})/);
  return {
    datum: `${m[3]}-${String(MONTHS[m[2]]).padStart(2, '0')}-${m[1].padStart(2, '0')}`,
    tijd: t ? `${t[1].padStart(2, '0')}:${t[2]}` : null,
  };
}

function classifyKnop(text) {
  // Afgelast/verplaatst op de knop of het statuslabel (zie beschikbaarheid.js).
  const vervallen = vervallenStatus(text);
  if (vervallen) return vervallen;
  const t = (text ?? '').trim().toLowerCase();
  if (t.includes('uitverkocht')) return 'uitverkocht';
  if (t.includes('wachtlijst')) return 'wachtlijst';
  if (t.includes('bestel') || t.includes('ticket') || t.includes('kaart')) return 'beschikbaar';
  return 'onbekend';
}

/**
 * Theater Ins Blau (Leiden).
 *
 * Structuur (geïnspecteerd op https://theaterinsblau.nl/programma, sep 2026):
 * - De programmapagina toont per productie één kaart (.o-event-card) met
 *   alleen de eerstvolgende datum, zonder tijd — deels in de browser
 *   gerenderd, dus via Playwright.
 * - Per productie één detailpagina met in de kop "Genre: …", de titel (h1)
 *   en de maker, en per speeldatum een .o-show-collapse-card met datum
 *   ("Wo 30 September 2026"), tijd ("20:30 Uur") en een "Bestellen"-link
 *   naar tickets.theaterinsblau.nl.
 * - Podiumpas geldt voor alle voorstellingen (hun kortingenpagina).
 * - Sanity check: geen kaarten én geen "geen voorstellingen"-melding →
 *   exception, zodat het vangnet terugvalt.
 */
export async function scrapeInsBlau({ page, theater, robots, waitForTurn, log }) {
  if (!robots.isAllowed(AGENDA_PATH)) {
    log(`robots.txt verbiedt ${AGENDA_PATH} op ${theater.baseUrl} — sla over.`);
    return [];
  }

  await waitForTurn();
  await page.goto(theater.agendaUrl, { waitUntil: 'networkidle', timeout: 45000 });
  const listing = await page.evaluate(() => ({
    hrefs: [...document.querySelectorAll('.o-event-card a[href*="/programma/"]')].map((a) => a.getAttribute('href')),
    empty: /geen voorstellingen|geen programma/i.test(document.body.innerText),
  }));
  const hrefs = [...new Set(listing.hrefs)];
  if (hrefs.length === 0 && !listing.empty) {
    throw new Error(`geen programmakaarten op ${page.url()} — site veranderd?`);
  }
  log(`${hrefs.length} producties op de programmapagina`);

  const buildId = createIdBuilder();
  const opgehaaldOp = new Date().toISOString();
  const shows = [];

  for (const href of hrefs) {
    const detailUrl = new URL(href, theater.baseUrl).toString();
    if (!robots.isAllowed(new URL(detailUrl).pathname)) continue;
    await waitForTurn();
    let detail;
    try {
      await page.goto(detailUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      detail = await page.evaluate(() => {
        const text = (el) => el?.textContent.trim().replace(/\s+/g, ' ') || null;
        const header = document.querySelector('.o-event-header-info');
        return {
          titel: text(header?.querySelector('h1')),
          maker: text(header?.querySelector('h1 + p')),
          genre: text(header?.querySelector('.o-date-label-outline'))?.replace(/^genre:\s*/i, '') ?? null,
          dates: [...document.querySelectorAll('.o-show-collapse-card')].map((card) => {
            const ps = card.querySelectorAll('.o-show-collapse-card-date p');
            const btn = card.querySelector('a.btn, button.btn, span.btn');
            return { dateText: text(ps[0]), timeText: text(ps[1]), knop: text(btn), href: btn?.getAttribute('href') ?? null };
          }),
        };
      });
    } catch (err) {
      log(`kon detailpagina niet laden (${detailUrl}): ${err.message} — overgeslagen.`);
      continue;
    }
    if (!detail.titel) continue;

    for (const d of detail.dates) {
      const when = parseDate(d.dateText, d.timeText);
      if (!when) continue;
      shows.push({
        id: buildId(theater.id, detail.titel, when.datum, when.tijd),
        titel: detail.titel,
        theaterId: theater.id,
        theaterNaam: theater.naam,
        stad: theater.stad,
        podiumpas: theater.podiumpas,
        datum: when.datum,
        tijd: when.tijd,
        genre: normalizeGenre(detail.genre),
        genreRuw: detail.genre,
        beschikbaarheid: classifyKnop(d.knop),
        beschrijving: null,
        maker: detail.maker,
        reserverenUrl: d.href && /^https?:/.test(d.href) ? d.href : detailUrl,
        bron: detailUrl,
        opgehaaldOp,
      });
    }
  }

  return shows;
}
