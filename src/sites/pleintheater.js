import { createDutchDayParser, extractTime, createIdBuilder } from '../lib/normalize.js';
import { normalizeGenre } from '../lib/genre.js';

const AGENDA_PATH = '/agenda';

// Deze site programmeert bewust breder dan alleen theater (het is ook een
// buurthuis/cultuurcentrum) — categorieën als markt, eten/keuken, workshops
// en film horen niet in een theateragenda thuis, dezelfde afweging als
// filmvertoningen die elders (Amstelveen, Omval) al worden uitgefilterd.
const EXCLUDED_CATEGORIES = new Set(['market', 'food, kitchen', 'workshop, class', 'film']);

function classifyBeschikbaarheid(ticketUrl, ticketsLabelText) {
  if (ticketUrl) return 'beschikbaar';
  if (/gratis|free/i.test(ticketsLabelText ?? '')) return 'beschikbaar';
  return 'onbekend';
}

/**
 * Haalt de volledige agenda van Plein Theater op.
 *
 * Structuur (geïnspecteerd op https://plein-theater.nl/agenda, aug 2026):
 * - robots.txt: "*" toegestaan, crawl-delay 5s.
 * - Client-side gerenderd — Playwright vereist.
 * - .agenda-list[data-agenda="default"] toont standaard de "Aankomend"-
 *   weergave: alle toekomstige items in één doorlopende, chronologische
 *   lijst (geverifieerd: scrollen laadt niets bij, alle ~39 items staan er
 *   al) — geen maand-voor-maand navigatie nodig ondanks de zichtbare
 *   maand-tabs (Augustus, September, ..., zelfs oude maanden als
 *   "Augustus (2025)") die in de UI staan.
 * - Platte lijst-structuur: losse <div class="header"> datumkopjes
 *   ("Zaterdag 29 Augustus", weekdag + dag + volledige maandnaam, geen
 *   jaartal) gevolgd door een of meer <a class="event">-kaarten, tot de
 *   volgende kop — elke kaart hoort dus bij de laatst geziene kop.
 * - Per kaart: categorie (.meta), titel (h2.title), aanvangstijd (het
 *   "Aanvang:"-label), en een directe externe boekingslink
 *   (.presale[data-url], een Stager.co-ticketshop-URL) — die ontbreekt bij
 *   gratis/geen-losse-kaartverkoop-items (dan staat er "gratis toegang" in
 *   het "Tickets:"-label in plaats daarvan).
 */
export async function scrapePleinTheater({ page, theater, robots, waitForTurn, log }) {
  if (!robots.isAllowed(AGENDA_PATH)) {
    log(`robots.txt verbiedt ${AGENDA_PATH} op ${theater.baseUrl} — sla over.`);
    return [];
  }

  await waitForTurn();
  await page.goto(theater.agendaUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForSelector('a.event', { timeout: 15000 }).catch(() => {});

  const rawItems = await page.evaluate(() => {
    const container = document.querySelector('.agenda-list[data-agenda="default"]');
    if (!container) return [];
    const results = [];
    let dagTekst = null;
    for (const child of container.children) {
      if (child.classList.contains('header')) {
        dagTekst = child.textContent.trim();
      } else if (child.matches('a.event')) {
        const categorie = child.querySelector('.meta')?.textContent.trim() ?? null;
        const titel = child.querySelector('h2.title')?.textContent.trim() ?? null;
        const rows = Array.from(child.querySelectorAll('section > div')).map((div) => ({
          label: div.querySelector('.label')?.textContent.trim().replace(/:$/, '') ?? null,
          value: div.textContent.replace(div.querySelector('.label')?.textContent ?? '', '').trim(),
        }));
        const tijdTekst = rows.find((r) => r.label === 'Aanvang')?.value ?? null;
        const beschrijving = rows.find((r) => r.label === 'Line-up')?.value ?? null;
        const ticketsLabelText = rows.find((r) => r.label === 'Tickets')?.value ?? null;
        const ticketUrl = child.querySelector('.presale')?.getAttribute('data-url') ?? null;
        const href = child.getAttribute('href');
        results.push({ dagTekst, categorie, titel, tijdTekst, beschrijving, ticketsLabelText, ticketUrl, href });
      }
    }
    return results;
  });

  const parseDay = createDutchDayParser();
  const buildId = createIdBuilder();
  const opgehaaldOp = new Date().toISOString();
  const shows = [];

  for (const item of rawItems) {
    if (!item.titel || !item.dagTekst) continue;
    const categorieKey = (item.categorie ?? '').trim().toLowerCase();
    if (EXCLUDED_CATEGORIES.has(categorieKey)) continue;

    const datum = parseDay(item.dagTekst);
    if (!datum) {
      log(`kon datum niet parsen: "${item.dagTekst}" (${item.titel}) — overgeslagen.`);
      continue;
    }
    const tijd = extractTime(item.tijdTekst);
    const detailUrl = item.href ? new URL(item.href, theater.baseUrl).toString() : theater.agendaUrl;

    shows.push({
      id: buildId(theater.id, item.titel, datum, tijd),
      titel: item.titel,
      theaterId: theater.id,
      theaterNaam: theater.naam,
      stad: theater.stad,
      podiumpas: theater.podiumpas,
      datum,
      tijd,
      genre: normalizeGenre(item.categorie),
      genreRuw: item.categorie,
      beschikbaarheid: classifyBeschikbaarheid(item.ticketUrl, item.ticketsLabelText),
      beschrijving: item.beschrijving,
      reserverenUrl: item.ticketUrl ?? detailUrl,
      bron: theater.agendaUrl,
      opgehaaldOp,
    });
  }

  return shows;
}
