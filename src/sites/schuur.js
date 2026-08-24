import { createDutchAbbrevDayParser, extractTime, createIdBuilder } from '../lib/normalize.js';
import { normalizeGenre } from '../lib/genre.js';

const AGENDA_PATH = '/agenda';
// De site heeft eigen filter-tabs (Alles/Film/Theater/Dans) die via een
// simpele querystring werken (?wat=theater) — geen klik-interactie nodig.
// We halen Theater én Dans op (Film valt buiten scope, net als
// filmvertoningen bij andere theaters); overlap tussen de twee filters
// (bv. een circus-/dansvoorstelling die in beide tabs meetelt) deduplicaten
// we op basis van link + datum + tijd.
const FILTERS = ['theater', 'dans'];
const MAX_SCROLL_ATTEMPTS = 20;

/**
 * Haalt de volledige agenda van Schuur (Haarlem) op.
 *
 * Structuur (geïnspecteerd op https://www.schuur.nl/agenda, aug 2026):
 * - robots.txt: alleen /cpresources/, /vendor/, /.env, /cache/ verboden,
 *   geen crawl-delay.
 * - Client-side gerenderd, Tailwind-utility-classes-only (geen semantische
 *   hooks) — Playwright vereist, en net als bij Podium Mozaïek lezen we
 *   per kaart de kinderen van een vaste rij-container op vaste positie
 *   uit. Card-links zijn te vinden via `a:has(picture)` (elke kaart heeft
 *   een <picture>-thumbnail, en niets anders op de pagina heeft dat).
 * - Lazy-loaded via scroll (geen "load more"-knop, geen paginanummers) —
 *   we scrollen net zo lang tot het aantal kaarten niet meer toeneemt.
 * - Datumkoppen (<h3>, "Zo 23 aug" — weekdag-afkorting, dag, afgekorte
 *   maand, geen jaartal) staan als previousElementSibling van de
 *   rij-container die bij die datum hoort — elke rij daaronder krijgt dus
 *   de laatst geziene kop.
 * - Categorie (Theater, Jeugdtheater, Live muziek, Circustheater, Dans,
 *   Jeugddans, ...) staat als losse tekst op de rij, gebruiken we direct
 *   als genre.
 * - Geen boekingsstatussignaal op de kaart — beschikbaarheid blijft
 *   "onbekend".
 */
export async function scrapeSchuur({ page, theater, robots, waitForTurn, log }) {
  if (!robots.isAllowed(AGENDA_PATH)) {
    log(`robots.txt verbiedt ${AGENDA_PATH} op ${theater.baseUrl} — sla over.`);
    return [];
  }

  const seen = new Set();
  const buildId = createIdBuilder();
  const opgehaaldOp = new Date().toISOString();
  const shows = [];

  for (const filter of FILTERS) {
    await waitForTurn();
    const url = `${theater.agendaUrl}?wat=${filter}`;
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });

    // De site laadt verder via een htmx/Sprig-component met
    // s-trigger="revealed" (vuurt zodra het sentinel-element voor het eerst
    // in beeld komt). Blind naar de paginabodem scrollen + een vaste
    // wachttijd bleek onbetrouwbaar (soms stopte het al na 1-2 batches i.p.v.
    // door te laden tot het einde) — expliciet het sentinel-element in beeld
    // scrollen en op de bijbehorende netwerkresponse wachten is stabiel.
    for (let i = 0; i < MAX_SCROLL_ATTEMPTS; i++) {
      const sentinel = await page.$('[s-trigger="revealed"]');
      if (!sentinel) break;
      await sentinel.scrollIntoViewIfNeeded();
      try {
        await page.waitForResponse(
          (res) => res.url().includes('sprig-core/components/render') && res.url().includes('offset'),
          { timeout: 5000 }
        );
      } catch {
        break;
      }
      await page.waitForTimeout(200);
    }

    const items = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('a:has(picture)')).map((link) => {
        const row = link.parentElement;
        const group = row.parentElement;
        const header = group?.previousElementSibling;
        const dagTekst = header && header.tagName === 'H3' ? header.textContent.trim() : null;
        const contentDiv = row.children[2];
        const titel = contentDiv?.querySelector('h4')?.textContent.trim() ?? null;
        const tijdTekst = row.children[0]?.textContent.trim() ?? null;
        const categorieRaw = row.children[4]?.textContent.trim() || row.children[3]?.textContent.trim() || null;
        const beschrijving = contentDiv?.children[3]?.querySelector('span')?.textContent.trim() ?? null;
        return { href: link.getAttribute('href'), titel, dagTekst, tijdTekst, categorieRaw, beschrijving };
      });
    });

    log(`filter "${filter}": ${items.length} kaarten`);

    // Elke filter-pagina staat zelf chronologisch gesorteerd (van vandaag
    // vooruit), maar de twee filters staan niet per se chronologisch t.o.v.
    // elkaar — een eigen parser per filter voorkomt dat een jaar-rollover
    // uit de "theater"-lijst per ongeluk doorloopt in de "dans"-lijst
    // (zelfde soort fout als bij Scala/CC Amstel).
    const parseDay = createDutchAbbrevDayParser();
    for (const item of items) {
      if (!item.titel || !item.dagTekst || !item.href) continue;
      const dedupKey = `${item.href}|${item.dagTekst}|${item.tijdTekst}`;
      if (seen.has(dedupKey)) continue;
      seen.add(dedupKey);

      const datum = parseDay(item.dagTekst);
      if (!datum) {
        log(`kon datum niet parsen: "${item.dagTekst}" (${item.titel}) — overgeslagen.`);
        continue;
      }
      const tijd = extractTime(item.tijdTekst);
      const detailUrl = new URL(item.href, theater.baseUrl).toString();

      shows.push({
        id: buildId(theater.id, item.titel, datum, tijd),
        titel: item.titel,
        theaterId: theater.id,
        theaterNaam: theater.naam,
        stad: theater.stad,
        podiumpas: theater.podiumpas,
        datum,
        tijd,
        genre: normalizeGenre(item.categorieRaw),
        genreRuw: item.categorieRaw,
        beschikbaarheid: 'onbekend',
        beschrijving: item.beschrijving,
        reserverenUrl: detailUrl,
        bron: theater.agendaUrl,
        opgehaaldOp,
      });
    }
  }

  return shows;
}
