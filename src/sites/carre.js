import { createIdBuilder } from '../lib/normalize.js';

const AGENDA_PATH = '/agenda';

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
 * - Individuele speeldata/tijden/beschikbaarheid zitten NIET op deze
 *   pagina: die staan achter een per-productie, per-maand
 *   kalenderwidget (Ticketmatic) op de detailpagina, wat losse
 *   interactie per maand zou vereisen. In overleg is besloten dat NIET te
 *   bouwen — vandaar: één rij per datumbereik, met de startdatum als
 *   `datum`, `tijd: null` en `beschikbaarheid: 'onbekend'`.
 * - Geen genre-indicatie gevonden op deze pagina — `genre` blijft null.
 */
export async function scrapeCarre({ page, theater, robots, waitForTurn, log }) {
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

  const buildId = createIdBuilder();
  const opgehaaldOp = new Date().toISOString();
  const shows = [];

  for (const item of rawItems) {
    if (!item.titel || !item.dateText || !item.href) continue;
    const datum = parseStartDate(item.dateText);
    if (!datum) {
      log(`kon datumbereik niet parsen: "${item.dateText}" (${item.titel}) — overgeslagen.`);
      continue;
    }
    const detailUrl = new URL(item.href, theater.baseUrl).toString();

    shows.push({
      id: buildId(theater.id, item.titel, datum, null),
      titel: item.titel,
      theaterId: theater.id,
      theaterNaam: theater.naam,
      stad: theater.stad,
      podiumpas: theater.podiumpas,
      datum,
      tijd: null,
      genre: null,
      genreRuw: null,
      beschikbaarheid: 'onbekend',
      beschrijving: item.subtitle,
      reserverenUrl: detailUrl,
      bron: theater.agendaUrl,
      opgehaaldOp,
    });
  }

  return shows;
}
