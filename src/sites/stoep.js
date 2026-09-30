import { createIdBuilder } from '../lib/normalize.js';
import { normalizeGenre } from '../lib/genre.js';
import { dedupeShows } from '../lib/peppered.js';
import { pasTitelConventieToe } from '../lib/titels.js';
import { vervallenStatus } from '../lib/beschikbaarheid.js';

const AGENDA_PATH = '/voorstellingen';
const MONTHS_AHEAD = 14;
const PODIUMPAS_PRICE_CEILING = 50; // "tickets met een reguliere prijs van maximaal 50 euro"

// Datum/tijd in Nederlandse tijd uit een ISO-tijd in UTC ("…T17:30:00Z").
const AMS = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Amsterdam', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});
function toAmsterdam(iso) {
  const parts = Object.fromEntries(AMS.formatToParts(new Date(iso)).map((p) => [p.type, p.value]));
  return { datum: `${parts.year}-${parts.month}-${parts.day}`, tijd: `${parts.hour}:${parts.minute}` };
}

function monthKeys(from, count) {
  const keys = [];
  const d = new Date(from.getFullYear(), from.getMonth(), 1);
  for (let i = 0; i < count; i++) {
    keys.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    d.setMonth(d.getMonth() + 1);
  }
  return keys;
}

const DAG_MAAND = /(\d{1,2})\s+(januari|februari|maart|april|mei|juni|juli|augustus|september|oktober|november|december)/i;
const MAANDEN = ['januari', 'februari', 'maart', 'april', 'mei', 'juni', 'juli', 'augustus', 'september', 'oktober', 'november', 'december'];

function classifyKnop(text) {
  // Afgelast/verplaatst op de knop of het statuslabel (zie beschikbaarheid.js).
  const vervallen = vervallenStatus(text);
  if (vervallen) return vervallen;
  const t = (text ?? '').trim().toLowerCase();
  if (!t) return 'onbekend';
  if (t.includes('uitverkocht')) return 'uitverkocht';
  if (t.includes('wachtlijst')) return 'wachtlijst';
  if (t.includes('kaarten') || t.includes('ticket') || t.includes('reserveer')) return 'beschikbaar';
  return 'onbekend'; // bv. "geen verkoop"
}

// Een voorstelling-specifieke Podiumpas-notitie ("Sommige voorstellingen staan
// het gebruik van de Podiumpas contractueel niet toe. Dit staat dan bij de
// voorstelling vermeld."). Op 27 sep 2026 kwam die op geen enkele
// detailpagina voor; een ontkennende vermelding zet podiumpas op false.
const PODIUMPAS_NIET = /(niet|geen)\b[^.]{0,60}podium ?pas|podium ?pas[^.]{0,60}\b(niet|geen|uitgesloten)/i;

/**
 * Theater de Stoep (Spijkenisse).
 *
 * Structuur (geïnspecteerd op https://theaterdestoep.nl/voorstellingen, sep 2026):
 * - Zelfde Phoenix-platform als de Stadsgehoorzaal. De agenda bestaat uit
 *   maandblokken (#cards-YYYY-MM), die we per maand via ?month= ophalen.
 * - Per productie één detailpagina (/voorstelling/<slug>) met schema.org
 *   JSON-LD (TheaterEvent: startDate in UTC, offers met prijs/bestellink,
 *   eventStatus, locatie) — dat is onze bron voor datum/tijd/prijs. De
 *   knoptekst per datum (wachtlijst, "geen verkoop") halen we uit de eigen
 *   datumrijen ([data-part="date"/"time"]), niet uit de carrousel "Andere
 *   bezoekers gaan ook naar".
 * - Tags onder de titel: eerst de zaal, dan het genre — of "verhuur".
 * - Podiumpas false bij: verhuur, "geen verkoop" (kaartverkoop door derden),
 *   laagste prijs boven €50, een Podiumpas-notitie op de pagina, en de
 *   (klassieke) concerten op locatie in Simonshaven. Geen prijs gevonden →
 *   ook false (defensief, zoals bij Flint).
 */
export async function scrapeStoep({ page, theater, robots, waitForTurn, log }) {
  if (!robots.isAllowed(AGENDA_PATH)) {
    log(`robots.txt verbiedt ${AGENDA_PATH} op ${theater.baseUrl} — sla over.`);
    return [];
  }
  // De agenda toont standaard twee maanden (+ "Toon meer" voor een derde);
  // verder komt alleen via LiveView-knoppen. ?month=YYYY-MM geeft elk
  // maandblok wél server-side (robots.txt verbiedt alleen /fonts/).
  const hrefs = new Set();
  let emptyStreak = 0;
  let firstMonth = true;
  for (const month of monthKeys(new Date(), MONTHS_AHEAD)) {
    const path = `${AGENDA_PATH}?month=${month}`;
    if (!robots.isAllowed(path)) break;
    await waitForTurn();
    await page.goto(new URL(path, theater.baseUrl).toString(), { waitUntil: 'networkidle', timeout: 45000 });
    const found = await page.evaluate((m) => {
      const block = document.getElementById(`cards-${m}`);
      if (!block) return null;
      return [...block.querySelectorAll('a[href^="/voorstelling/"]')]
        .map((a) => a.getAttribute('href').split('?')[0])
        .filter((h) => /^\/voorstelling\/[^/]+$/.test(h));
    }, month);
    if (found === null && firstMonth) {
      throw new Error(`geen maandblok #cards-${month} op ${page.url()} — site veranderd?`);
    }
    firstMonth = false;
    const unique = new Set(found ?? []);
    for (const h of unique) hrefs.add(h);
    log(`maand ${month}: ${unique.size} producties`);
    emptyStreak = unique.size === 0 ? emptyStreak + 1 : 0;
    if (emptyStreak >= 2) break;
  }

  const buildId = createIdBuilder();
  const opgehaaldOp = new Date().toISOString();
  const shows = [];
  const reasons = {};

  for (const href of hrefs) {
    const detailUrl = new URL(href, theater.baseUrl).toString();
    if (!robots.isAllowed(href)) continue;
    await waitForTurn();
    let detail;
    try {
      await page.goto(detailUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      detail = await page.evaluate(() => {
        const text = (el) => el?.textContent.trim().replace(/\s+/g, ' ') || null;
        const events = [];
        for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
          try {
            const data = JSON.parse(s.textContent);
            for (const node of [].concat(data['@graph'] ?? data)) if (/Event$/.test(node['@type'] ?? '')) events.push(node);
          } catch {}
        }
        const carousel = [...document.querySelectorAll('h2')].find((h) => /andere bezoekers/i.test(h.textContent))?.parentElement ?? null;
        const rows = [...document.querySelectorAll('[data-part="date"]')]
          .filter((d) => !carousel?.contains(d))
          .map((d) => {
            const row = d.closest('.flex.justify-between') ?? d.parentElement.parentElement;
            const action = row?.querySelector('a, button, span.rounded-3xl');
            return { dateText: text(d), timeText: text(d.parentElement.querySelector('[data-part="time"]')), knop: text(action) };
          });
        const tagBox = [...document.querySelectorAll('div.flex.flex-wrap')].find((el) => !el.closest('header, nav, footer') && el.querySelector(':scope > span > span'));
        const main = document.querySelector('main') ?? document.body;
        return {
          // Titel (h2) en ondertitel/maker (h3) staan samen in één blok. Zonder
          // eigen h3 géén maker: de eerste h3 op de pagina hoort anders bij de
          // carrousel "Andere bezoekers gaan ook naar" (gaf o.a. "Naar het boek
          // van Saskia Noort" en "Persbericht" als maker).
          ...(() => {
            const h2 = document.querySelector('main h2, h2');
            const h3 = h2?.parentElement?.querySelector(':scope > h3') ?? null;
            return { titel: text(h2), maker: text(h3) };
          })(),
          tags: tagBox ? [...tagBox.querySelectorAll(':scope > span')].map((s) => text(s)) : [],
          events,
          rows,
          bodyText: (carousel ? main.textContent.replace(carousel.textContent, '') : main.textContent).replace(/\s+/g, ' '),
        };
      });
    } catch (err) {
      log(`kon detailpagina niet laden (${detailUrl}): ${err.message} — overgeslagen.`);
      continue;
    }

    if (detail.rows.length > detail.events.length) {
      log(`let op: ${detail.rows.length} datumrijen maar ${detail.events.length} JSON-LD-events op ${detailUrl}`);
    }
    const tags = detail.tags.filter(Boolean).map((t) => t.toLowerCase());
    const genreTag = tags.find((t) => !/zaal|foyer|locatie/.test(t) && t !== 'verhuur') ?? null;
    const verhuur = tags.includes('verhuur');
    const notitie = PODIUMPAS_NIET.test(detail.bodyText);
    const simonshaven = /simonshaven/i.test(detail.bodyText);

    for (const event of detail.events) {
      if (!event.startDate) continue;
      // schema.org eventStatus: Cancelled → afgelast, Postponed (nieuwe datum
      // nog niet bekend) → verplaatst. Bij Rescheduled is startDate al de
      // nieuwe datum: gewoon tonen. Tot 30 sep 2026 werden ze overgeslagen.
      const vervallen = /Cancelled/i.test(event.eventStatus ?? '')
        ? 'afgelast'
        : /Postponed/i.test(event.eventStatus ?? '')
          ? 'verplaatst'
          : null;
      const when = toAmsterdam(event.startDate);
      const [, mm, dd] = when.datum.split('-').map(Number);
      const row = detail.rows.find((r) => {
        const m = r.dateText?.match(DAG_MAAND);
        return m && Number(m[1]) === dd && MAANDEN.indexOf(m[2].toLowerCase()) + 1 === mm && (r.timeText ?? '').replace('.', ':').startsWith(when.tijd);
      });
      const offers = [].concat(event.offers ?? []);
      const prices = offers.map((o) => parseFloat(o.price)).filter((n) => Number.isFinite(n));
      const prijs = prices.length ? Math.min(...prices) : null;
      const knop = row?.knop ?? null;
      const geenVerkoop = /geen verkoop/i.test(knop ?? '') || offers.length === 0;
      const reason =
        (verhuur && 'verhuur') ||
        (geenVerkoop && 'geen verkoop (derden)') ||
        (notitie && 'podiumpas-notitie') ||
        (simonshaven && 'Simonshaven') ||
        (prijs == null && 'geen prijs') ||
        (prijs > PODIUMPAS_PRICE_CEILING && `prijs €${prijs}`) ||
        null;
      if (reason) reasons[reason] = (reasons[reason] ?? 0) + 1;

      const soldOut = offers.length > 0 && offers.every((o) => /SoldOut/i.test(o.availability ?? ''));
      shows.push({
        id: buildId(theater.id, detail.titel ?? event.name, when.datum, when.tijd),
        titel: detail.titel ?? event.name,
        theaterId: theater.id,
        theaterNaam: theater.naam,
        stad: theater.stad,
        podiumpas: theater.podiumpas && !reason,
        datum: when.datum,
        tijd: when.tijd,
        genre: normalizeGenre(genreTag),
        genreRuw: detail.tags.filter(Boolean).join(', ') || null,
        beschikbaarheid: vervallen ?? (soldOut ? 'uitverkocht' : classifyKnop(knop ?? (offers.length ? 'bestel kaarten' : null))),
        beschrijving: null,
        maker: detail.maker,
        prijs,
        reserverenUrl: offers.find((o) => o.url)?.url ?? detailUrl,
        bron: detailUrl,
        opgehaaldOp,
      });
    }
  }

  const reasonList = Object.entries(reasons);
  log(`podiumpas: false bij ${reasonList.reduce((n, [, c]) => n + c, 0)} voorstellingen (${reasonList.map(([r, c]) => `${r}: ${c}`).join(', ')})`);
  // Titelconventie cabaret (lib/titels.js): bij dit theater staat de artiest in de titel, voorstelling in het makerveld.
  return dedupeShows(shows).map((s) => pasTitelConventieToe(s, { artiest: s.titel, voorstelling: s.maker, makerWordtLeeg: true }));
}
