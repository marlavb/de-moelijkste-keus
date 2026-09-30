import { createIdBuilder } from '../lib/normalize.js';
import { normalizeGenreFromList, normalizeGenre } from '../lib/genre.js';
import { dedupeShows } from '../lib/peppered.js';
import { vervallenStatus } from '../lib/beschikbaarheid.js';

const AGENDA_PATH = '/nl/agenda/';
const MAX_LOAD_MORE = 40;
const MONTHS = { jan: 1, feb: 2, mrt: 3, apr: 4, mei: 5, jun: 6, jul: 7, aug: 8, sep: 9, okt: 10, nov: 11, dec: 12 };

// Wekelijkse lessen/workshops (bv. Ballroom Thursdays, vogue-lessen) staan
// ook in de agenda, maar zijn geen voorstellingen.
function isWorkshop(genres) {
  return genres.some((g) => /workshop|les\b|lessen|cursus/i.test(g));
}

function parsePlaylistDate(text) {
  // "zo 27 sep 2026 | 15:00"
  const m = text?.toLowerCase().match(/(\d{1,2})\s+([a-z]{3})[a-z]*\s+(\d{4})(?:\s*\|\s*(\d{1,2})[:.](\d{2}))?/);
  if (!m || !MONTHS[m[2]]) return null;
  return {
    datum: `${m[3]}-${String(MONTHS[m[2]]).padStart(2, '0')}-${m[1].padStart(2, '0')}`,
    tijd: m[4] ? `${m[4].padStart(2, '0')}:${m[5]}` : null,
  };
}

function classifyKnop(text) {
  // Afgelast/verplaatst op de knop of het statuslabel (zie beschikbaarheid.js).
  const vervallen = vervallenStatus(text);
  if (vervallen) return vervallen;
  const t = (text ?? '').trim().toLowerCase();
  if (t.includes('uitverkocht')) return 'uitverkocht';
  if (t.includes('wachtlijst')) return 'wachtlijst';
  if (t.includes('ticket') || t.includes('kaart')) return 'beschikbaar';
  return 'onbekend';
}

/**
 * Maas theater en dans (Rotterdam) — alleen de voorstellingen in het eigen
 * Maaspodium.
 *
 * Structuur (geïnspecteerd op https://www.maastd.nl/nl/agenda/, sep 2026):
 * - De agenda (.showslist) toont 20 items en laadt de rest via een "Toon
 *   meer"-knop (#jsShowslistMore). Het gros van de ~240 items is tournee
 *   door het hele land; alleen het Maaspodium hoort bij deze Podiumpas-
 *   locatie ("Je kunt in het Maaspodium onbeperkt naar voorstellingen met de
 *   Podiumpas"). Maas-voorstellingen in bv. Theater aan het Spui of de TR
 *   Schouwburg staan al in die agenda's — zo geen dubbelingen.
 * - De listing heeft geen genre, status of ticketlink. Daarom bezoeken we per
 *   productie één keer de detailpagina: die heeft een speellijst met per
 *   datum data-maaspodium / data-schoolvoorstelling, een Ticketmatic-link en
 *   in de kop het genre ("Genre: Fysiek theater"). Schoolvoorstellingen en
 *   voorbije data ("Geweest") slaan we over, net als workshops/lessen.
 * - Sanity check: geen .showslist → exception (vangnet valt terug).
 */
export async function scrapeMaas({ page, theater, robots, waitForTurn, log }) {
  if (!robots.isAllowed(AGENDA_PATH)) {
    log(`robots.txt verbiedt ${AGENDA_PATH} op ${theater.baseUrl} — sla over.`);
    return [];
  }

  await waitForTurn();
  await page.goto(theater.agendaUrl, { waitUntil: 'networkidle', timeout: 45000 });
  if ((await page.locator('.showslist').count()) === 0) {
    throw new Error(`geen .showslist op ${page.url()} — site veranderd?`);
  }

  let clicks = 0;
  for (; clicks < MAX_LOAD_MORE; clicks++) {
    const more = page.locator('#jsShowslistMore');
    if ((await more.count()) === 0 || !(await more.first().isVisible())) break;
    const before = await page.locator('.showslist__item').count();
    await waitForTurn();
    await more.first().click();
    await page.waitForFunction((n) => document.querySelectorAll('.showslist__item').length > n, before, { timeout: 15000 }).catch(() => {});
    if ((await page.locator('.showslist__item').count()) === before) break;
  }

  const listing = await page.evaluate(() =>
    [...document.querySelectorAll('.showslist__item')].map((item) => ({
      href: item.querySelector('a')?.getAttribute('href') ?? null,
      location: item.querySelector('.showslist__location')?.textContent.trim().replace(/\s+/g, ' ') ?? '',
    }))
  );
  const hrefs = [...new Set(listing.filter((i) => i.href && /maaspodium/i.test(i.location)).map((i) => i.href))];
  log(`${listing.length} agenda-items na ${clicks}× "Toon meer", ${hrefs.length} producties in het Maaspodium`);

  const buildId = createIdBuilder();
  const opgehaaldOp = new Date().toISOString();
  const shows = [];
  let workshops = 0;
  let school = 0;

  for (const href of hrefs) {
    const detailUrl = new URL(href, theater.baseUrl).toString();
    const detailPath = new URL(detailUrl).pathname;
    if (!robots.isAllowed(detailPath)) continue;
    await waitForTurn();
    let detail;
    try {
      await page.goto(detailUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      detail = await page.evaluate(() => {
        const text = (el) => el?.textContent.trim().replace(/\s+/g, ' ') || null;
        return {
          titel: text(document.querySelector('.showheader__main h1')),
          intro: text(document.querySelector('.showheader__main .intro')),
          maker: text(document.querySelector('.showheader__specs--maker strong')),
          genres: (text(document.querySelector('.showheader__specs--types strong')) ?? '').split(',').map((g) => g.trim()).filter(Boolean),
          rows: [...document.querySelectorAll('.playlist__row')].map((row) => ({
            maaspodium: row.getAttribute('data-maaspodium') === 'true',
            school: row.getAttribute('data-schoolvoorstelling') === 'true',
            dateText: text(row.querySelector('.playlist__date time')),
            knop: text(row.querySelector('.playlist__buttons .button')),
            href: row.querySelector('.playlist__buttons a')?.getAttribute('href') ?? null,
          })),
        };
      });
    } catch (err) {
      log(`kon detailpagina niet laden (${detailUrl}): ${err.message} — overgeslagen.`);
      continue;
    }
    if (!detail.titel) continue;
    if (isWorkshop(detail.genres)) {
      workshops++;
      continue;
    }

    const genre = normalizeGenreFromList(detail.genres) ?? normalizeGenre(detail.genres[0] ?? null);
    for (const row of detail.rows) {
      if (!row.maaspodium) continue;
      if (row.school) {
        school++;
        continue;
      }
      if (/geweest/i.test(row.knop ?? '')) continue;
      const when = parsePlaylistDate(row.dateText);
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
        genre,
        genreRuw: detail.genres.join(', ') || null,
        beschikbaarheid: classifyKnop(row.knop),
        beschrijving: detail.intro,
        maker: detail.maker,
        reserverenUrl: row.href && /^https?:/.test(row.href) ? row.href : detailUrl,
        bron: detailUrl,
        opgehaaldOp,
      });
    }
  }

  log(`${school} schoolvoorstelling(en) en ${workshops} workshop-productie(s) overgeslagen.`);
  return dedupeShows(shows);
}
