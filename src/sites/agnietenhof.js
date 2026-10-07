import { pagineerListing, leesPepperedKaarten, leesSpeeldataVanDetail, laagstePrijs } from '../lib/peppered.js';
import { createDutchAbbrevDayParser, extractTime, createIdBuilder } from '../lib/normalize.js';
import { normalizeGenre, isBekendGenre } from '../lib/genre.js';
import { pasTitelConventieToe, isWervend } from '../lib/titels.js';
import { vervallenStatus } from '../lib/beschikbaarheid.js';
import { blokkeerZwareBronnen } from '../lib/zwareBronnen.js';

const AGENDA_PATH = '/agenda';
const MAX_PAGINAS = 40;

// Podiumpas bij Agnietenhof (bron:
// https://www.agnietenhof.nl/kaartverkoopinformatie-jxyz, 7 okt 2026): alleen
// via de kassa, tickets tot €50; uitgesloten zijn films, STIP-voorstellingen
// (schoolvoorstellingen/cultuureducatie), verhuringen of extern verkochte
// voorstellingen en tickets boven €50. Films laten we helemaal weg (filmtheater,
// ongeveer de helft van de agenda; zoals bij Amstelveen). STIP, extern en
// > €50: in de data met podiumpas: false.
export const PODIUMPAS_MAX_PRIJS = 50;

// Tags die geen genre zijn (wel tellen voor de Podiumpas: STIP).
const LABELS = /^(stip|special|jongeren|online creators|\d+\+|coming out day)$/i;

// Genres waar de titel de artiest is en de ondertitel de voorstelling
// ("René van Meurs" / "Noodzakelijk Kwaad").
const ARTIEST_EERST = /^(cabaret|theaterconcert|muziek|comedy|show)$/i;

// Een ondertitel die een omschrijving is, geen maker of voorstelling.
const OMSCHRIJVING = /^(met |een |in de |in het |onderdeel van|i\.s\.m\.|reprise$|\d+\+$)/i;

/** Knop- of statustekst → beschikbaarheid. */
export function agnietenhofStatus(tekst) {
  const t = String(tekst ?? '').trim().toLowerCase();
  const vervallen = vervallenStatus(t);
  if (vervallen) return vervallen;
  if (/uitverkocht/.test(t)) return 'uitverkocht';
  if (/wachtlijst/.test(t)) return 'wachtlijst';
  if (/^(tickets|laatste tickets|kaarten)/.test(t)) return 'beschikbaar';
  return 'onbekend';
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
 * Schouwburg Agnietenhof (Tiel). Peppered-platform, zoals Orpheus en Bellevue
 * (leesPepperedKaarten): ~24 agendapagina's (?p54_page=N) met 9 kaarten,
 * crawl-delay 5 s. Anders dan daar heeft een kaart met meer speeldata
 * (knop "Speeldata") hier géén paneel op de agendapagina; alleen voor die
 * kaarten (~20, theater, geen film) halen we de detailpagina
 * (leesSpeeldataVanDetail). Samen ~45 verzoeken, ~4 min.
 */
export async function scrapeAgnietenhof({ page, theater, robots, waitForTurn, log, warn }) {
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
  let details = 0;
  let detailsMislukt = 0;
  const leesFilm = (k) => k.film || k.genres.some((g) => /^film$/i.test(g));

  for (const k of kaarten) {
    if (!k.titel || !k.detailHref) continue;
    // Leeftijd achter een streep ("Ridder Ridder | 4+") → "Ridder Ridder (4+)", zoals elders.
    k.titel = k.titel.replace(/\s*\|\s*(\d+(?:,\d+)?\+)\s*$/, ' ($1)');
    if (leesFilm(k)) {
      tel(weg, 'film');
      continue;
    }
    for (const g of k.genres) if (!LABELS.test(g) && !isBekendGenre(g)) tel(onbekend, g);
    const { genre, bron: genreRuw } = genreUitTags(k.genres);
    const stip = k.genres.some((g) => /^stip$/i.test(g));
    const url = new URL(k.detailHref, theater.baseUrl).toString();
    const sub = k.maker; // .subtitle
    const omschrijving = sub && (isWervend(sub) || OMSCHRIJVING.test(sub));
    const artiestEerst = k.genres.some((g) => ARTIEST_EERST.test(g)) && !/:\s/.test(k.titel);
    const prijs = laagstePrijs(k.prijs);

    // Rijen: van de kaart, of (knop "Speeldata", meer data) van de detailpagina.
    let rijen;
    const meer = k.rijen.length === 1 && /^speeldata$/i.test(k.rijen[0].statusTekst ?? '');
    if (meer) {
      details++;
      const vanDetail = await leesSpeeldataVanDetail({ page, url, robots, waitForTurn, log });
      if (!vanDetail) {
        detailsMislukt++;
        continue;
      }
      rijen = vanDetail.map((r) => ({ datum: r.datum, tijd: r.tijd, status: r.knopTekst, href: r.href }));
    } else {
      const parseDay = createDutchAbbrevDayParser();
      rijen = [];
      for (const r of k.rijen) {
        if (!r.dagTekst || /^geweest$/i.test(r.statusTekst ?? '')) continue;
        const datum = parseDay(r.dagTekst);
        if (!datum) {
          log(`kon datum niet lezen: "${r.dagTekst}" (${k.titel}) — overgeslagen.`);
          continue;
        }
        rijen.push({ datum, tijd: extractTime(r.tijdTekst), status: r.statusTekst ?? k.knop, href: r.href });
      }
    }

    for (const r of rijen) {
      const extern = /extern/i.test(r.status ?? '');
      const teDuur = prijs != null && prijs > PODIUMPAS_MAX_PRIJS;
      const podiumpas = theater.podiumpas && !stip && !extern && !teDuur;
      if (!podiumpas) tel(geenPas, stip ? 'STIP' : extern ? 'tickets extern' : `prijs vanaf €${prijs}`);
      const show = {
        id: buildId(theater.id, k.titel, r.datum, r.tijd),
        titel: k.titel,
        theaterId: theater.id,
        theaterNaam: theater.naam,
        stad: theater.stad,
        zaal: k.zaal ?? null,
        podiumpas,
        datum: r.datum,
        tijd: r.tijd,
        genre,
        genreRuw,
        beschikbaarheid: agnietenhofStatus(r.status),
        beschrijving: omschrijving ? sub : k.beschrijving || null,
        maker: omschrijving ? null : sub,
        prijs,
        reserverenUrl: r.href && /^(https?:|\/)/.test(r.href) ? new URL(r.href, theater.baseUrl).toString() : url,
        bron: url,
        opgehaaldOp,
      };
      shows.push(artiestEerst && show.maker ? pasTitelConventieToe(show, { artiest: k.titel, voorstelling: sub, makerWordtLeeg: true, alleGenres: true }) : show);
    }
  }
  // Sanity check: producties (geen film) maar geen enkele speeldatum.
  const voorstellingen = kaarten.filter((k) => !leesFilm(k)).length;
  if (voorstellingen > 0 && shows.length === 0) throw new Error(`${voorstellingen} producties maar geen enkele speeldatum — kaart of detailpagina veranderd?`);
  if (detailsMislukt > details / 4) warn(`${detailsMislukt} van ${details} detailpagina's mislukt.`);
  const lijst = (o) => Object.entries(o).map(([x, n]) => `${x} (${n})`).join(', ');
  log(`${details} detailpagina('s) voor producties met meer speeldata`);
  if (Object.keys(weg).length) log(`weggelaten: ${lijst(weg)}`);
  if (Object.keys(geenPas).length) log(`podiumpas: false bij ${lijst(geenPas)}`);
  if (Object.keys(onbekend).length) warn(`onbekende brongenres (nu Overig): ${lijst(onbekend)}`);
  log(`${zwaar.verzoeken()} verzoek(en) naar de site (plus robots.txt); ${zwaar.geblokkeerd()} afbeeldingen/scripts/fonts niet geladen`);
  return shows;
}
