import { createIdBuilder } from '../lib/normalize.js';
import { normalizeGenre } from '../lib/genre.js';
import { pasTitelConventieToe } from '../lib/titels.js';

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
 * Sinds 9 okt 2026 ook maanden voluit ("21 november"), reeksen ("4 t/m 7 &
 * 11 t/m 14 november") en taalvlaggen ("🇳🇱 7, 8 oktober🇬🇧 9, 10 oktober"):
 * die 8 producties werden tot dan overgeslagen.
 */
export function parseDateList(raw, referenceDate) {
  // Opschonen (9 okt 2026): taalvlaggen weg ("🇳🇱  7, 8 oktober🇬🇧  9, 10
  // oktober"), een maand direct gevolgd door een dag wordt een scheiding, en
  // "&" telt als komma.
  const normalized = raw
    .replace(/[^\p{L}\p{N}\s,&/–-]/gu, ' ')
    .replace(/\b((?:jan|feb|mrt|maa|apr|mei|jun|jul|aug|sep|okt|nov|dec)[a-zé]*)\s+(\d)/gi, '$1, $2')
    .replace(/\s*&\s*/g, ', ');
  const tokens = normalized
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);

  // Een token is een dag of een reeks ("4 t/m 7", "25 t/m 29 november"),
  // met of zonder maand; maanden voluit of afgekort ("nov", "november").
  const maand = (w) => (w ? MONTHS_ABBR[w.toLowerCase()] ?? MONTHS_ABBR[w.toLowerCase().slice(0, 3)] ?? null : null);
  const TOKEN = /^(\d{1,2})(?:\s+([a-zé]+))?(?:\s*(?:t\/m|tot en met|–|-)\s*(\d{1,2})(?:\s+([a-zé]+))?)?$/i;
  let knownMonth = null;
  const withMonths = new Array(tokens.length).fill(null);
  for (let i = tokens.length - 1; i >= 0; i--) {
    const match = tokens[i].match(TOKEN);
    if (!match) continue;
    const [, van, m1, tot, m2] = match;
    const eindMaand = maand(m2) ?? (tot ? null : maand(m1));
    if (eindMaand) knownMonth = eindMaand;
    if (!knownMonth) continue;
    const beginMaand = tot ? maand(m1) ?? knownMonth : knownMonth;
    withMonths[i] = { van: parseInt(van, 10), beginMaand, tot: tot ? parseInt(tot, 10) : null, eindMaand: knownMonth };
    if (tot && maand(m1)) knownMonth = maand(m1);
  }

  let year = referenceDate.getFullYear();
  let lastMonth = referenceDate.getMonth() + 1;
  const dates = [];
  const voeg = (month, day) => {
    if (month < lastMonth) year += 1;
    lastMonth = month;
    dates.push(`${year}-${pad2(month)}-${pad2(day)}`);
  };
  for (const e of withMonths) {
    if (!e) continue;
    if (e.tot == null) {
      voeg(e.beginMaand, e.van);
      continue;
    }
    if (e.beginMaand === e.eindMaand) {
      for (let d = e.van; d <= e.tot; d++) voeg(e.beginMaand, d);
    } else {
      // Over de maandgrens ("30 okt t/m 2 nov").
      const jaar = e.beginMaand < lastMonth ? year + 1 : year;
      const laatste = new Date(Date.UTC(jaar, e.beginMaand, 0)).getUTCDate();
      for (let d = e.van; d <= laatste; d++) voeg(e.beginMaand, d);
      for (let d = 1; d <= e.tot; d++) voeg(e.eindMaand, d);
    }
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
 *   op vaste positie uit: 0=gezelschap (-> maker), 1=titel, 2=genre(+taal),
 *   3=datumlijst, 4=beschrijving.
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
        const [gezelschap, titel, genreLijn, datumLijst, beschrijving] = texts;
        return { href, titel, genreLijn, datumLijst, beschrijving: beschrijving ?? null, maker: gezelschap || null };
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
        maker: item.maker,
        reserverenUrl: detailUrl,
        bron: theater.agendaUrl,
        opgehaaldOp,
      });
    }
  }

  // Titelconventie cabaret (lib/titels.js): bij dit theater staat de voorstelling in de titel, artiest in het makerveld.
  return shows.map((s) => pasTitelConventieToe(s, { artiest: s.maker, voorstelling: s.titel, makerWordtLeeg: true }));
}
