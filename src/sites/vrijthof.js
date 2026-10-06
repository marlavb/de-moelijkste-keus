import { createIdBuilder } from '../lib/normalize.js';
import { normalizeGenreFromList, isBekendGenre } from '../lib/genre.js';
import { pasTitelConventieToe, isWervend, metEnDash } from '../lib/titels.js';
import { createGroupScraper } from '../lib/peppered.js';
import { blokkeerZwareBronnen } from '../lib/zwareBronnen.js';
import { gaNaar } from '../lib/diagnose.js';
import { THEATERS } from '../lib/config.js';

const AGENDA_PATH = '/voorstellingen';
const HITS_PER_PAGINA = 1000;
const MAX_PAGINAS = 3;

// Datum/tijd in Nederlandse tijd uit een unix-tijd (seconden).
const AMS = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Amsterdam', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});
export function unixNaarAmsterdam(sec) {
  const p = Object.fromEntries(AMS.formatToParts(new Date(sec * 1000)).map((x) => [x.type, x.value]));
  return { datum: `${p.year}-${p.month}-${p.day}`, tijd: `${p.hour}:${p.minute}` };
}

/** De Algolia-instellingen uit de pagina (JavaScriptData), of null. */
export function leesAlgoliaConfig(html) {
  const app = String(html).match(/"applicationId":"([A-Z0-9]+)"/)?.[1];
  const sleutel = String(html).match(/"searchApiKey":"([a-f0-9]+)"/)?.[1];
  const index = String(html).match(/"eventIndexName":"([\w-]+)"/)?.[1];
  return app && sleutel && index ? { app, sleutel, index } : null;
}

// Geen voorstelling, of geen voorstelling in Maastricht (zie
// debug/limburg-2-inventarisatie.md §2.1): theater- en busreizen (ook naar
// PLT, die staan al bij PLT zelf), arrangementen, openbare repetities,
// workshops en meedansen, installaties.
const GEEN_VOORSTELLING = /\b(theaterreis|busreis|terrasarrangement|openbare repetitie|workshop|dansen met|danscaf[eé]|video installatie)\b/i;
const BUITEN_MAASTRICHT = /\b(PLT|Heerlen|Kerkrade|Sittard|Landgraaf|Grathem|Hasselt|Luik|Li[eè]ge)\b/i;
const REEKS_WEG = new Set(['Bewogen publiek']);

/** Theater (config-id) en locatie voor een Algolia-hit, of null = weglaten. */
export function plaatsVoorHit(hit) {
  const loc = String(hit.eventLocations ?? '').trim();
  const extra = String(hit.eventLocationAddition ?? '').trim() || null;
  if (BUITEN_MAASTRICHT.test(`${loc} ${extra ?? ''}`)) return null;
  if (/^AINSI\b/i.test(loc)) return { theaterId: 'ainsi', locatie: null };
  if (/^Theater aan het Vrijthof\b/i.test(loc)) return { theaterId: 'vrijthof', locatie: null };
  if (/^Overige locaties$/i.test(loc)) {
    // "Theatercafé" en de foyers zijn ruimtes in het theater zelf.
    if (!extra || /theatercaf|foyer/i.test(extra)) return { theaterId: 'vrijthof', locatie: null };
    return { theaterId: 'vrijthof', locatie: `${extra} | Maastricht` };
  }
  return { theaterId: 'vrijthof', locatie: loc ? `${loc} | Maastricht` : null };
}

// Een tagline vooraan ("Een over de top musical - Titanique", "Naar het boek
// van Saskia Noort - De Verbouwing") of een cast vooraan ("Waldemar
// Torenstra, Judith Noyons e.a. - Nora").
const TAGLINE = /^(een\s|naar (het|de) (boek|roman)\b|['’]s\s)/i;
const CAST = /\be\.a\.$/i;

/**
 * Voorstelling en maker uit `company` en `name`: de titel is altijd
 * "company - name", maar welk deel de voorstelling is, wisselt (inventarisatie
 * §2.1). Meestal company = voorstelling; `switchCompanyTitle` leeg = andersom.
 */
export function voorstellingEnMaker(hit) {
  let eerste = String(hit.company ?? '').trim();
  let tweede = String(hit.name ?? '').trim();
  if (!hit.switchCompanyTitle) [eerste, tweede] = [tweede, eerste];
  if (!eerste) return { voorstelling: tweede, maker: null, beschrijving: null };
  if (!tweede) return { voorstelling: eerste, maker: null, beschrijving: null };
  if ((TAGLINE.test(eerste) && eerste.split(/\s+/).length >= 4) || isWervend(eerste)) {
    return { voorstelling: tweede, maker: null, beschrijving: eerste };
  }
  if (CAST.test(eerste)) return { voorstelling: tweede, maker: eerste, beschrijving: null };
  if (isWervend(tweede)) return { voorstelling: eerste, maker: null, beschrijving: tweede };
  return { voorstelling: eerste, maker: tweede, beschrijving: null };
}

/**
 * Theater aan het Vrijthof en AINSI (Maastricht): één bron.
 *
 * Structuur (geïnspecteerd 6 okt 2026, debug/limburg-2-inventarisatie.md
 * §2.1): /voorstellingen is een Vue-app die de speeldata uit een Algolia-index
 * haalt (app-id, publieke zoeksleutel en indexnaam staan in de pagina). Eén
 * hit per speeldatum: tijd (unix), genre, locatie ("Theater aan het Vrijthof:
 * Papyruszaal", "AINSI: AINSI theater", "Kumulus Theater", "Overige
 * locaties" + toevoeging), company/name, is_cancelled, path.
 *
 * Per run: de pagina zelf (sanity check en de actuele sleutel; scripts laden
 * we niet, dus ook het Queue-it-script niet) en dan 1 Algolia-query met
 * alle toekomstige speeldata. Komt de pagina niet van de eigen site (een
 * wachtrij-doorverwijzing), dan stoppen we: de run valt terug op de vorige
 * data. Algolia's robots.txt staat alles toe (gecontroleerd 6 okt 2026).
 * Uitverkocht/laatste kaarten staan niet in de index: "onbekend".
 */
async function scrapeAllVrijthof({ page, theater, robots, waitForTurn, log, warn = log }) {
  if (!robots.isAllowed(AGENDA_PATH)) {
    log(`robots.txt verbiedt ${AGENDA_PATH} op ${theater.baseUrl} — sla over.`);
    return [];
  }
  await blokkeerZwareBronnen(page, { ookScripts: true, ookOverig: true });
  await waitForTurn();
  await gaNaar(page, theater.agendaUrl, { timeout: 45000 });
  const host = new URL(page.url()).host;
  if (host !== new URL(theater.baseUrl).host) {
    throw new Error(`doorgestuurd naar ${page.url()} (wachtrij?) — niet omzeilen, vorige data blijft staan.`);
  }
  const config = leesAlgoliaConfig(await page.content());
  // Sanity check: zonder zoekinstellingen is de agenda er niet.
  if (!config) throw new Error(`geen Algolia-instellingen op ${page.url()} — site veranderd of geblokkeerd?`);

  const vanaf = Math.floor(Date.now() / 1000) - 12 * 3600;
  const hits = [];
  for (let p = 0; p < MAX_PAGINAS; p++) {
    const params = new URLSearchParams({
      query: '',
      hitsPerPage: String(HITS_PER_PAGINA),
      page: String(p),
      numericFilters: `eventDateTimeStart>${vanaf}`,
      attributesToRetrieve: 'title,path,eventDateTimeStart,eventGenre,eventLocations,eventLocationAddition,is_cancelled,is_additional_booking,name,company,switchCompanyTitle,event_serie_or_theme',
      attributesToHighlight: '',
      attributesToSnippet: '',
      'x-algolia-application-id': config.app,
      'x-algolia-api-key': config.sleutel,
    });
    await waitForTurn();
    const res = await gaNaar(page, `https://${config.app.toLowerCase()}-dsn.algolia.net/1/indexes/${config.index}?${params}`, { timeout: 45000 });
    if (!res || res.status() !== 200) throw new Error(`Algolia gaf HTTP ${res?.status() ?? '?'}`);
    const data = await res.json();
    hits.push(...(data.hits ?? []));
    log(`Algolia pagina ${p + 1}: ${data.hits?.length ?? 0} van ${data.nbHits} speeldata`);
    if (p + 1 >= (data.nbPages ?? 1)) break;
  }
  if (hits.length === 0) throw new Error('Algolia gaf geen speeldata — index veranderd?');

  const buildId = createIdBuilder();
  const opgehaaldOp = new Date().toISOString();
  const shows = [];
  const weg = {};
  const onbekend = {};
  const tel = (o, k) => { o[k] = (o[k] ?? 0) + 1; };
  for (const hit of hits) {
    const { voorstelling, maker, beschrijving } = voorstellingEnMaker(hit);
    if (!voorstelling || !hit.eventDateTimeStart) continue;
    const reeksen = [].concat(hit.event_serie_or_theme ?? []);
    if (GEEN_VOORSTELLING.test(`${hit.title} ${voorstelling}`) || reeksen.some((r) => REEKS_WEG.has(r))) {
      tel(weg, voorstelling);
      continue;
    }
    const plaats = plaatsVoorHit(hit);
    if (!plaats) {
      tel(weg, `${voorstelling} (buiten Maastricht)`);
      continue;
    }
    const lid = THEATERS.find((t) => t.id === plaats.theaterId);
    const { datum, tijd } = unixNaarAmsterdam(hit.eventDateTimeStart);
    const genres = [].concat(hit.eventGenre ?? []);
    for (const g of genres) if (!isBekendGenre(g)) tel(onbekend, g);
    const url = hit.path ? new URL(hit.path, theater.baseUrl).toString() : theater.agendaUrl;
    const titel = metEnDash(voorstelling);
    const show = {
      id: buildId(plaats.theaterId, titel, datum, tijd),
      titel,
      theaterId: plaats.theaterId,
      theaterNaam: lid?.naam ?? plaats.theaterId,
      stad: lid?.stad ?? theater.stad,
      ...(plaats.locatie ? { locatie: plaats.locatie } : {}),
      podiumpas: lid?.podiumpas === true,
      datum,
      tijd,
      genre: normalizeGenreFromList(genres) ?? (genres.length ? 'Overig' : null),
      genreRuw: genres.join(', ') || null,
      beschikbaarheid: hit.is_cancelled ? 'afgelast' : 'onbekend',
      beschrijving,
      maker,
      prijs: null,
      reserverenUrl: url,
      bron: url,
      opgehaaldOp,
    };
    shows.push(maker ? pasTitelConventieToe(show, { artiest: maker, voorstelling: titel, makerWordtLeeg: true }) : show);
  }
  const lijst = (o) => Object.entries(o).map(([k, n]) => `${k} (${n})`).join(', ');
  if (Object.keys(weg).length) log(`weggelaten: ${lijst(weg)}`);
  if (Object.keys(onbekend).length) warn(`onbekende brongenres (nu Overig): ${lijst(onbekend)}`);
  return shows;
}

/** Voor Vrijthof en AINSI (zelfde index, één scrape per run). */
export const scrapeVrijthofGroep = createGroupScraper(scrapeAllVrijthof);

export { scrapeAllVrijthof };
