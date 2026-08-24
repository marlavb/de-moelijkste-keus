import { createDutchAbbrevDayParser, extractTime, createIdBuilder } from '../lib/normalize.js';
import { normalizeGenreFromList } from '../lib/genre.js';

const AGENDA_PATH = '/agenda/programma';

// Podiumpas is bij Corrosia NIET gewoon aan-of-uit voor de hele locatie
// (zelfde soort geval als Bostheater/Aan de Slinger/Flint): hun eigen
// kaartverkooppagina zegt "Je Podiumpas is geldig voor onze reguliere
// theatervoorstellingen. Verhuringen, films of voorstellingen die te gast
// zijn, zijn uitgesloten." .soort bevat het volledige categorie-label van
// de kaart (bv. "Theater | Dans", "Theater | Jeugd", "Film | Op locatie",
// gewoon "Theater") — "theater" zit er alleen bij als de voorstelling ook
// echt onder de reguliere theaterprogrammering valt. Geverifieerd via de
// eigen Ticketmatic-boekingswidget van een "Theater | Dans"-voorstelling
// (Connor Schumacher, 3 nov): die toont een "Podiumpas €0,00"-prijstype
// naast de normale tarieven — dans telt hier dus wél mee, ondanks dat de
// kaartverkooppagina alleen verhuur/film/gast met naam noemt als
// uitsluiting. "Verhuur" en "Te gast" zijn niet als los .soort-label
// waargenomen (nu geen actieve verhuur-/gastvoorstelling in de agenda),
// maar checken we defensief mee mocht dat later wel zo zijn.
function isPodiumpasEligible(soort) {
  const tekst = (soort ?? '').toLowerCase();
  if (tekst.includes('verhuur') || tekst.includes('gast')) return false;
  return tekst.includes('theater');
}

/**
 * Haalt de volledige agenda van Corrosia (Almere Haven) op.
 *
 * Structuur (geïnspecteerd op https://www.corrosia.nl/agenda/programma,
 * aug 2026):
 * - robots.txt: /ajax/, /api/, /CFIDE/, /includes/, /spanz/,
 *   /vacatures/direct-solliciteren/, /track/, /css/, /js/ verboden, geen
 *   crawl-delay voor onze user-agent (alleen Bingbot heeft er een).
 * - Server-rendered. Er is een maandfilter (aug 2026 t/m jul 2027) maar
 *   die is puur client-side (javascript:void(0) + data-month) — alle ~46
 *   voorstellingen van het hele seizoen staan al in de eerste pageload,
 *   geen paginering nodig.
 * - Datum staat als platte tekst zonder jaartal, met afgekorte
 *   maandnaam ("vr 28 aug") — zelfde formaat als Theater Bellevue, dus
 *   createDutchAbbrevDayParser() werkt hier ook.
 * - .soort combineert hoofdcategorie en subgenre met een "|" (bv. "Theater
 *   | Dans"), of staat alleen als hoofdcategorie ("Theater", "Film"). Voor
 *   het genre-veld draaien we de volgorde om vóór normalizeGenreFromList()
 *   — anders zou "Theater | Dans" altijd op de generieke "Theater"-tag
 *   blijven hangen (die het eerst matcht) in plaats van op het specifiekere
 *   "Dans".
 * - Geen zichtbaar boekingsstatus-signaal op de kaart zelf (elke kaart
 *   toont gewoon "Koop kaarten", ook zonder dat we uitverkocht/wachtlijst
 *   kunnen bevestigen) — beschikbaarheid blijft daarom "onbekend", zelfde
 *   afweging als bij Karavaan.
 * - Boekingsknop is een JS-aanroep (javascript:openTicketing(...)), geen
 *   directe URL — reserverenUrl valt terug op de detailpagina.
 */
export async function scrapeCorrosia({ page, theater, robots, waitForTurn, log }) {
  if (!robots.isAllowed(AGENDA_PATH)) {
    log(`robots.txt verbiedt ${AGENDA_PATH} op ${theater.baseUrl} — sla over.`);
    return [];
  }

  await waitForTurn();
  await page.goto(theater.agendaUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

  const rawItems = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('.item-inner')).map((el) => {
      const titelLink = el.querySelector('.titel a');
      const titel = titelLink?.textContent.trim() ?? null;
      const detailHref = titelLink?.getAttribute('href') ?? null;
      const soort = el.querySelector('.soort')?.textContent.trim() ?? null;
      const dagTekst = el.querySelector('.itemdate')?.textContent.trim() ?? null;
      const tijdTekst = el.querySelector('.itemtime')?.textContent.trim() ?? null;
      const leadEl = el.querySelector('.lead');
      let beschrijving = null;
      if (leadEl) {
        const clone = leadEl.cloneNode(true);
        clone.querySelector('span')?.remove();
        beschrijving = clone.textContent.trim() || null;
      }
      return { titel, detailHref, soort, dagTekst, tijdTekst, beschrijving };
    });
  });

  log(`${rawItems.length} voorstellingen gevonden op de agendapagina`);

  const parseDay = createDutchAbbrevDayParser();
  const buildId = createIdBuilder();
  const opgehaaldOp = new Date().toISOString();
  const shows = [];

  for (const item of rawItems) {
    if (!item.titel || !item.dagTekst || !item.detailHref) continue;
    // Bijna elke datum gebruikt een 3-letter maandafkorting ("28 aug"),
    // maar een enkele kaart schrijft "juni"/"juli" voluit — normaliseer
    // die twee naar de afkorting die createDutchAbbrevDayParser() verwacht
    // (de andere maanden zijn als afkorting al even lang als voluit).
    const dagTekstGenormaliseerd = item.dagTekst.replace(/\bjuni\b/i, 'jun').replace(/\bjuli\b/i, 'jul');
    const datum = parseDay(dagTekstGenormaliseerd);
    if (!datum) {
      log(`kon datum niet parsen: "${item.dagTekst}" (${item.titel}) — overgeslagen.`);
      continue;
    }
    const tijd = extractTime(item.tijdTekst);
    const detailUrl = new URL(item.detailHref, theater.baseUrl).toString();
    const genreTags = (item.soort ?? '')
      .split('|')
      .map((t) => t.trim())
      .filter(Boolean)
      .reverse();

    shows.push({
      id: buildId(theater.id, item.titel, datum, tijd),
      titel: item.titel,
      theaterId: theater.id,
      theaterNaam: theater.naam,
      stad: theater.stad,
      podiumpas: isPodiumpasEligible(item.soort),
      datum,
      tijd,
      genre: normalizeGenreFromList(genreTags),
      genreRuw: item.soort,
      beschikbaarheid: 'onbekend',
      beschrijving: item.beschrijving,
      reserverenUrl: detailUrl,
      bron: theater.agendaUrl,
      opgehaaldOp,
    });
  }

  return shows;
}
