import { createDutchDayParser, extractTime, createIdBuilder } from '../lib/normalize.js';
import { normalizeGenreFromList } from '../lib/genre.js';

const AGENDA_PATH = '/programma';

// Podiumpas geldt bij Aan de Slinger voor de "reguliere theatervoorstellingen"
// — hun eigen podiumpas-pagina sluit expliciet "Verhuringen, films of
// gastvoorstellingen" uit. Verhuur komt niet voor als los agenda-item (de
// enige verhuur-gerelateerde kaart is een permanente "Huur onze zaal"-tegel
// zonder datum, die toch al wordt weggefilterd), dus in de praktijk is dit
// een check op de eerste (belangrijkste) tag van elke kaart.
const PODIUMPAS_EXCLUDED_TAGS = new Set(['film', 'gastbespeling']);

function classifyBeschikbaarheid(soldOut, message) {
  const tekst = (message ?? '').trim().toLowerCase();
  if (soldOut && tekst.includes('uitverkocht')) return 'uitverkocht';
  if (tekst.includes('wachtlijst')) return 'wachtlijst';
  return 'onbekend';
}

/**
 * Haalt de volledige agenda van Aan de Slinger op.
 *
 * Structuur (geïnspecteerd op https://www.aandeslinger.nl/programma, aug
 * 2026):
 * - robots.txt: /views/, /mvc/, /stats/, /cgi-bin/, /test/, /controls/
 *   verboden (zelfde sjabloon als Podium Hoge Woerd, kennelijk dezelfde
 *   CMS-leverancier), geen crawl-delay. Niets daarvan raakt /programma zelf.
 * - Server-rendered, en — in tegenstelling tot Hoge Woerd — de HELE
 *   resterende speelseizoen (tot mei 2027) staat al in één pageload, geen
 *   paginering of "laad meer" nodig.
 * - Elke kaart is een <div class="program-item">, met een <ul class="tags
 *   clearfix"> van één of meer labels. Het EERSTE label is de
 *   hoofdcategorie (Cabaret/Muziek/Toneel/Jeugd/Dans/Special/Houten
 *   presenteert/Gastbespeling/Film/Cursus); een eventueel tweede label
 *   ("try-out / jong talent", "Inleiding", ...) is geen genre en wordt door
 *   normalizeGenreFromList() vanzelf overgeslagen.
 * - Twee soorten kaarten horen niet in de output:
 *   1. "Cursus"-getagde kaarten (Theaterschool-lessen als "TS - Theaterklas
 *      6-8 (maandag) - 2026") — geen publieksvoorstelling, zelfde soort
 *      filtering als Bostheater's randprogrammering.
 *   2. Een permanente promotiekaart ("Huur onze zaal") zonder <ul class=
 *      "tags"> én zonder <div class="datetime"> — geen voorstelling, geen
 *      datum om op te filteren.
 * - Datum staat als platte Nederlandse tekst zonder jaartal ("Zaterdag 19
 *   september") — zelfde formaat als DeLaMar/Theater Kikker, dus
 *   createDutchDayParser() werkt hier ook, chronologisch over de hele (al
 *   op datum gesorteerde) lijst.
 * - Beschikbaarheid: alleen "Uitverkocht" is zichtbaar op de kaart zelf
 *   (class "sold-out" + tekst in .message) — anders blijft het "onbekend",
 *   er is geen "Bestel"-signaal op de lijstpagina zelf (zelfde afweging als
 *   Karavaan). We hebben ook "Afgelast" (geannuleerd) live in de data
 *   gezien — die kaarten laten we helemaal weg (net als Cursus) in plaats
 *   van ze als "onbekend" te tonen: een geannuleerde voorstelling is geen
 *   voorstelling meer om te boeken.
 * - Geen los boekingslinkje op de kaart — reserverenUrl valt terug op de
 *   detailpagina, zelfde patroon als Karavaan. Dat scheelt ~165 extra
 *   detailpagina-bezoeken (elke detailpagina heeft wél een directe
 *   Active Tickets-link, maar de tijdswinst van deze al snelste theater in
 *   deze batch weegt zwaarder dan dat kleine verschil).
 */
export async function scrapeAanDeSlinger({ page, theater, robots, waitForTurn, log }) {
  if (!robots.isAllowed(AGENDA_PATH)) {
    log(`robots.txt verbiedt ${AGENDA_PATH} op ${theater.baseUrl} — sla over.`);
    return [];
  }

  await waitForTurn();
  await page.goto(theater.agendaUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

  const rawItems = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('.program-item')).map((el) => {
      const tags = Array.from(el.querySelectorAll('.tags li')).map((li) => li.textContent.trim());
      const titel = el.querySelector('.title')?.textContent.trim() ?? null;
      const beschrijving = el.querySelector('.subtitle')?.textContent.trim() ?? null;
      const detailHref = el.querySelector('a')?.getAttribute('href') ?? null;
      const dagTekst = el.querySelector('.datetime .date')?.textContent.trim() ?? null;
      const tijdTekst = el.querySelector('.datetime .time')?.textContent.trim() ?? null;
      const soldOut = el.classList.contains('sold-out');
      const message = el.querySelector('.message')?.textContent.trim() ?? null;
      return { tags, titel, beschrijving, detailHref, dagTekst, tijdTekst, soldOut, message };
    });
  });

  log(`${rawItems.length} kaarten gevonden op de programmapagina`);

  const relevantItems = rawItems.filter((item) => {
    if (!item.titel || !item.dagTekst) return false; // promotiekaarten zonder datum
    const firstTag = item.tags[0]?.trim().toLowerCase();
    if (firstTag === 'cursus') return false;
    if (item.message?.trim().toLowerCase() === 'afgelast') return false;
    return true;
  });

  const parseDay = createDutchDayParser();
  const buildId = createIdBuilder();
  const opgehaaldOp = new Date().toISOString();
  const shows = [];

  for (const item of relevantItems) {
    const datum = parseDay(item.dagTekst);
    if (!datum) {
      log(`kon datum-label niet parsen: "${item.dagTekst}" (${item.titel}) — overgeslagen.`);
      continue;
    }
    const tijd = extractTime(item.tijdTekst);
    const detailUrl = item.detailHref ? new URL(item.detailHref, theater.baseUrl).toString() : theater.agendaUrl;
    const firstTag = item.tags[0]?.trim().toLowerCase();

    shows.push({
      id: buildId(theater.id, item.titel, datum, tijd),
      titel: item.titel,
      theaterId: theater.id,
      theaterNaam: theater.naam,
      stad: theater.stad,
      podiumpas: !PODIUMPAS_EXCLUDED_TAGS.has(firstTag),
      datum,
      tijd,
      genre: normalizeGenreFromList(item.tags),
      genreRuw: item.tags.join(', ') || null,
      beschikbaarheid: classifyBeschikbaarheid(item.soldOut, item.message),
      beschrijving: item.beschrijving,
      reserverenUrl: detailUrl,
      bron: theater.agendaUrl,
      opgehaaldOp,
    });
  }

  return shows;
}
