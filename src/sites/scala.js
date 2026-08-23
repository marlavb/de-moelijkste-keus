import { createIdBuilder } from '../lib/normalize.js';
import { normalizeGenre } from '../lib/genre.js';

const AGENDA_PATH = '/voorstellingen';

const MONTHS_ABBR = {
  jan: 1,
  feb: 2,
  mrt: 3,
  apr: 4,
  mei: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  sept: 9, // Scala's eigen datumlijsten wisselen zelf tussen "sep" en "sept"
  okt: 10,
  nov: 11,
  dec: 12,
};

function pad2(n) {
  return String(n).padStart(2, '0');
}

/**
 * Scala toont per productie één compacte, kommagescheiden lijst met alle
 * speeldata, bv. "21, 22, 28, 29 aug, 2, 3, 9 & 10 okt" — de maandnaam
 * staat pas ACHTER de dagen waar hij (terugwerkend) bij hoort, en er komt
 * geen jaartal in voor. Twee passes:
 * 1) rechts-naar-links: vul dag-only tokens aan met de eerstvolgende
 *    maand rechts ervan in de lijst.
 * 2) links-naar-rechts: ken een jaartal toe met dezelfde
 *    rollover-aanpak als de bestaande Dutch-datumparsers in
 *    normalize.js (jaar +1 zodra de maand terugspringt) — maar ELKE
 *    productie start dat rollover-jaar opnieuw vanaf "vandaag", in
 *    plaats van door te tellen vanaf waar de vorige productie op de
 *    pagina eindigde. De kaarten staan namelijk niet per se
 *    chronologisch t.o.v. elkaar (bv. sorteren op naam/populariteit),
 *    dus een gedeelde, doorlopende rollover-status zou bij een productie
 *    die toevallig met een eerdere maand begint dan de vorige productie
 *    eindigde, het jaartal onterecht ophogen — en dat effect stapelt zich
 *    op over de hele pagina.
 */
function parseDateList(raw, referenceDate) {
  const normalized = raw.replace(/\s*&\s*/g, ', ');
  const tokens = normalized
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);

  let knownMonth = null;
  const withMonths = new Array(tokens.length).fill(null);
  for (let i = tokens.length - 1; i >= 0; i--) {
    const match = tokens[i].match(/^(\d{1,2})(?:\s+([a-zé]+))?$/i);
    if (!match) continue;
    const day = parseInt(match[1], 10);
    const monthAbbr = match[2]?.toLowerCase();
    if (monthAbbr && MONTHS_ABBR[monthAbbr]) knownMonth = MONTHS_ABBR[monthAbbr];
    if (knownMonth) withMonths[i] = { day, month: knownMonth };
  }

  let year = referenceDate.getFullYear();
  let lastMonth = referenceDate.getMonth() + 1;
  const dates = [];
  for (const entry of withMonths) {
    if (!entry) continue;
    if (entry.month < lastMonth) year += 1;
    lastMonth = entry.month;
    dates.push(`${year}-${pad2(entry.month)}-${pad2(entry.day)}`);
  }
  return dates;
}

/**
 * Haalt de volledige agenda van Scala op.
 *
 * Structuur (geïnspecteerd op https://www.scala-amsterdam.nl/voorstellingen,
 * aug 2026):
 * - robots.txt staat "*" toe zonder crawl-delay (dotbot/AhrefsBot krijgen
 *   10s, maar dat is niet onze user-agent).
 * - Wix-site — de kale HTML bevat geen programma-inhoud, dus Playwright is
 *   vereist. networkidle loopt hier vast op Wix' eigen achtergrond-
 *   verkeer; domcontentloaded + een vaste wachttijd werkt wel.
 * - Alle 22 producties staan op één pagina (geen paginering/infinite
 *   scroll — geverifieerd door na te scrollen: het aantal kaarten
 *   verandert niet).
 * - Wix-componenten hebben geen bruikbare eigen class-namen; per kaart
 *   ([role="listitem"]) lezen we de 5 [data-testid="richTextElement"]
 *   op vaste positie uit: 0=gezelschap, 1=titel, 2=genre(+taal), 3=
 *   datumlijst, 4=beschrijving.
 * - Scala is een "kies zelf wat je ziet"-concept (meerdere losse
 *   20-minuten-voorstellingen per avond, geen vaste starttijd per
 *   voorstelling) — er staat dan ook nergens een tijd bij, dus tijd
 *   blijft null.
 * - Geen beschikbaarheids-/ticketstatussignaal op de agendapagina.
 *   "Tickets" linkt bovendien altijd naar dezelfde algemene
 *   /tickets-pagina (geen per-voorstelling of per-datum boeking), dus
 *   reserverenUrl wijst naar de eigen detailpagina van de productie.
 */
export async function scrapeScala({ page, theater, robots, waitForTurn, log }) {
  if (!robots.isAllowed(AGENDA_PATH)) {
    log(`robots.txt verbiedt ${AGENDA_PATH} op ${theater.baseUrl} — sla over.`);
    return [];
  }

  await waitForTurn();
  await page.goto(theater.agendaUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(4000);

  const rawItems = await page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll('[role="listitem"]'));
    return cards
      .map((card) => {
        const texts = Array.from(card.querySelectorAll('[data-testid="richTextElement"]')).map((el) =>
          el.textContent.trim()
        );
        const href = card.querySelector('a[href*="/voorstelling/"]')?.getAttribute('href') ?? null;
        if (!href || texts.length < 4) return null;
        const [, titel, genreLijn, datumLijst, beschrijving] = texts;
        return { href, titel, genreLijn, datumLijst, beschrijving: beschrijving ?? null };
      })
      .filter(Boolean);
  });

  log(`${rawItems.length} producties gevonden op de voorstellingenpagina`);

  const buildId = createIdBuilder();
  const opgehaaldOp = new Date().toISOString();
  const referenceDate = new Date();
  const shows = [];

  for (const item of rawItems) {
    if (!item.titel || !item.datumLijst) continue;
    const datums = parseDateList(item.datumLijst, referenceDate);
    if (datums.length === 0) {
      log(`kon datumlijst niet parsen: "${item.datumLijst}" (${item.titel}) — overgeslagen.`);
      continue;
    }

    const genreRuw = (item.genreLijn ?? '').split('|')[0].trim() || null;
    const detailUrl = new URL(item.href, theater.baseUrl).toString();

    for (const datum of datums) {
      shows.push({
        id: buildId(theater.id, item.titel, datum, null),
        titel: item.titel,
        theaterId: theater.id,
        theaterNaam: theater.naam,
        stad: theater.stad,
        podiumpas: theater.podiumpas,
        datum,
        tijd: null,
        genre: normalizeGenre(genreRuw),
        genreRuw,
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
