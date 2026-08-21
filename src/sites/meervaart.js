import { createDutchAbbrevDayParser, extractTime, createIdBuilder } from '../lib/normalize.js';
import { normalizeGenre } from '../lib/genre.js';

const AGENDA_PATH = '/agenda';
const MAX_LOAD_MORE_CLICKS = 30;
// Matcht rijen als "vr 21 aug - 20:15" (weekdag-afkorting, dag, maand-afkorting,
// optioneel tijd). Combinatieticket/passe-partout-rijen op de detailpagina
// hebben geen span in dit formaat en vallen hier vanzelf buiten.
const DATE_ROW_PATTERN = /^[a-z]{2}\s\d{1,2}\s[a-zé]+(\s-\s\d{1,2}:\d{2})?$/i;

/**
 * Haalt de volledige agenda van De Meervaart op.
 *
 * Structuur (geïnspecteerd op https://meervaart.nl/agenda, aug 2026):
 * - De site is een Phoenix LiveView app. De agendapagina toont kaarten
 *   (<article> binnen <main>) met titel, subtitel/gezelschap, beschrijving,
 *   genre-tags en 1-2 datum-"chips" (bv. "vr 21 aug" / "za 22 aug") — maar
 *   geen tijd en geen directe ticketlink. De knop op de kaart ("Bestel
 *   kaarten" / "Laatste kaarten" / "Uitverkocht" / "Gratis") linkt altijd
 *   naar de detailpagina, nooit rechtstreeks naar een reservering.
 *   Extra kaarten worden bijgeladen via een "Meer voorstellingen"-knop
 *   (phx-click, geen aparte pagina's).
 * - De detailpagina (/agenda/<slug>) bevat een prijs/ticket-box met per
 *   individuele voorstelling een rij: datum+tijd (span.h6) en een knop.
 *   Bij beschikbare kaarten is dat een <a href="/agenda/<slug>/bestel/...">
 *   (directe reservering op meervaart.nl zelf); bij uitverkocht is het een
 *   disabled <button> zonder link. Diezelfde box kan ook combinatieticket-
 *   /passe-partout-rijen bevatten (geen show, geen eigen datum) — die worden
 *   genegeerd omdat ze niet matchen op het datum-rij-patroon.
 *   Om altijd de losse datums+tijden+ticketlinks te pakken, bezoeken we voor
 *   élke productie de detailpagina, net als bij Bellevue.
 */
export async function scrapeMeervaart({ page, theater, robots, waitForTurn, log }) {
  if (!robots.isAllowed(AGENDA_PATH)) {
    log(`robots.txt verbiedt ${AGENDA_PATH} op ${theater.baseUrl} — sla over.`);
    return [];
  }

  await waitForTurn();
  // networkidle (i.p.v. domcontentloaded) omdat de "Meer voorstellingen"-knop
  // pas werkt nadat de LiveView-websocket is opgezet en de client-side JS
  // is gehydrateerd.
  await page.goto(theater.agendaUrl, { waitUntil: 'networkidle', timeout: 30000 });

  let previousCount = -1;
  for (let i = 0; i < MAX_LOAD_MORE_CLICKS; i++) {
    const count = await page.locator('main article').count();
    if (count === previousCount) break;
    previousCount = count;

    const moreButton = page.locator('button:has-text("Meer voorstellingen")');
    const visible = await moreButton.isVisible().catch(() => false);
    if (!visible) break;

    await waitForTurn();
    // De LiveView-klik komt af en toe niet aan (websocket-race) — retry een
    // paar keer voordat we concluderen dat er echt niets bijkomt.
    let grew = false;
    for (let attempt = 0; attempt < 3 && !grew; attempt++) {
      await moreButton.click().catch(() => {});
      grew = await page
        .locator('main article')
        .nth(previousCount)
        .waitFor({ state: 'attached', timeout: 5000 })
        .then(() => true)
        .catch(() => false);
    }
    if (!grew) {
      log(`"Meer voorstellingen" leverde na 3 pogingen geen nieuwe kaarten op — stop met laden.`);
      break;
    }
  }

  const cards = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('main article')).map((card) => {
      const titel = card.querySelector('h3')?.textContent.trim() ?? null;
      const beschrijving = card.querySelector('.py-xs.leading-6')?.textContent.trim() ?? null;
      const detailHref = card.querySelector('a[href^="/agenda/"]')?.getAttribute('href') ?? null;
      const genre = card.querySelector('.flex.flex-wrap.gap-2xs > div')?.textContent.trim() ?? null;
      return { titel, beschrijving, detailHref, genre };
    });
  });

  log(`${cards.length} producties gevonden op de agendapagina`);

  const buildId = createIdBuilder();
  const opgehaaldOp = new Date().toISOString();
  const shows = [];

  for (const card of cards) {
    if (!card.titel || !card.detailHref) continue;
    const detailUrl = new URL(card.detailHref, theater.baseUrl).toString();
    const detailPath = new URL(detailUrl).pathname;

    if (!robots.isAllowed(detailPath)) {
      log(`robots.txt verbiedt ${detailPath} — "${card.titel}" overgeslagen.`);
      continue;
    }

    await waitForTurn();
    let rows;
    try {
      await page.goto(detailUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      rows = await page.evaluate((patternSrc) => {
        // Scope tot de prijs/ticket-box (.post-it met een h1) van déze productie.
        // De pagina toont onderaan ook "Anderen bekeken ook"-kaarten met hun
        // eigen datum-chips in hetzelfde span.h6-formaat — die staan buiten
        // .post-it en mogen niet worden meegenomen.
        const ticketBox = Array.from(document.querySelectorAll('.post-it')).find((box) =>
          box.querySelector('h1')
        );
        if (!ticketBox) return [];
        const pattern = new RegExp(patternSrc, 'i');
        return Array.from(ticketBox.querySelectorAll('span.h6'))
          .filter((el) => pattern.test(el.textContent.trim()))
          .map((el) => {
            const row = el.closest('div.flex.justify-between');
            const href = row?.querySelector('a[href]')?.getAttribute('href') ?? null;
            return { tekst: el.textContent.trim(), href };
          });
      }, DATE_ROW_PATTERN.source);
    } catch (err) {
      log(`kon detailpagina niet laden voor "${card.titel}" (${detailUrl}): ${err.message} — overgeslagen.`);
      continue;
    }

    const parseDay = createDutchAbbrevDayParser();
    for (const row of rows) {
      const datum = parseDay(row.tekst);
      if (!datum) {
        log(`kon datum-label niet parsen: "${row.tekst}" (${card.titel}) — overgeslagen.`);
        continue;
      }
      const tijd = extractTime(row.tekst);
      const ticketUrl = row.href ? new URL(row.href, theater.baseUrl).toString() : detailUrl;

      shows.push({
        id: buildId(theater.id, card.titel, datum, tijd),
        titel: card.titel,
        theaterId: theater.id,
        theaterNaam: theater.naam,
        stad: theater.stad,
        datum,
        tijd,
        genre: normalizeGenre(card.genre),
        genreRuw: card.genre,
        beschrijving: card.beschrijving,
        reserverenUrl: ticketUrl,
        bron: detailUrl,
        opgehaaldOp,
      });
    }
  }

  return shows;
}
