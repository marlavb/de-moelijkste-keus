import { createGroupScraper } from '../lib/peppered.js';
import { createIdBuilder } from '../lib/normalize.js';
import { normalizeGenre, isBekendGenre } from '../lib/genre.js';
import { titelUitKopEnOndertitel, metEnDash } from '../lib/titels.js';
import { vervallenStatus } from '../lib/beschikbaarheid.js';
import { lowestPrice } from '../lib/exclusions.js';
import { gaNaar } from '../lib/diagnose.js';
import { openDetailCache } from '../lib/detailCache.js';
import { blokkeerZwareBronnen } from '../lib/zwareBronnen.js';
import { metDevCache } from '../lib/devCache.js';
import { THEATERS } from '../lib/config.js';

const AGENDA_PATH = '/programma';
const API_PATH = '/api/events/getresults';
const MAX_API_PAGINAS = 60;

// Hooguit zoveel detailpagina's per run (zoals Musis): de eerste nachten
// gaat de cache in stappen vol, producties met meer speeldata eerst (die
// kunnen zonder detailpagina niet per dag gesplitst worden).
export const MAX_OPHALEN_PER_RUN = 150;

// Podiumpas bij Zwolse Theaters (bron:
// https://www.zwolsetheaters.nl/voordeel/podiumpas, 8 okt 2026): "Vrijwel
// alle voorstellingen doen mee. Enkel gastprogrammering is uitgezonderd."
// Prijsmaximum: geen toegang tot voorstellingen en rangen boven €50 (normaal
// tarief); dus false als zelfs de goedkoopste rang duurder is. Reserveren
// online, vanaf 30 dagen.
const GAST = /^gastprogrammering$/i;
export const PODIUMPAS_MAX_PRIJS = 50;

// Genre-tags die geen genre zijn (labels, reeksen) of geen voorstelling.
const LABELS = /^(gastprogrammering|language no problem|theater overdag|special|theatercollege)$/i;
const WEGLATEN_GENRE = /^(workshop|inleiding|randprogrammering|educatie)$/i;
const WEGLATEN_TITEL = /^workshop\b/i;

// Een ondertitel die een omschrijving is, geen maker ("Een swingend en
// spannend avontuur", "in de Paap", "i.s.m. Hedon"); zoals bij Musis.
const OMSCHRIJVING = /^(i\.?s\.?m\.?\s|ism\s|een |in de |in het |onderdeel van)/i;
// Labels die nooit genre zijn, ook niet bij gebrek aan beter.
const NOOIT_GENRE = /^(gastprogrammering|language no problem|theater overdag)$/i;

// De locaties van de lijst → theaterId. "Schouwburg Odeon" en "Theater de
// Spiegel" staan op podiumpas.nl als losse locaties (kaartdata van
// https://podiumpas.nl/waar-te-besteden, 8 okt 2026). Andere plekken
// (Academiehuis Grote Kerk, Museum de Fundatie, SIO – Zwolle Zuid, …) komen
// bij Odeon, met `locatie`.
export function zwolsePlek(locatie) {
  const t = String(locatie ?? '').trim();
  if (/^schouwburg odeon\b/i.test(t)) return { theaterId: 'odeon', zaal: t.split(/\s+-\s+/)[1] ?? null, locatie: null };
  if (/^theater de spiegel\b/i.test(t)) return { theaterId: 'despiegel', zaal: t.split(/\s+-\s+/)[1] ?? null, locatie: null };
  if (!t) return { theaterId: 'odeon', zaal: null, locatie: null };
  return { theaterId: 'odeon', zaal: null, locatie: `${t.split(/\s+-\s+/)[0]} | Zwolle` };
}

const MAANDEN = { jan: 1, feb: 2, mrt: 3, apr: 4, mei: 5, jun: 6, jul: 7, aug: 8, sep: 9, okt: 10, nov: 11, dec: 12 };
const pad = (n) => String(n).padStart(2, '0');

/** "zo 11 okt '26" → "2026-10-11". */
export function zwolseDatum(tekst) {
  const m = /(\d{1,2})\s+([a-z]{3})[a-z]*\.?\s+'(\d{2})/i.exec(String(tekst ?? ''));
  if (!m || !MAANDEN[m[2].toLowerCase()]) return null;
  return `20${m[3]}-${pad(MAANDEN[m[2].toLowerCase()])}-${pad(m[1])}`;
}

/** "20:00 uur" / "10.30 uur" → "20:00". */
export function zwolseTijd(tekst) {
  const m = /^(\d{1,2})[:.](\d{2})/.exec(String(tekst ?? '').trim());
  return m ? `${pad(m[1])}:${m[2]}` : null;
}

/** Knoptekst → beschikbaarheid. */
export function zwolseBeschikbaarheid(knop) {
  const t = String(knop ?? '').trim();
  const vervallen = vervallenStatus(t);
  if (vervallen) return vervallen;
  if (/^uitverkocht$/i.test(t)) return 'uitverkocht';
  if (/^wachtlijst$/i.test(t)) return 'wachtlijst';
  if (/^(bestellen|bestel kaarten|laatste kaarten|gratis)$/i.test(t)) return 'beschikbaar';
  return 'onbekend';
}

// Draait in de browser: het JSON-model van een Vue-component (attribuut
// ":model") op de pagina.
function leesModel(naam) {
  const el = document.querySelector(`component[is="${naam}"]`);
  const raw = el?.getAttribute(':model');
  return raw ? JSON.parse(raw) : null;
}

/**
 * Zwolse Theaters (Schouwburg Odeon en Theater de Spiegel). Umbraco + Vue,
 * kaartverkoop via Ticketmatic. /programma bevat het eerste stuk van de lijst
 * als JSON (component "production-overview"), de rest komt van de API
 * (POST /api/events/getresults, met de query van de pagina). Een resultaat is
 * een productie, met opeenvolgende speeldata samengevoegd ("zo 11 okt '26 +
 * ma 12 okt '26", "10:30 + 15:00 uur"); per speeldatum staan datum, tijd,
 * prijs en status op de detailpagina (component "shows"). Die komen uit de
 * detailcache (cache/detail/zwolse.json).
 */
async function scrapeAllZwolse({ page, theater, robots, waitForTurn, log, warn }) {
  if (!robots.isAllowed(AGENDA_PATH) || !robots.isAllowed(API_PATH)) throw new Error(`robots.txt verbiedt ${AGENDA_PATH} of ${API_PATH} — niet scrapen`);
  const zwaar = await blokkeerZwareBronnen(page, { ookScripts: true, ookOverig: true });
  await waitForTurn();
  const agendaUrl = new URL(AGENDA_PATH, theater.baseUrl).toString();
  const res = await gaNaar(page, agendaUrl, { timeout: 45000 });
  if (!res || res.status() !== 200) throw new Error(`programma gaf HTTP ${res?.status() ?? '?'} op ${agendaUrl}`);
  const model = await page.evaluate(leesModel, 'production-overview');
  // Sanity check: het model met de lijst en de teller moet er zijn.
  const totaal = model?.result?.pager?.totalItems;
  if (!model?.result?.query || typeof totaal !== 'number') throw new Error(`geen programmalijst (production-overview) op ${agendaUrl} — site veranderd?`);
  log(`programma: ${totaal} producties`);

  const items = await haalLijst({ page, theater, model, totaal, waitForTurn, log, warn });

  const cache = await openDetailCache('zwolse');
  const details = new Map();
  let opgehaald = 0;
  let uitgesteld = 0;
  let mislukt = 0;
  // Meer speeldata eerst: die zijn zonder detailpagina niet te tonen.
  const volgorde = [...items].sort((a, b) => Number(isMeerdaags(b)) - Number(isMeerdaags(a)));
  for (const it of volgorde) {
    const url = it.link?.url ? new URL(it.link.url, theater.baseUrl).toString() : null;
    if (!url || details.has(url) || !robots.isAllowed(new URL(url).pathname)) continue;
    if (cache.moetOphalen(url) && opgehaald >= MAX_OPHALEN_PER_RUN) {
      const oud = cache.get(url);
      if (oud) details.set(url, oud);
      else uitgesteld++;
      continue;
    }
    try {
      const r = await cache.haal(url, async () => {
        opgehaald++;
        await waitForTurn();
        const d = await gaNaar(page, url, { timeout: 30000 });
        if (!d || d.status() !== 200) throw new Error(`HTTP ${d?.status() ?? '?'}`);
        return page.evaluate(leesDetail);
      });
      details.set(url, r.data);
      if (r.oud) log(`detailpagina ${url}: ${r.fout.message} — gegevens van eerder gebruikt.`);
    } catch (err) {
      mislukt++;
      log(`detailpagina ${url}: ${err.message} — overgeslagen.`);
    }
  }
  await cache.bewaar();
  log(`detailpagina's: ${cache.stats.nieuw} nieuw, ${cache.stats.ververst} ververst, ${cache.stats.uitCache} uit de cache, ${uitgesteld} uitgesteld (grens ${MAX_OPHALEN_PER_RUN}), ${mislukt} mislukt`);
  if (uitgesteld > 0) warn(`${uitgesteld} producties nog zonder detailpagina (grens ${MAX_OPHALEN_PER_RUN} per run); producties met meer speeldata daarvan ontbreken tot de volgende nacht.`);
  if (mislukt > items.length / 4) warn(`${mislukt} van ${items.length} detailpagina's mislukt.`);

  const shows = verwerkZwolse(items, { baseUrl: theater.baseUrl, details, log });
  log(`${zwaar.verzoeken()} verzoeken`);
  return shows;
}

const isMeerdaags = (it) => /\+/.test(`${it.date ?? ''} ${it.time ?? ''}`);

/**
 * De hele lijst via de API. Eerst één keer alles in één antwoord (limit =
 * totaal); geeft de server minder terug, dan per pagina zoals de site zelf.
 */
async function haalLijst({ page, theater, model, totaal, waitForTurn, log, warn }) {
  const apiUrl = new URL(model.apiUrl || API_PATH, theater.baseUrl).toString();
  // Zoals de site zelf: een fetch vanuit de programmapagina (zelfde origin).
  // Lokaal via metDevCache, zodat SCRAPE_CACHE/SCRAPE_OFFLINE ook hier
  // gelden (in CI: altijd echt).
  const post = (query) =>
    metDevCache(apiUrl, JSON.stringify(query), async () => {
      await waitForTurn();
      const r = await page.evaluate(
        async ({ url, body }) => {
          const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
          return { status: res.status, data: res.ok ? await res.json() : null };
        },
        { url: apiUrl, body: JSON.stringify(query) }
      );
      if (r.status !== 200) throw new Error(`API gaf HTTP ${r.status} op ${apiUrl}`);
      return r.data;
    });
  const basis = model.result.query;
  const alles = await post({ ...basis, page: 1, limit: totaal });
  if ((alles?.data?.length ?? 0) >= totaal) {
    log(`API: alle ${totaal} producties in één verzoek`);
    return alles.data;
  }
  log(`API: ${alles?.data?.length ?? 0} van ${totaal} in één verzoek — verder per pagina van ${basis.limit}`);
  const items = [...(model.result.data ?? [])];
  const paginas = model.result.pager.totalPages;
  for (let p = 2; p <= Math.min(paginas, MAX_API_PAGINAS); p++) {
    const r = await post({ ...basis, page: p });
    items.push(...(r?.data ?? []));
    if (!r?.data?.length) break;
  }
  if (items.length < totaal) warn(`${items.length} van ${totaal} producties gelezen — API veranderd?`);
  return items;
}

// Draait in de browser: per speeldatum (component "shows") en de algemene
// gegevens (component "show-details": locatie, prijzen).
function leesDetail() {
  const model = (naam) => {
    const raw = document.querySelector(`component[is="${naam}"]`)?.getAttribute(':model');
    return raw ? JSON.parse(raw) : null;
  };
  const shows = model('shows');
  const details = model('show-details');
  const veld = (titel) => details?.general?.details?.find((d) => d.title === titel)?.value ?? null;
  return {
    speeldata: (shows?.items ?? []).map((i) => ({
      id: i.information?.ticketmaticId ?? null,
      datum: i.information?.date ?? null,
      tijd: i.information?.time ?? null,
      prijs: i.information?.price ?? null,
      knop: i.link?.name ?? null,
      url: i.link?.url ?? null,
    })),
    locatie: veld('Locatie'),
    prijzen: (details?.prices?.details ?? []).map((d) => `${d.title}: ${d.value}`).join('; ') || null,
  };
}

/** Lijst + details → voorstellingen (los te testen). */
export function verwerkZwolse(items, { baseUrl, details = new Map(), log = () => {}, opgehaaldOp = new Date().toISOString() }) {
  const theaters = Object.fromEntries(THEATERS.filter((t) => t.id === 'odeon' || t.id === 'despiegel').map((t) => [t.id, t]));
  const buildId = createIdBuilder();
  const shows = [];
  const weg = {};
  const onbekend = {};
  const geenPas = {};
  const tel = (o, k) => (o[k] = (o[k] ?? 0) + 1);

  for (const it of items) {
    const kop = metEnDash(String(it.title ?? '').trim());
    if (!kop) continue;
    const genreTags = (it.tags ?? []).filter((t) => /[?&]genre=/.test(t.url ?? '')).map((t) => t.name.trim());
    if (genreTags.some((g) => WEGLATEN_GENRE.test(g)) || WEGLATEN_TITEL.test(kop)) {
      tel(weg, genreTags.find((g) => WEGLATEN_GENRE.test(g))?.toLowerCase() ?? 'workshop');
      continue;
    }
    const url = it.link?.url ? new URL(it.link.url, baseUrl).toString() : null;
    const detail = url ? details.get(url) : null;
    const meerdaags = isMeerdaags(it);

    // Per speeldatum: van de detailpagina, of (één speeldatum) van de lijst.
    let speeldata;
    if (detail?.speeldata?.length) {
      speeldata = detail.speeldata.map((s) => ({ datum: zwolseDatum(s.datum), tijd: zwolseTijd(s.tijd), prijs: s.prijs, knop: s.knop, reserveren: s.url }));
    } else if (!meerdaags) {
      speeldata = [{ datum: zwolseDatum(it.date), tijd: zwolseTijd(it.time), prijs: null, knop: it.link?.name, reserveren: null }];
    } else {
      tel(weg, 'meer speeldata, nog geen detailpagina');
      continue;
    }

    const plek = zwolsePlek(detail?.locatie ?? it.location);
    const theater = theaters[plek.theaterId];
    const genres = genreTags.filter((g) => !LABELS.test(g));
    // Alleen een label ("theatercollege", "special"): dat dan als genre (Overig).
    const genreRuw = genres[0] ?? genreTags.find((g) => !NOOIT_GENRE.test(g)) ?? null;
    for (const g of genres) if (!isBekendGenre(g)) tel(onbekend, g);
    const gast = genreTags.some((g) => GAST.test(g));
    const cabaret = /cabaret|comedy/i.test(genres.join(' '));

    // Ondertitel in delen: "Oudejaarsconference 2026 | try-out",
    // "Het Trojaanse Kalf | Common Ground for Kids Festival | reprise". Het
    // eerste deel is de voorstelling (cabaret) of de maker; de rest zijn
    // labels (try-out, reprise, festival of reeks) voor de beschrijving.
    const [onder, ...rest] = String(it.subtitle ?? '').split(/\s+\|\s+/).map((d) => d.trim()).filter(Boolean);
    const omschrijving = onder && OMSCHRIJVING.test(onder);
    const basis = omschrijving
      ? { titel: kop, maker: null, beschrijving: onder }
      : titelUitKopEnOndertitel({ beschrijving: null }, { kop, ondertitel: onder ? metEnDash(onder) : null, volgorde: cabaret ? 'maker-titel' : 'titel-maker' });

    for (const s of speeldata) {
      if (!s.datum) {
        log(`kon datum niet lezen voor "${kop}" — overgeslagen.`);
        continue;
      }
      const prijs = s.prijs ? lowestPrice(s.prijs) : null;
      let podiumpas = theater.podiumpas;
      if (gast) {
        podiumpas = false;
        tel(geenPas, 'gastprogrammering');
      } else if (prijs != null && prijs > PODIUMPAS_MAX_PRIJS) {
        podiumpas = false;
        tel(geenPas, `prijs > €${PODIUMPAS_MAX_PRIJS}`);
      }
      const titel = basis.titel;
      shows.push({
        id: buildId(theater.id, titel, s.datum, s.tijd),
        titel,
        theaterId: theater.id,
        theaterNaam: theater.naam,
        stad: theater.stad,
        podiumpas,
        datum: s.datum,
        tijd: s.tijd,
        genre: normalizeGenre(genreRuw),
        genreRuw,
        beschikbaarheid: zwolseBeschikbaarheid(s.knop),
        beschrijving: [basis.beschrijving, ...rest].filter(Boolean).join(' · ') || null,
        maker: basis.maker,
        prijs,
        ...(plek.zaal ? { zaal: plek.zaal } : {}),
        ...(plek.locatie ? { locatie: plek.locatie } : {}),
        reserverenUrl: s.reserveren && /^https?:/.test(s.reserveren) ? s.reserveren : url ?? theater.agendaUrl,
        bron: url ?? theater.agendaUrl,
        opgehaaldOp,
      });
    }
  }
  const lijst = (o) => Object.entries(o).map(([x, n]) => `${x} (${n})`).join(', ');
  if (Object.keys(weg).length) log(`weggelaten: ${lijst(weg)}`);
  if (Object.keys(geenPas).length) log(`podiumpas false: ${lijst(geenPas)}`);
  if (Object.keys(onbekend).length) log(`onbekende genres: ${lijst(onbekend)}`);
  return shows;
}

export const scrapeZwolseGroep = createGroupScraper(scrapeAllZwolse);
