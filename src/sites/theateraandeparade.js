import { createIdBuilder } from '../lib/normalize.js';
import { normalizeGenreFromList, isBekendGenre } from '../lib/genre.js';
import { pasTitelConventieToe, isWervend } from '../lib/titels.js';
import { blokkeerZwareBronnen } from '../lib/zwareBronnen.js';
import { pagineerListing, classifyPepperedButton } from '../lib/peppered.js';

const AGENDA_PATH = '/nl/programma';

// Podiumpas bij Theater aan de Parade (bron: https://www.theateraandeparade.nl/
// nl/podiumpas, 6 okt 2026): voorstellingen met een eersterangs ticketprijs
// tot € 50; niet bij hogere prijzen, verhuringen, verkoop door derden,
// voorstellingen met eten, concerten in de Willem Twee en voorstellingen
// waarbij de producent geen toestemming gaf. Per speeldatum staat dat in de
// eigen data van de site: het prijstype "Podiumpas - Podiumpasbezoekers"
// bestaat alleen bij de voorstellingen waar de pas geldt (bron 2 uit
// CLAUDE.md: het echte boekingssysteem). Op 20 gecontroleerde speeldata (6
// okt 2026) klopte dat precies met de regels (geen bij gastproducties en
// concerten van Willem Twee).
const PODIUMPAS_PRIJSTYPE = /podiumpas/i;

// Niet in onze agenda (akkoord 6 okt 2026): masterclasses, workshops,
// rondleidingen, Theaterlab (workshop voor kinderen) en vriendenactiviteiten.
const GEEN_VOORSTELLING = /\b(masterclass|workshops?|rondleiding|theaterlab)\b/i;
// Concerten van Willem Twee komen van Willem Twee zelf (zie dedupe.js).
const VAN_WILLEM_TWEE = /willem twee/i;

// Draait in de browser: alle programma's uit de Nuxt-state van de pagina.
function leesParade() {
  const uit = [];
  const gezien = new Set();
  const zoek = (o, diepte) => {
    if (!o || typeof o !== 'object' || diepte > 12 || gezien.has(o)) return;
    gezien.add(o);
    if (o.program && typeof o.title === 'string' && typeof o.url === 'string') {
      const p = o.program;
      uit.push({
        programId: p.id,
        titel: o.title.trim(),
        ondertitel: (o.subTitle ?? '').trim() || null,
        url: o.url,
        genres: (o.genres ?? []).map((g) => g.name),
        labels: (o.attributes ?? []).filter((a) => a.type?.name === 'Label').map((a) => a.name),
        locatieAttr: (o.attributes ?? []).find((a) => a.type?.name === 'Locatie')?.name ?? null,
        start: p.startAt ?? null,
        afgelast: p.isCanceled === true,
        wachtlijst: p.hasWaitingList === true,
        zaal: p.location?.name ?? null,
        knopTekst: p.button?.text ?? null,
        knopLink: p.button?.link ?? null,
        prijs: p.price ?? null,
        prijzen: (p.prices ?? []).map((x) => ({ prijs: x.price, type: x.type?.name ?? '', rang: x.rank?.name ?? null })),
      });
      return;
    }
    for (const v of Object.values(o)) zoek(v, diepte + 1);
  };
  zoek(window.__NUXT__?.data, 0);
  return uit;
}

/** Laagste "Normaal"-prijs (anders de prijs van het programma), of null. */
export function normaalPrijs(item) {
  const normaal = item.prijzen.filter((x) => /^normaal$/i.test(x.type) && Number.isFinite(x.prijs)).map((x) => x.prijs);
  if (normaal.length) return Math.min(...normaal);
  return Number.isFinite(item.prijs) ? item.prijs : null;
}

/**
 * Theater aan de Parade ('s-Hertogenbosch).
 *
 * Structuur (geïnspecteerd op https://www.theateraandeparade.nl/nl/programma,
 * 6 okt 2026): Nuxt-site van The Cre8ion.Lab, server-side gerenderd met de
 * volledige state in window.__NUXT__ (een inline script; de scripts van de
 * site zelf laden we niet). 10 speeldata per pagina, ~35 pagina's (?page=N,
 * robots.txt staat alles toe). Per speeldatum: start, isCanceled,
 * hasWaitingList, zaal, knop (tekst + link), genres, labels (Gastproductie,
 * Reprise, Tolk, Vriendenactiviteit), locatie (Theater aan de Parade, Grote
 * Kerk, Willem Twee) en alle prijzen met prijstype. Geen detailpagina's.
 * ~36 verzoeken per run.
 *
 * Titels: bij cabaret artiest/voorstelling ("René van Meurs" /
 * "Noodzakelijk kwaad") → "Noodzakelijk kwaad – René van Meurs"; anders de
 * ondertitel als maker, tenzij wervend.
 */
export async function scrapeTheaterAanDeParade({ page, theater, robots, waitForTurn, log, warn = log }) {
  if (!robots.isAllowed(AGENDA_PATH)) {
    log(`robots.txt verbiedt ${AGENDA_PATH} op ${theater.baseUrl} — sla over.`);
    return [];
  }
  const zwaar = await blokkeerZwareBronnen(page, { ookScripts: true, ookOverig: true });
  const items = await pagineerListing({
    page,
    theater,
    robots,
    waitForTurn,
    log,
    warn,
    agendaPath: AGENDA_PATH,
    extract: leesParade,
    sleutelVan: (it) => `${it.programId}`,
    maxPages: 60,
    parameter: 'page',
    leesParameter: false,
    leegIsFout: true,
    label: 'speeldata',
  });

  const buildId = createIdBuilder();
  const opgehaaldOp = new Date().toISOString();
  const shows = [];
  const weg = {};
  const onbekend = {};
  const zonderPas = {};
  for (const it of items) {
    if (!it.titel || !it.start) continue;
    const reden =
      ((VAN_WILLEM_TWEE.test(it.zaal ?? '') || VAN_WILLEM_TWEE.test(it.knopTekst ?? '') || VAN_WILLEM_TWEE.test(it.locatieAttr ?? '')) && 'concert van Willem Twee') ||
      ((it.labels.some((l) => /vriendenactiviteit/i.test(l)) || /^vriendenactiviteit$/i.test(it.ondertitel ?? '')) && 'vriendenactiviteit') ||
      (GEEN_VOORSTELLING.test(`${it.titel} ${it.ondertitel ?? ''}`) && 'masterclass/workshop/rondleiding') ||
      null;
    if (reden) {
      weg[reden] = (weg[reden] ?? 0) + 1;
      continue;
    }
    const datum = it.start.slice(0, 10);
    const tijd = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(it.start) ? it.start.slice(11, 16) : null;
    for (const g of it.genres) if (!isBekendGenre(g)) onbekend[g] = (onbekend[g] ?? 0) + 1;
    const knop = classifyPepperedButton(it.knopTekst);
    const beschikbaarheid = it.afgelast ? 'afgelast' : it.wachtlijst ? 'wachtlijst' : knop ?? 'onbekend';
    const podiumpas = theater.podiumpas && it.prijzen.some((x) => PODIUMPAS_PRIJSTYPE.test(x.type));
    if (!podiumpas) {
      const waarom = it.labels.find((l) => /gastproductie/i.test(l)) ?? (it.prijzen.length ? 'geen prijstype Podiumpas' : 'geen prijzen');
      zonderPas[waarom] = (zonderPas[waarom] ?? 0) + 1;
    }
    const eigenGebouw = !it.locatieAttr || /theater aan de parade/i.test(it.locatieAttr);
    const makerOk = it.ondertitel && !isWervend(it.ondertitel);
    const show = {
      id: buildId(theater.id, it.titel, datum, tijd),
      titel: it.titel,
      theaterId: theater.id,
      theaterNaam: theater.naam,
      stad: theater.stad,
      ...(eigenGebouw ? {} : { locatie: it.locatieAttr }),
      zaal: it.zaal,
      podiumpas,
      datum,
      tijd,
      genre: normalizeGenreFromList(it.genres),
      genreRuw: it.genres.join(', ') || null,
      beschikbaarheid,
      beschrijving: makerOk ? null : it.ondertitel,
      maker: makerOk ? it.ondertitel : null,
      prijs: normaalPrijs(it),
      reserverenUrl: it.knopLink && /^https?:/.test(it.knopLink) ? it.knopLink : new URL(it.url, theater.baseUrl).toString(),
      bron: new URL(it.url, theater.baseUrl).toString(),
      opgehaaldOp,
    };
    shows.push(pasTitelConventieToe(show, { artiest: it.titel, voorstelling: it.ondertitel, makerWordtLeeg: true }));
  }
  const lijst = (o) => Object.entries(o).map(([k, n]) => `${k} (${n})`).join(', ');
  if (Object.keys(weg).length) log(`weggelaten: ${lijst(weg)}`);
  if (Object.keys(zonderPas).length) log(`podiumpas: false bij ${lijst(zonderPas)}`);
  if (Object.keys(onbekend).length) warn(`onbekende brongenres (nu Overig): ${lijst(onbekend)}`);
  log(`${zwaar.verzoeken()} verzoek(en) naar de site (plus robots.txt); ${zwaar.geblokkeerd()} afbeeldingen/scripts/fonts niet geladen`);
  return shows;
}
