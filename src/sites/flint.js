import { extractTime, createIdBuilder } from '../lib/normalize.js';
import { normalizeGenreFromList } from '../lib/genre.js';

const AGENDA_PATH = '/agenda/';
const PODIUMPAS_PRICE_CEILING = 50;

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
  okt: 10,
  nov: 11,
  dec: 12,
};

function pad2(n) {
  return String(n).padStart(2, '0');
}

// "31 aug 2026" -> "2026-08-31". Altijd een expliciet jaartal (in
// tegenstelling tot bijna elk ander theater in dit project), dus geen
// rollover-logica nodig — gewoon direct parsen.
function parseFlintDate(raw) {
  const match = raw?.trim().toLowerCase().match(/(\d{1,2})\s+([a-z]+)\s+(\d{4})/);
  if (!match) return null;
  const [, day, monthAbbr, year] = match;
  const month = MONTHS_ABBR[monthAbbr];
  if (!month) return null;
  return `${year}-${pad2(month)}-${pad2(parseInt(day, 10))}`;
}

// Probeert eerst de exacte prijs uit .price-list-item__price (bv. "€
// 21,50"), en valt anders terug op de tekst van het ticketblok — nodig
// voor twee vormen die geen .price-list-item opleveren: "Gratis" (staat
// alléén als knoptekst) en "Combinatieticket vanaf € 20,-" (een
// "vanaf"-prijs in de knop-subtekst, met een afwijkend format:
// komma-plus-streepje i.p.v. komma-plus-twee-cijfers — we nemen die
// laagste/instapprijs, want die valt al onder de podiumpas-drempel).
//
// BELANGRIJK: elk ticketblok bevat ook een vast "Extra kosten: € 1,-
// administratiekosten (...) met een maximum van € 5,- per bestelling"-
// zinnetje — dat staat er zelfs op voorstellingen zonder eigen
// prijsvermelding (bv. "Op uitnodiging", een festival-dagoverzicht zonder
// simpele hoofdprijs). Zonder de tekst bij "Extra kosten" af te kappen zou
// de fallback-regex die €1/€5-bedragen abusievelijk als de prijs van de
// voorstelling zelf lezen — precies fout-positief gebleken bij een eerste
// testrun (bv. een festival-dagkaart van €75 kreeg zo ten onrechte prijs:1
// en dus podiumpas:true). Dat maakt "Extra kosten" de harde grens: alles
// erna telt niet mee voor de prijs-fallback.
function parsePrice(priceText, fullBlockText) {
  if (priceText) {
    const match = priceText.match(/(\d+(?:\.\d+)?),(\d{2})/);
    if (match) {
      const [, whole, cents] = match;
      return parseFloat(`${whole.replace(/\./g, '')}.${cents}`);
    }
  }
  const text = (fullBlockText ?? '').split(/extra kosten/i)[0];
  if (/gratis/i.test(text)) return 0;
  const centsMatch = text.match(/€\s*(\d+(?:\.\d+)?),(\d{2})/);
  if (centsMatch) {
    const [, whole, cents] = centsMatch;
    return parseFloat(`${whole.replace(/\./g, '')}.${cents}`);
  }
  const dashMatch = text.match(/€\s*(\d+(?:\.\d+)?),-/);
  if (dashMatch) {
    return parseFloat(dashMatch[1].replace(/\./g, ''));
  }
  return null;
}

function classifyBeschikbaarheid(label) {
  const tekst = (label ?? '').trim().toLowerCase();
  if (!tekst) return 'onbekend';
  if (tekst.includes('wachtlijst')) return 'wachtlijst';
  if (tekst.includes('uitverkocht')) return 'uitverkocht';
  // "Save the date" (nog niet in verkoop) gaat niet over voorraad — zelfde
  // afweging als "binnenkort" bij Bellevue.
  if (tekst.includes('save the date')) return 'onbekend';
  return 'beschikbaar';
}

/**
 * Haalt de volledige agenda van Flint (Amersfoort) op.
 *
 * Structuur (geïnspecteerd op https://flint.nl/agenda/, aug 2026):
 * - Geen robots.txt (404 op zowel flint.nl als www.flint.nl) — geen
 *   restricties, standaard-minimum vertraging.
 * - Volledig client-side gerenderd (Ticketmatic-backend) — de kale HTML
 *   bevat geen programma-inhoud, Playwright met networkidle is hier dus
 *   een vereiste. Alle ~330 voorstellingen staan al in de eerste render,
 *   geen paginering/"laad meer" gevonden.
 * - Elke kaart is een <article class="agenda-item"> met een betrouwbare
 *   dataset: titel, volledige datum MET jaartal (".agenda-item__day-date",
 *   uniek in dit project — elders altijd rollover-gevoelig), tijd, locatie
 *   en een lijst tags (".agenda-item__tag[data-value]") die zowel het
 *   genre als bijzondere labels als "Te gast/ externe partij" bevat.
 * - Podiumpas is hier NIET gewoon aan-of-uit voor de hele locatie (zelfde
 *   soort geval als Bostheater, maar met een derde voorwaarde): flint.nl
 *   dekt Podiumpas voor "alle voorstellingen en rangen onder de €50,00",
 *   met drie uitsluitingen — (1) "Te gast/ externe partij"-producties, (2)
 *   voorstellingen in het ICOONtheater (hun tweede, kleinere zaal), en (3)
 *   een prijs van €50 of hoger. (1) en (2) staan al op de kaart zelf; (3)
 *   staat alleen op de detailpagina (".js-ticket-bar-target
 *   .price-list-item__price") — die bezoeken we daarom alléén voor kaarten
 *   die al niet door (1) of (2) zijn afgevallen, om onnodige requests te
 *   besparen (zonder die optimalisatie zou elke kaart een detailbezoek
 *   kosten). Ter bevestiging: de detailpagina van een "Te gast"-productie
 *   bevat letterlijk de zin "Deze voorstelling valt daarom niet onder de
 *   regeling met Podiumpas" — die zin staat NIET op ICOONtheater- of
 *   prijs-uitgesloten voorstellingen, dus is alleen een bevestiging van
 *   voorwaarde (1), geen vervanging voor de andere twee checks.
 * - Prijs staat meestal als "€ 21,50" in .price-list-item__price, maar
 *   twee varianten leveren dat element NIET op en hebben een eigen
 *   fallback nodig (zie parsePrice() hierboven voor de "Extra kosten"-val
 *   die daarbij om de hoek kwam kijken): "Gratis" toegang staat alléén als
 *   knoptekst, en een "Combinatieticket vanaf € 20,-"-vermelding gebruikt
 *   zowel een andere plek (de knop-subtekst) als een ander prijsformat
 *   (komma-streepje i.p.v. komma-plus-twee-cijfers). We pakken steeds het
 *   EERSTE ".js-ticket-bar-target"-blok (er is altijd een tweede, verborgen
 *   duplicaat voor een sticky mobiele balk, met identieke inhoud). Kon een
 *   niet-uitgesloten voorstelling ook ná deze fallbacks geen bruikbare
 *   prijs opleveren (bv. "Externe verkoop" zonder eigen prijsvermelding,
 *   "Op uitnodiging", een festival-dagkaart-overzicht zonder simpele
 *   hoofdprijs), dan
 *   loggen we dat expliciet en zetten podiumpas defensief op false — een
 *   fout-positieve badge hier is erger dan een gemiste, en dit precieze
 *   scenario (een wankel signaal negeren i.p.v. het te melden) is precies
 *   de Bostheater-fout die we al eerder hebben moeten repareren.
 * - Bewuste keuze: alleen het ICOONtheater is uitgesloten, zoals expliciet
 *   genoemd op flint.nl's eigen podiumpas-pagina. Flint's locatiefilter
 *   heeft nog vijf andere niet-Flint-adressen (Sint Aegtenkapel, De Lieve
 *   Vrouw, Speeltuin Kruiskamp, Veerensmederij, "Uit eigen stad") die soms
 *   voorstellingen van ándere organisaties doorplaatsen (één zo'n
 *   voorstelling noemde expliciet "valt onder de programmering van De
 *   Lieve Vrouw") — maar omdat de podiumpas-pagina alleen ICOONtheater met
 *   naam uitsluit, breiden we die uitsluiting niet zelf uit naar de andere
 *   locaties. Zulke voorstellingen komen doorgaans toch al niet door de
 *   prijs-fallbacks heen (geen eigen prijs, "Externe verkoop") en eindigen
 *   dus meestal al defensief op podiumpas:false.
 * - Nieuw schemaveld `prijs` (nummer of null) — alleen Flint vult dit,
 *   elk ander theater laat het op null staan (zelfde soort optioneel veld
 *   als `genre`).
 * - Boekingslink: voor kaarten waar we toch al de detailpagina bezoeken
 *   (voor de prijs) pakken we ook de echte Ticketmatic-link
 *   (".ticket-info__button a") — voor uitgesloten kaarten (waar we geen
 *   detailpagina bezoeken) valt reserverenUrl terug op de detailpagina-URL
 *   zelf, net als bij Karavaan.
 */
export async function scrapeFlint({ page, theater, robots, waitForTurn, log }) {
  if (!robots.isAllowed(AGENDA_PATH)) {
    log(`robots.txt verbiedt ${AGENDA_PATH} op ${theater.baseUrl} — sla over.`);
    return [];
  }

  await waitForTurn();
  await page.goto(theater.agendaUrl, { waitUntil: 'networkidle', timeout: 45000 });

  const rawCards = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('article.agenda-item')).map((card) => {
      const titel = card.querySelector('.agenda-item__title-main')?.textContent.trim() ?? null;
      const subtitel = card.querySelector('.agenda-item__title-sub')?.textContent.trim() ?? null;
      const dagTekst = card.querySelector('.agenda-item__day-date')?.textContent.trim() ?? null;
      const tijdTekst = card.querySelector('.agenda-item__time')?.textContent.trim() ?? null;
      const locatie = card.querySelector('.agenda-item__location')?.textContent.trim() ?? null;
      // flint.nl dubbel-encodeert "&" in sommige tags (bronbestand bevat
      // letterlijk "&amp;amp;"), waardoor zowel data-value als textContent
      // hier nog een resterende "&amp;"-tekstfragment overhouden na de ene
      // decodeerslag die de browser al doet — die decoderen we handmatig af.
      const tags = Array.from(card.querySelectorAll('.agenda-item__tag')).map((t) =>
        (t.getAttribute('data-value') ?? t.textContent).replace(/&amp;/g, '&').trim()
      );
      const label = card.querySelector('.agenda-item__label')?.textContent.trim() ?? null;
      const detailHref =
        card.querySelector('a.featured__item_link-hr')?.getAttribute('href') ??
        card.closest('.featured__item_link')?.querySelector('a')?.getAttribute('href') ??
        null;
      return { titel, subtitel, dagTekst, tijdTekst, locatie, tags, label, detailHref };
    });
  });

  log(`${rawCards.length} kaarten gevonden op de agendapagina`);

  const buildId = createIdBuilder();
  const opgehaaldOp = new Date().toISOString();
  const shows = [];

  for (const card of rawCards) {
    if (!card.titel || !card.dagTekst || !card.detailHref) continue;

    const datum = parseFlintDate(card.dagTekst);
    if (!datum) {
      log(`kon datum niet parsen: "${card.dagTekst}" (${card.titel}) — overgeslagen.`);
      continue;
    }
    const tijd = extractTime(card.tijdTekst);
    const detailUrl = new URL(card.detailHref, theater.baseUrl).toString();

    const isGuestProduction = card.tags.some((t) => t.toLowerCase().includes('te gast'));
    const isIcoontheater = card.locatie?.trim().toLowerCase() === 'icoontheater';

    let podiumpas = false;
    let prijs = null;
    let ticketUrl = null;

    if (isGuestProduction || isIcoontheater) {
      podiumpas = false;
    } else {
      const detailPath = new URL(detailUrl).pathname;
      if (!robots.isAllowed(detailPath)) {
        log(`robots.txt verbiedt ${detailPath} — prijs voor "${card.titel}" niet opgehaald, podiumpas defensief false.`);
      } else {
        await waitForTurn();
        try {
          await page.goto(detailUrl, { waitUntil: 'networkidle', timeout: 45000 });
          const detail = await page.evaluate(() => {
            const block = document.querySelector('.js-ticket-bar-target');
            const priceText = block?.querySelector('.price-list-item__price')?.textContent.trim() ?? null;
            const fullBlockText = block?.textContent.trim() ?? null;
            const ticketHref = block?.querySelector('.ticket-info__button a')?.getAttribute('href') ?? null;
            return { priceText, fullBlockText, ticketHref };
          });
          prijs = parsePrice(detail.priceText, detail.fullBlockText);
          ticketUrl = detail.ticketHref;
          if (prijs == null) {
            log(`geen bruikbare prijs gevonden op ${detailUrl} ("${detail.priceText}") — podiumpas defensief false.`);
            podiumpas = false;
          } else {
            podiumpas = prijs < PODIUMPAS_PRICE_CEILING;
          }
        } catch (err) {
          log(`kon detailpagina niet laden voor "${card.titel}" (${detailUrl}): ${err.message} — podiumpas defensief false.`);
        }
      }
    }

    shows.push({
      id: buildId(theater.id, card.titel, datum, tijd),
      titel: card.titel,
      theaterId: theater.id,
      theaterNaam: theater.naam,
      stad: theater.stad,
      podiumpas,
      datum,
      tijd,
      genre: normalizeGenreFromList(card.tags),
      genreRuw: card.tags.join(', ') || null,
      beschikbaarheid: classifyBeschikbaarheid(card.label),
      beschrijving: card.subtitel,
      prijs,
      reserverenUrl: ticketUrl ?? detailUrl,
      bron: detailUrl,
      opgehaaldOp,
    });
  }

  return shows;
}
