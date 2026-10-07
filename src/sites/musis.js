import { createGroupScraper } from '../lib/peppered.js';
import { createIdBuilder } from '../lib/normalize.js';
import { normalizeGenre, isBekendGenre } from '../lib/genre.js';
import { pasTitelConventieToe, isWervend } from '../lib/titels.js';
import { gaNaar } from '../lib/diagnose.js';
import { openDetailCache } from '../lib/detailCache.js';
import { blokkeerZwareBronnen } from '../lib/zwareBronnen.js';
import { THEATERS } from '../lib/config.js';

const API_PATH = '/api/events';
const MAX_PAGINAS = 80;

// Hooguit zoveel detailpagina's per run ophalen. De eerste nacht (~290
// producties) gaat de cache in twee stappen vol; daarna ~40 per nacht. Zo
// stopt de scraper zelf en bewaart hij de cache, in plaats van een time-out
// (die zou de cache niet bewaren, en dan begint elke nacht opnieuw).
// Producties zonder detailgegevens slaan we die nacht over.
export const MAX_OPHALEN_PER_RUN = 180;

// Podiumpas bij Musis en Stadstheater (bron:
// https://www.musisenstadstheater.nl/nl/jouw-bezoek/podiumpas, 7 okt 2026):
// geldig voor reguliere voorstellingen en concerten; uitgesloten zijn
// verhuringen, gastvoorstellingen en voorstellingen via een extern
// verkoopkanaal. Ticketmaster-concerten (geen gast) kunnen wel, per mail.
// De agenda-API zegt daar niets over; de detailpagina per productie wel: de
// ticketknop (eigen verkoop via tix.musisenstadstheater.nl, of elders) en de
// zaal. Gast/verhuur herkennen we aan een tag of notitie met die woorden
// (tag "Gastprogramma", 12 speeldata op 7 okt 2026).
const EIGEN_VERKOOP = /(^|\.)musisenstadstheater\.nl$/i;
const TICKETMASTER = /ticketmaster\./i;
const GAST_OF_VERHUUR = /\b(gast(voorstelling|programma)?|verhuur|verhuring)\b/i;

// Tags die geen genre zijn.
const LABELS = /^(gelrepas|roze jaar|matinee|podcast|serie|abonnement|kids|\d+\+|gastprogramma|jong talent|arnhems|spotlight artist|language no problem|komt het zien!?|tips voor .+)$/i;

// Bij deze tags is de titel de artiest en `performer` de voorstelling
// ("Yentl en de Boer" / "Rekhalzen" → "Rekhalzen – Yentl en de Boer"); anders
// is `performer` de maker ("Komt voor de bakker" / "Musiccare & MVT Arnhem").
const ARTIEST_EERST = /^(cabaret|show|comedy|klassiek|orkestraal|kamermuziek|koormuziek|piano|pop|singer-songwriter|jazz|wereldmuziek|concert)$/i;

// Uitzondering (bron: de API van 7 okt 2026): is `performer` een ensemble en
// de titel niet, dan staat het al goed om ("Messiah van Handel" / "Toonkunst
// Arnhem", "Arnhem, mijn stadje." / "Arnhems Promenade Orkest"): titel =
// voorstelling, performer = maker → "Messiah van Handel – Toonkunst Arnhem".
// Niet bij een programmanaam met "shows" ("DAAN" / "Crooner - The Acoustic
// Trio shows").
const ensembleAlsMaker = (performer, titel) => Boolean(performer) && ENSEMBLE.test(performer) && !/\bshows?\b/i.test(performer) && !ENSEMBLE.test(titel);
const ENSEMBLE = /orkest|orchestra|koor\b|choir|ensemble|kwartet|quartet|trio\b|octet|sinfoni|philharmoni|toonkunst|baroque|harmonie|blazers|consort|vocale|cappella|scholars|camerata/i;

// Geen voorstelling: een serie of abonnement ("Serie: Kijk op theater"), een
// combiticket (beide voorstellingen staan ook los in de agenda), een
// rondleiding, workshop of masterclass.
const WEGLATEN = /^(serie|combiticket)\s*:|\b(rondleiding|workshop)\b/i;
const WEGLATEN_PERFORMER = /^masterclass$/i;

// Een performer-veld dat een omschrijving is ("i.s.m. Rijn IJssel", "ism TAR").
const OMSCHRIJVING = /^(i\.?s\.?m\.?\s|[a-z]+voorstelling i\.s\.m\.|een |met |in de |in het |onderdeel van)/i;

// "Harlekino (Verplaatst)": dit ís de nieuwe datum (knop "Tickets"); het
// woord hoort niet in de titel.
const zonderVerplaatst = (t) => t.replace(/\s*\(verplaatst\)\s*$/i, '').trim();

// Externe locaties van Musis-programma's in Arnhem ("Eusebiuskerk, Externe
// locatie"). "Theater a/d Rijn" niet: dat is TAR, met een eigen agenda (dubbel).
const EIGEN_EXTERN = /^(eusebiuskerk|koepelkerk|walburgiskerk|sint-?eusebius)/i;

/**
 * Plek uit de detailpagina → { theaterId, zaal, locatie } of null:
 * "Musis, Parkzaal" → musis/Parkzaal; "Stadstheater, Grote Zaal" →
 * stadstheater; "Eusebiuskerk, Externe locatie" → musis met locatie.
 */
export function musisPlek(tekst) {
  const delen = String(tekst ?? '').split(',').map((d) => d.trim()).filter(Boolean);
  if (!delen.length) return null;
  const [plek, ...rest] = delen;
  const zaal = rest.filter((d) => !/^arnhem$/i.test(d)).join(', ') || null;
  if (/^musis\b/i.test(plek)) return { theaterId: 'musis', zaal, locatie: null };
  if (/^stadstheater\b/i.test(plek)) return { theaterId: 'stadstheater', zaal, locatie: null };
  if (EIGEN_EXTERN.test(plek)) return { theaterId: 'musis', zaal: null, locatie: `${plek} | Arnhem` };
  return null;
}

/** Eerste echte genre uit de tags. */
function genreUitTags(tags) {
  for (const t of tags) {
    if (LABELS.test(t)) continue;
    const g = normalizeGenre(t);
    if (g && g !== 'Overig') return { genre: g, bron: t };
  }
  return { genre: tags.length ? 'Overig' : null, bron: tags.find((t) => !LABELS.test(t)) ?? null };
}

// Draait in de browser op een detailpagina: zaal, ticketknop, notitie.
function leesDetail() {
  const t = (e) => e?.textContent.trim().replace(/\s+/g, ' ') || null;
  const box = document.querySelector('.info-box.event');
  return {
    plek: t(box?.querySelector(':scope > .fw-bold:not(.genres)')),
    ticket: box?.querySelector('a.btn')?.getAttribute('href') ?? null,
    knop: t(box?.querySelector('a.btn')),
    notitie: t(box?.querySelector('.fst-italic')),
  };
}

/**
 * Musis en Stadstheater Arnhem: één site, één JSON-API (/api/events, API
 * Platform, 10 speeldata per pagina, ~34 verzoeken), voor twee theaters. De
 * zaal en de uitsluitingen staan alleen op de detailpagina per productie
 * (/nl/agenda/<slug>/<eventId>); die komen uit de detailcache: nieuwe
 * producties meteen, bekende hooguit één keer per week (zie detailCache.js).
 * Eerste nacht 34 + 180 verzoeken (~3,5 min; grens per run), tweede nacht
 * 34 + ~110, daarna 34 + ~40 (~1,5 min).
 */
async function scrapeAllMusis({ page, theater, robots, waitForTurn, log, warn }) {
  if (!robots.isAllowed(API_PATH)) throw new Error(`robots.txt verbiedt ${API_PATH} — niet scrapen`);
  // ookOverig: ook iframes (YouTube-video's op ~1 op 3 detailpagina's).
  const zwaar = await blokkeerZwareBronnen(page, { ookScripts: true, ookOverig: true });
  const vandaag = new Date().toISOString().slice(0, 10);
  const events = [];
  for (let p = 1; p <= MAX_PAGINAS; p++) {
    await waitForTurn();
    const url = `${theater.baseUrl}${API_PATH}?page=${p}&startsAt%5Bafter%5D=${vandaag}`;
    const res = await gaNaar(page, url, { timeout: 45000 });
    if (!res || res.status() !== 200) throw new Error(`API gaf HTTP ${res?.status() ?? '?'} op ${url}`);
    const data = await res.json();
    const leden = data.member ?? data['hydra:member'] ?? [];
    events.push(...leden);
    if (p === 1) log(`API: ${data.totalItems ?? '?'} speeldata`);
    const volgende = (data.view ?? data['hydra:view'])?.next;
    if (!volgende || leden.length === 0) break;
    if (p === MAX_PAGINAS) warn(`API: meer dan ${MAX_PAGINAS} pagina's — paginering stuk?`);
  }
  if (events.length === 0) throw new Error('API gaf geen speeldata — veranderd of geblokkeerd?');

  // Eén detailpagina per productie (slug), via de cache.
  const cache = await openDetailCache('musis');
  const perSlug = new Map();
  for (const e of events) if (e.production?.slug && !perSlug.has(e.production.slug)) perSlug.set(e.production.slug, e.id);
  const details = new Map();
  let mislukt = 0;
  let opgehaald = 0;
  let uitgesteld = 0;
  for (const [slug, eventId] of perSlug) {
    const p = events.find((e) => e.production.slug === slug)?.production ?? {};
    if (WEGLATEN.test(p.title ?? '') || WEGLATEN_PERFORMER.test(p.performer?.trim() ?? '')) continue;
    const sleutel = `${theater.baseUrl}/nl/agenda/${slug}`;
    const detailUrl = `${sleutel}/${eventId}`;
    if (!robots.isAllowed(new URL(detailUrl).pathname)) continue;
    if (cache.moetOphalen(sleutel) && opgehaald >= MAX_OPHALEN_PER_RUN) {
      const oud = cache.get(sleutel);
      if (oud) details.set(slug, oud);
      else uitgesteld++;
      continue;
    }
    try {
      const r = await cache.haal(sleutel, async () => {
        opgehaald++;
        await waitForTurn();
        const res = await gaNaar(page, detailUrl, { timeout: 30000 });
        if (!res || res.status() !== 200) throw new Error(`HTTP ${res?.status() ?? '?'}`);
        return page.evaluate(leesDetail);
      });
      details.set(slug, r.data);
      if (r.oud) log(`detailpagina ${slug}: ${r.fout.message} — gegevens van ${'eerder'} gebruikt.`);
    } catch (err) {
      mislukt++;
      log(`detailpagina ${slug}: ${err.message} — overgeslagen.`);
    }
  }
  await cache.bewaar();
  log(`detailpagina's: ${cache.stats.nieuw} nieuw, ${cache.stats.ververst} ververst, ${cache.stats.uitCache} uit de cache, ${uitgesteld} uitgesteld (grens ${MAX_OPHALEN_PER_RUN}), ${mislukt} mislukt`);
  if (uitgesteld > 0) warn(`${uitgesteld} producties nog zonder detailpagina (grens ${MAX_OPHALEN_PER_RUN} per run); die ontbreken tot de volgende nacht.`);
  if (mislukt > perSlug.size / 4) warn(`${mislukt} van ${perSlug.size} detailpagina's mislukt.`);

  const buildId = createIdBuilder();
  const opgehaaldOp = new Date().toISOString();
  const shows = [];
  const weg = {};
  const onbekend = {};
  const geenPas = {};
  const tel = (o, k) => (o[k] = (o[k] ?? 0) + 1);

  for (const e of events) {
    const prod = e.production ?? {};
    // Ook een losse punt aan het eind ("Arnhem, mijn stadje.").
    const titel = zonderVerplaatst(prod.title?.trim() ?? '').replace(/([^.])\.$/, '$1');
    if (!titel) continue;
    if (WEGLATEN.test(titel) || WEGLATEN_PERFORMER.test(prod.performer?.trim() ?? '')) {
      tel(weg, 'serie/combiticket/rondleiding/workshop');
      continue;
    }
    const d = details.get(prod.slug);
    const plek = musisPlek(d?.plek);
    if (!plek) {
      tel(weg, d ? `andere plek (${d.plek ?? 'onbekend'})` : 'nog geen detailpagina');
      continue;
    }
    const lid = THEATERS.find((t) => t.id === plek.theaterId);
    const tags = (prod.tags ?? []).map((t) => t.name).filter(Boolean);
    for (const t of tags) if (!LABELS.test(t) && !isBekendGenre(t)) tel(onbekend, t);
    const { genre, bron: genreRuw } = genreUitTags(tags);
    const host = (() => {
      try {
        return d.ticket && /^https?:/.test(d.ticket) ? new URL(d.ticket).hostname : null;
      } catch {
        return null;
      }
    })();
    const extern = host && !EIGEN_VERKOOP.test(host) && !TICKETMASTER.test(host);
    const gast = [...tags, d.notitie ?? '', d.knop ?? ''].some((x) => GAST_OF_VERHUUR.test(x));
    const podiumpas = Boolean(lid?.podiumpas) && !extern && !gast;
    if (!podiumpas) tel(geenPas, extern ? `verkoop via ${host}` : 'gast/verhuur');
    const datum = e.startsAt.slice(0, 10);
    const tijd = e.startsAt.slice(11, 16) || null;
    const detailUrl = `${theater.baseUrl}/nl/agenda/${prod.slug}/${e.id}`;
    const performer = prod.performer?.trim() || null;
    const omschrijving = performer && (isWervend(performer) || OMSCHRIJVING.test(performer));
    const show = {
      id: buildId(plek.theaterId, titel, datum, tijd),
      titel,
      theaterId: plek.theaterId,
      theaterNaam: lid?.naam ?? plek.theaterId,
      stad: lid?.stad ?? theater.stad,
      zaal: plek.zaal,
      ...(plek.locatie ? { locatie: plek.locatie } : {}),
      podiumpas,
      datum,
      tijd,
      genre,
      genreRuw,
      // soldOut uit de API is actueel; de knop op de detailpagina kan tot een
      // week oud zijn, maar "Tickets" wordt alleen gebruikt als de API niet
      // zegt dat het uitverkocht is.
      beschikbaarheid: e.soldOut ? 'uitverkocht' : /^tickets$/i.test(d.knop ?? '') ? 'beschikbaar' : 'onbekend',
      beschrijving: omschrijving ? performer : null,
      maker: omschrijving ? null : performer,
      prijs: null,
      reserverenUrl: detailUrl,
      bron: detailUrl,
      opgehaaldOp,
    };
    const ensemble = !omschrijving && ensembleAlsMaker(performer, titel);
    const artiestEerst = tags.some((t) => ARTIEST_EERST.test(t)) && !/:\s/.test(titel) && !ensemble;
    if (artiestEerst && show.maker) shows.push(pasTitelConventieToe(show, { artiest: titel, voorstelling: performer, makerWordtLeeg: true, alleGenres: true }));
    else if (ensemble && tags.some((t) => ARTIEST_EERST.test(t))) shows.push(pasTitelConventieToe(show, { artiest: performer, voorstelling: titel, makerWordtLeeg: true, alleGenres: true }));
    else shows.push(show);
  }
  const lijst = (o) => Object.entries(o).map(([x, n]) => `${x} (${n})`).join(', ');
  if (Object.keys(weg).length) log(`weggelaten: ${lijst(weg)}`);
  if (Object.keys(geenPas).length) log(`podiumpas: false bij ${lijst(geenPas)}`);
  if (Object.keys(onbekend).length) warn(`onbekende brongenres (nu Overig): ${lijst(onbekend)}`);
  log(`${zwaar.verzoeken()} verzoek(en) naar de site (plus robots.txt)`);
  return shows;
}

/** Voor Musis en Stadstheater (één API, één scrape per run). */
export const scrapeMusisGroep = createGroupScraper(scrapeAllMusis);
