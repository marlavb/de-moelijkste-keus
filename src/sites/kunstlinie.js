import { extractTime, createIdBuilder } from '../lib/normalize.js';
import { normalizeGenreFromList } from '../lib/genre.js';

const AGENDA_PATH = '/programma/';
const MAX_PAGES = 15;

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

// "vr 28 aug '26 – 20:15" -> { datum: "2026-08-28", tijd: "20:15" }. Altijd
// een expliciet (2-cijferig) jaartal, dus geen rollover-logica nodig.
function parseDateTime(raw) {
  const match = raw?.match(/(\d{1,2})\s+([a-zA-Zé]+)\D+(\d{2})\D+(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const [, day, monthAbbr, yy, hour, minute] = match;
  const month = MONTHS_ABBR[monthAbbr.toLowerCase()];
  if (!month) return null;
  const year = 2000 + parseInt(yy, 10);
  return { datum: `${year}-${pad2(month)}-${pad2(parseInt(day, 10))}`, tijd: `${pad2(parseInt(hour, 10))}:${minute}` };
}

// Podiumpas is bij Kunstlinie NIET gedocumenteerd op een eigen infopagina
// (geen /podiumpas zoals bijna elk ander theater, en de praktische-info-
// pagina noemt het niet). Rechtstreeks bevestigd via de eigen Ticketmatic-
// boekingswidget van drie voorstellingen: een gewone "Theater"-getagde
// voorstelling (ICE) had wél Podiumpas-prijstypes (€0,00 per rang), terwijl
// zowel een "Externe programmering"-voorstelling (Deva Premal & Miten) als
// een "Zaal X"-voorstelling (Skengbattles X) GEEN Podiumpas-prijstype
// toonden — alleen reguliere/VIP-rangen resp. een "Early Bird"-tarief. Die
// twee categorieën zijn dus de uitsluiting, net zoals bijna elk ander
// theater in dit project een expliciete uitsluitingslijst heeft.
const PODIUMPAS_EXCLUDED_CATEGORIES = new Set(['externe programmering', 'zaal x']);

function isPodiumpasEligible(categories) {
  return !categories.some((c) => PODIUMPAS_EXCLUDED_CATEGORIES.has(c.trim().toLowerCase()));
}

function classifyBeschikbaarheid(buttonText) {
  const tekst = (buttonText ?? '').trim().toLowerCase();
  if (tekst.includes('wachtlijst')) return 'wachtlijst';
  if (tekst.includes('uitverkocht')) return 'uitverkocht';
  if (tekst.includes('tickets')) return 'beschikbaar';
  return 'onbekend';
}

/**
 * Haalt de volledige agenda van Kunstlinie (Almere) op.
 *
 * Structuur (geïnspecteerd op https://kunstlinie.nl/programma/, aug 2026):
 * - robots.txt: Disallow leeg (alles toegestaan) voor User-agent: *, met
 *   een Crawl-delay:10 die er los boven staat, vóór enige User-agent-regel
 *   — niet gekoppeld aan een group, dus onze robots.js-parser (bewust)
 *   negeert die en valt terug op de standaard-minimumvertraging.
 * - /tag/podiumpas/ (een archiefpagina die leek te suggereren dat er
 *   Podiumpas-getagde content bestaat) geeft een Cloudflare-blokkade bij
 *   een kale request — maar /programma/ zelf en losse voorstellings-
 *   pagina's laden wél gewoon via een echte browser (Playwright omzeilt de
 *   JS-challenge die curl niet kan). Podiumpas-dekking is uiteindelijk
 *   bevestigd via de boekingswidget zelf, zie isPodiumpasEligible()
 *   hierboven — niet via die tag-pagina.
 * - Site draait op FacetWP (WordPress-plugin) voor filteren én pagineren:
 *   ~244 voorstellingen over 9 pagina's van 30. Er is geen URL-parameter
 *   voor een paginanummer (puur AJAX) — we klikken daarom net zo vaak op
 *   de "Volgende »"-pagineerknop (.facetwp-page.next) tot die niet meer
 *   verschijnt, en wachten na elke klik tot de eerste kaart-titel
 *   verandert (in plaats van een vaste sleep, voor het geval een pagina
 *   een keer trager laadt).
 * - Elke kaart (.card-programma) toont zijn EIGEN exacte datum+tijd in één
 *   los tekstveld ("vr 28 aug '26 – 20:15", met jaartal) — dus geen
 *   detailpagina-bezoek nodig voor datum/tijd, in tegenstelling tot
 *   Bostheater/Corrosia. Categorieën (.categories .cat) geven zowel genre
 *   als podiumpas-uitsluiting — soms wel dubbel gerenderd (zelfde label
 *   tweemaal in de markup, bv. "Zaal X" tweemaal), dedupliceren we dus.
 * - De boekingsknop is meestal ".button-black.button-small", maar bij een
 *   deel van de kaarten (bv. "Zaal X"-clubavonden) is dat ".button-black
 *   .expanded" — precies dezelfde klassen als de infoknop ernaast, dus een
 *   class-gebaseerde selector kan daar de verkeerde link pakken, en een
 *   geannuleerde voorstelling heeft zelfs helemaal geen href (een
 *   "disabled"-knop met tekst "Geannuleerd"). De infolink is wél altijd
 *   herkenbaar aan zijn href (wijst naar kunstlinie.nl zelf) — de
 *   ticket-/statusknop is dan gewoon "de andere" .button-black-link in de
 *   kaart, ongeacht CSS-modifier of of hij een href heeft. Geannuleerde
 *   voorstellingen laten we op basis van die statustekst helemaal weg
 *   (zelfde afweging als "Afgelast" bij Aan de Slinger) i.p.v. ze met een
 *   vage "onbekend"-status te tonen.
 * - Bekende, kleine restbeperking: een enkele kaart mist zijn
 *   .categories-blok volledig in Kunstlinie's eigen markup (geen selector-
 *   fout aan onze kant, simpelweg geen categorie toegekend aan die
 *   specifieke datum-instantie) — genre/podiumpas vallen dan terug op
 *   respectievelijk null en true (want geen uitsluitingscategorie
 *   gevonden), ook als een andere datum van diezelfde reeks wél als
 *   podiumpas-uitgesloten categorie stond. We gokken hier bewust niet op
 *   basis van een andere kaart met dezelfde titel — te fragiel om op te
 *   bouwen.
 */
export async function scrapeKunstlinie({ page, theater, robots, waitForTurn, log }) {
  if (!robots.isAllowed(AGENDA_PATH)) {
    log(`robots.txt verbiedt ${AGENDA_PATH} op ${theater.baseUrl} — sla over.`);
    return [];
  }

  await waitForTurn();
  await page.goto(theater.agendaUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForSelector('.card-programma', { timeout: 15000 }).catch(() => {});

  const rawItems = [];
  for (let pageNum = 1; pageNum <= MAX_PAGES; pageNum++) {
    const pageCards = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('.card-programma')).map((card) => {
        // .cat komt bij sommige kaarten dubbel voor in Kunstlinie's eigen
        // markup (bv. "Zaal X" tweemaal) — dedupliceren voorkomt een
        // misleidende "Zaal X, Zaal X" genreRuw.
        const categories = [
          ...new Set(Array.from(card.querySelectorAll('.categories .cat')).map((c) => c.textContent.trim())),
        ];
        const titel = card.querySelector('h3')?.textContent.trim() ?? null;
        const beschrijving = card.querySelector('p.nbm.stm.small')?.textContent.trim() ?? null;
        const dateTimeTekst = card.querySelector('.uppercase.display-inline-block')?.textContent.trim() ?? null;
        // Niet elke kaart gebruikt dezelfde button-modifier-klasse voor de
        // ticketknop (meestal "button-small", maar sommige kaarten — bv.
        // Zaal X-avonden — gebruiken "expanded" voor ZOWEL de ticketknop
        // als de infoknop, en een geannuleerde voorstelling heeft een
        // "disabled"-knop zonder href) — een class- of href-gebaseerde
        // selector kan daardoor de verkeerde knop pakken of niets vinden.
        // De infolink is wél altijd herkenbaar (wijst naar kunstlinie.nl
        // zelf); de ticket-/statusknop is dan gewoon "de andere" knop.
        // Let op: de Ticketmatic-link bevat zelf een
        // "returnurl=...kunstlinie.nl..."-queryparameter, dus een simpele
        // href.includes('kunstlinie.nl') matcht per ongeluk ook DIE link —
        // vandaar de hostname-check via new URL() i.p.v. een substring-test.
        const links = Array.from(card.querySelectorAll('a.button.button-black'));
        const infoBtn = links.find((a) => {
          const href = a.getAttribute('href');
          if (!href) return false; // geannuleerde voorstelling: knop zonder href
          try {
            return new URL(href, location.href).hostname === 'kunstlinie.nl';
          } catch {
            return false;
          }
        });
        const ticketBtn = links.find((a) => a !== infoBtn);
        const ticketHref = ticketBtn?.getAttribute('href') ?? null;
        const ticketText = ticketBtn?.textContent.trim() ?? null;
        const detailHref = infoBtn?.getAttribute('href') ?? null;
        return { categories, titel, beschrijving, dateTimeTekst, ticketHref, ticketText, detailHref };
      });
    });
    log(`pagina ${pageNum}: ${pageCards.length} kaarten`);
    rawItems.push(...pageCards);

    const nextBtn = page.locator('.facetwp-page.next');
    if ((await nextBtn.count()) === 0) break;

    const firstTitleBefore = await page.locator('.card-programma h3').first().textContent().catch(() => null);
    await waitForTurn();
    await nextBtn.click();
    await page
      .waitForFunction(
        (prevTitle) => {
          const h3 = document.querySelector('.card-programma h3');
          return h3 && h3.textContent.trim() !== prevTitle;
        },
        firstTitleBefore,
        { timeout: 10000 }
      )
      .catch(() => {});
    await page.waitForTimeout(300);
  }

  log(`${rawItems.length} voorstellingen gevonden over alle pagina's`);

  const buildId = createIdBuilder();
  const opgehaaldOp = new Date().toISOString();
  const shows = [];

  for (const item of rawItems) {
    if (!item.titel || !item.dateTimeTekst || !item.detailHref) continue;
    // Geannuleerde voorstellingen (herkenbaar aan een "disabled"-knop met
    // tekst "Geannuleerd", geen href) laten we helemaal weg in plaats van
    // ze met een vage "onbekend"-status te tonen — zelfde afweging als
    // "Afgelast" bij Aan de Slinger.
    if (item.ticketText?.trim().toLowerCase() === 'geannuleerd') continue;
    const parsed = parseDateTime(item.dateTimeTekst);
    if (!parsed) {
      log(`kon datum/tijd niet parsen: "${item.dateTimeTekst}" (${item.titel}) — overgeslagen.`);
      continue;
    }
    const detailUrl = new URL(item.detailHref, theater.baseUrl).toString();
    const ticketUrl = item.ticketHref ? new URL(item.ticketHref, theater.baseUrl).toString() : null;

    shows.push({
      id: buildId(theater.id, item.titel, parsed.datum, parsed.tijd),
      titel: item.titel,
      theaterId: theater.id,
      theaterNaam: theater.naam,
      stad: theater.stad,
      podiumpas: isPodiumpasEligible(item.categories),
      datum: parsed.datum,
      tijd: parsed.tijd,
      genre: normalizeGenreFromList(item.categories),
      genreRuw: item.categories.join(', ') || null,
      beschikbaarheid: classifyBeschikbaarheid(item.ticketText),
      beschrijving: item.beschrijving,
      reserverenUrl: ticketUrl ?? detailUrl,
      bron: detailUrl,
      opgehaaldOp,
    });
  }

  return shows;
}
