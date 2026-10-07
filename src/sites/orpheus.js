import { pagineerListing, leesPepperedKaarten, laagstePrijs } from '../lib/peppered.js';
import { createDutchAbbrevDayParser, extractTime, createIdBuilder } from '../lib/normalize.js';
import { normalizeGenre, isBekendGenre } from '../lib/genre.js';
import { pasTitelConventieToe, isWervend } from '../lib/titels.js';
import { vervallenStatus } from '../lib/beschikbaarheid.js';
import { blokkeerZwareBronnen } from '../lib/zwareBronnen.js';

const AGENDA_PATH = '/voorstellingen';
const MAX_PAGINAS = 40;

// Podiumpas bij Orpheus (bron: https://www.orpheus.nl/podiumpas-7v18, 7 okt
// 2026): tickets met een prijs tot €50; "bepaalde producties kunnen door het
// theater of de producent worden uitgesloten, dit staat op de
// voorstellingspagina". Op drie gecontroleerde voorstellingspagina's (gast,
// cabaret, extern; 7 okt 2026) stond niets over de pas. Dus: laagste prijs op
// de kaart boven €50 → false; "Tickets (extern)" (verkoop elders, bv. GIGANT
// in de Grote Kerk) en gratis ("Vrij toegankelijk") → false; anders true.
export const PODIUMPAS_MAX_PRIJS = 50;

// Tags die geen genre zijn: leeftijden, reeksen en labels. Niet melden als
// onbekend brongenre; het genre komt uit de eerste echte genretag.
const LABELS = /^(\d+\+|te gast|lokaal talent|language no problem|theaterhart|vriendjes van orpheus|kinderen gratis|middagje uit|internationaal|orpheus specials|young adult|festival|evenement|randprogramma)$/i;

// Geen voorstelling: inleidingen ("Theaterhart: Inleiding ENERGY") en "Vier de Vrijdag".
const WEGLATEN = /^randprogramma$/i;

// Genres waar de titel de artiest is en de ondertitel de voorstelling
// ("Pieter Verelst" / "Altijd Aan" → "Altijd Aan – Pieter Verelst"). Bij de
// andere genres is de ondertitel de maker ("ENERGY" / "Introdans").
const ARTIEST_EERST = /^(cabaret & comedy|theaterconcert|tribute|theatershow|jazz & wereldmuziek|gigant|staconcert)$/i;

// Een ondertitel die een omschrijving is, geen maker of voorstelling.
const OMSCHRIJVING = /^(onderdeel van|in de |in het |inclusief |met |welkom |een |dit |i\.s\.m\.|a |an |the .* (journey|show)\b)/i;

// De tagline op de kaart eindigt op de linktekst "Meer info".
const zonderMeerInfo = (t) => (t ? t.replace(/\s*Meer info$/i, '').trim() || null : t);

/** Knop- of statustekst → beschikbaarheid. */
export function orpheusStatus(tekst) {
  const t = String(tekst ?? '').trim().toLowerCase();
  const vervallen = vervallenStatus(t);
  if (vervallen) return vervallen;
  if (/uitverkocht/.test(t)) return 'uitverkocht';
  if (/wachtlijst/.test(t)) return 'wachtlijst';
  if (/^(tickets|laatste tickets|vrij toegankelijk)/.test(t)) return 'beschikbaar';
  return 'onbekend'; // "Vanaf wo 21 okt 2026 11:00", "Binnenkort in verkoop", "niet reserveerbaar"
}

/** Eerste echte genre uit de tags (labels en "Overig" tellen niet). */
function genreUitTags(tags) {
  for (const t of tags) {
    if (LABELS.test(t)) continue;
    const g = normalizeGenre(t);
    if (g && g !== 'Overig') return { genre: g, bron: t };
  }
  return { genre: tags.length ? 'Overig' : null, bron: tags.find((t) => !LABELS.test(t)) ?? null };
}

/**
 * Theater Orpheus (Apeldoorn). Peppered-platform, zoals Bellevue (zie
 * leesPepperedKaarten): ~18 agendapagina's (?p54_page=N) met 16 kaarten,
 * crawl-delay 5 s (robots.txt) → ~1,5 min. Alle speeldata staan op de
 * agendapagina (paneel per productie of datum op de kaart), met tijd, status
 * en prijs; geen detailpagina's nodig. Let op: Orpheus markeert zijn eigen
 * zalen (Hanoszaal, Kleine zaal) als "in-other-location"; dat is hier dus
 * geen tournee (anders dan bij Bellevue).
 */
export async function scrapeOrpheus({ page, theater, robots, waitForTurn, log, warn }) {
  if (!robots.isAllowed(AGENDA_PATH)) {
    log(`robots.txt verbiedt ${AGENDA_PATH} op ${theater.baseUrl} — sla over.`);
    return [];
  }
  const zwaar = await blokkeerZwareBronnen(page, { ookScripts: true });
  const kaarten = await pagineerListing({
    page,
    theater,
    robots,
    waitForTurn,
    log,
    warn,
    agendaPath: AGENDA_PATH,
    maxPages: MAX_PAGINAS,
    label: 'producties',
    sleutelVan: (k) => k.entryId,
    extract: leesPepperedKaarten,
    leegIsFout: true,
  });

  const buildId = createIdBuilder();
  const opgehaaldOp = new Date().toISOString();
  const shows = [];
  const weg = {};
  const onbekend = {};
  const geenPas = {};
  const tel = (o, k) => (o[k] = (o[k] ?? 0) + 1);

  for (const k of kaarten) {
    if (!k.titel || !k.detailHref) continue;
    if (k.genres.some((g) => WEGLATEN.test(g))) {
      tel(weg, 'randprogramma (inleidingen)');
      continue;
    }
    for (const g of k.genres) if (!LABELS.test(g) && !isBekendGenre(g)) tel(onbekend, g);
    const { genre, bron: genreRuw } = genreUitTags(k.genres);
    const url = new URL(k.detailHref, theater.baseUrl).toString();
    const sub = k.maker; // .subtitle
    const omschrijving = sub && (isWervend(sub) || OMSCHRIJVING.test(sub));
    // Staat de voorstelling al in de titel ("Najib & Roué: Alles is Comedy"), dan niet omdraaien.
    const artiestEerst = k.genres.some((g) => ARTIEST_EERST.test(g)) && !/:\s/.test(k.titel);
    const prijs = laagstePrijs(k.prijs);
    const parseDay = createDutchAbbrevDayParser();

    for (const r of k.rijen) {
      if (!r.dagTekst || /^geweest$/i.test(r.statusTekst ?? '')) continue;
      const datum = parseDay(r.dagTekst);
      if (!datum) {
        log(`kon datum niet lezen: "${r.dagTekst}" (${k.titel}) — overgeslagen.`);
        continue;
      }
      const status = r.statusTekst ?? k.knop;
      const extern = /extern/i.test(status ?? '');
      const gratis = /vrij toegankelijk|gratis/i.test(status ?? '') || prijs === 0;
      const rijPrijs = laagstePrijs(r.prijsTekst) ?? prijs;
      const teDuur = rijPrijs != null && rijPrijs > PODIUMPAS_MAX_PRIJS;
      const podiumpas = theater.podiumpas && !extern && !gratis && !teDuur;
      if (!podiumpas) tel(geenPas, extern ? 'tickets extern' : gratis ? 'gratis' : `prijs vanaf €${rijPrijs}`);
      const show = {
        id: buildId(theater.id, k.titel, datum, extractTime(r.tijdTekst)),
        titel: k.titel,
        theaterId: theater.id,
        theaterNaam: theater.naam,
        stad: theater.stad,
        zaal: r.venue ?? k.zaal ?? null,
        podiumpas,
        datum,
        tijd: extractTime(r.tijdTekst),
        genre,
        genreRuw,
        beschikbaarheid: orpheusStatus(status),
        beschrijving: omschrijving ? sub : zonderMeerInfo(k.beschrijving) ?? null,
        maker: omschrijving ? null : sub,
        prijs: rijPrijs,
        reserverenUrl: r.href && /^https?:|^\//.test(r.href) && !r.href.startsWith('#') ? new URL(r.href, theater.baseUrl).toString() : url,
        bron: url,
        opgehaaldOp,
      };
      // Artiest als titel, voorstelling als ondertitel → "Voorstelling – Artiest".
      shows.push(artiestEerst && show.maker ? pasTitelConventieToe(show, { artiest: k.titel, voorstelling: sub, makerWordtLeeg: true, alleGenres: true }) : show);
    }
  }
  const lijst = (o) => Object.entries(o).map(([x, n]) => `${x} (${n})`).join(', ');
  if (Object.keys(weg).length) log(`weggelaten: ${lijst(weg)}`);
  if (Object.keys(geenPas).length) log(`podiumpas: false bij ${lijst(geenPas)}`);
  if (Object.keys(onbekend).length) warn(`onbekende brongenres (nu Overig): ${lijst(onbekend)}`);
  log(`${zwaar.verzoeken()} verzoek(en) naar de site (plus robots.txt); ${zwaar.geblokkeerd()} afbeeldingen/scripts/fonts niet geladen`);
  return shows;
}
