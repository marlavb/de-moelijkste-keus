import { pagineerListing } from '../lib/peppered.js';
import { createDutchDayParser, extractTime, createIdBuilder } from '../lib/normalize.js';
import { normalizeGenre, isBekendGenre } from '../lib/genre.js';
import { pasTitelConventieToe, isWervend } from '../lib/titels.js';
import { vervallenStatus } from '../lib/beschikbaarheid.js';
import { blokkeerZwareBronnen } from '../lib/zwareBronnen.js';

const AGENDA_PATH = '/programma/';
const MAX_LISTING_PAGES = 30;

// Podiumpas bij De Maaspoort (bron: https://www.maaspoort.nl/informatie/
// voordeel-extras/podiumpas/, 30 sep 2026): professionele voorstellingen tot
// € 50. Niet in de genres Uit de regio, Events en Educatie, en niet op externe
// locaties (buiten het Maaspoort-gebouw). Uitzonderingen per voorstelling
// staan alleen op de detailpagina; die halen we bewust niet op.
const PODIUMPAS_UITGESLOTEN_GENRES = new Set(['uit de regio', 'events', 'educatie']);
const PODIUMPAS_PRIJSGRENS = 50;

// Zalen in het eigen gebouw ("Hela zaal", "Frans Boermans zaal", "BACKSTAGE |
// Piet Kingma zaal", "VIP foyer", "Rooftop bar" van "Moord in Maaspoort").
// Al het andere is een externe locatie ("Theater De Garage | Venlo", "Villa
// Flora | Villafloraweg 1 Venlo", Theater Krefeld, …).
const EIGEN_ZAAL = /\b(zaal|foyer|rooftop)\b/i;

// data-status van de bestelknop. "geen_webverkoop": tonen zonder label.
// Het label "verplaatst" staat bij De Maaspoort op de NIEUWE datum (die is
// gewoon te boeken: Bee Gees by MainCourse, 8 jul 2027, data-status
// "reserveren", 30 sep 2026), dus dat telt niet als "verplaatst" in onze zin
// (gaat op deze datum niet door). Alleen afgelast/geannuleerd uit het label.
function classifyBeschikbaarheid(status, label) {
  const vervallen = vervallenStatus(status) ?? (vervallenStatus(label) === 'afgelast' ? 'afgelast' : null);
  if (vervallen) return vervallen;
  const s = (status ?? '').trim().toLowerCase();
  if (s === 'uitverkocht') return 'uitverkocht';
  if (s.includes('wachtlijst')) return 'wachtlijst';
  if (s === 'reserveren' || s === 'bestellen' || s.includes('laatste')) return 'beschikbaar';
  return 'onbekend';
}

function prijsVan(tekst) {
  const m = (tekst ?? '').match(/(\d+)(?:[,.](\d{2}))?/);
  return m ? Number(`${m[1]}.${m[2] ?? '00'}`) : null;
}

/**
 * Haalt de agenda van De Maaspoort (Venlo) op.
 *
 * Structuur (geïnspecteerd op https://www.maaspoort.nl/programma/, 30 sep
 * 2026): server-rendered, 24 speeldata per pagina als div.program-block, met
 * ?page=N (de paginanummers zet JavaScript erbij; robots.txt staat het toe,
 * alleen /bestel/ niet). Per blok: link (onclick) naar
 * /programma/<productie>/<dd-mm-jjjj-uu-mm>/, titel en ondertitel, "v.a. €
 * 28,50", genre, zaal of externe locatie, "wo 30 september 2026 | 20:15",
 * een label (.program-block-label: uitverkocht, try-out, kids gratis, …) en
 * de bestelknop met data-status (reserveren, uitverkocht, geen_webverkoop).
 * Geen detailpagina's: alles staat in de listing.
 *
 * Titel en ondertitel: bij cabaret is de titel de artiest en de ondertitel
 * de voorstelling ("Martijn Koning" / "Overprikkeld"), elders is de titel de
 * voorstelling en de ondertitel de maker ("This will not end well" / "Het
 * Zuidelijk Toneel"). Dus alleen voor cabaret de titelconventie; anders de
 * bronvolgorde, met de ondertitel als maker (een wervende zin niet).
 */
export async function scrapeMaaspoort({ page, theater, robots, waitForTurn, log, warn = log }) {
  if (!robots.isAllowed(AGENDA_PATH)) {
    log(`robots.txt verbiedt ${AGENDA_PATH} op ${theater.baseUrl} — sla over.`);
    return [];
  }
  // Server-rendered: ook scripts en stylesheets zijn niet nodig.
  const zwaar = await blokkeerZwareBronnen(page, { ookScripts: true });

  const blokken = await pagineerListing({
    page,
    theater,
    robots,
    waitForTurn,
    log,
    warn,
    agendaPath: AGENDA_PATH,
    maxPages: MAX_LISTING_PAGES,
    parameter: 'page',
    leesParameter: false,
    leegIsFout: true,
    label: 'speeldata',
    sleutelVan: (b) => b.href,
    extract: () =>
      Array.from(document.querySelectorAll('.program-block')).map((el) => {
        const tekst = (sel) => el.querySelector(sel)?.textContent.replace(/\s+/g, ' ').trim() || null;
        const onclick = el.getAttribute('onclick') ?? '';
        const knop = el.querySelector('[data-hook="order-link-placeholder"]');
        return {
          href: onclick.match(/location\.href='([^']+)'/)?.[1] ?? null,
          titel: tekst('.program-block-title .title'),
          ondertitel: tekst('.program-block-title .subtitle'),
          tagline: el.getAttribute('data-label')?.trim() || null,
          prijs: tekst('.program-block-details-extra .program-block-price span'),
          genre: tekst('.program-block-details-extra .program-block-genre'),
          locatie: tekst('.program-block-location'),
          wanneer: tekst('.program-block-datetime'),
          label: tekst('.program-block-label'),
          status: knop?.getAttribute('data-status') ?? null,
        };
      }),
  });

  const parseDay = createDutchDayParser();
  const buildId = createIdBuilder();
  const opgehaaldOp = new Date().toISOString();
  const shows = [];
  const reden = {};
  const onbekendeGenres = {};
  const externe = {};
  const statussen = {};

  let school = 0;
  let nieuweDatum = 0;
  for (const b of blokken) {
    if (!b.titel || !b.wanneer || !b.href) continue;
    // Schoolvoorstellingen: Educatie zonder webverkoop (overdag, voor
    // klassen); niet publiek te boeken. Educatie mét verkoop blijft.
    if ((b.genre ?? '').toLowerCase() === 'educatie' && b.status === 'geen_webverkoop') {
      school++;
      continue;
    }
    if (/verplaatst/i.test(b.label ?? '')) nieuweDatum++;
    const datum = parseDay(b.wanneer);
    if (!datum) {
      log(`kon datum niet lezen: "${b.wanneer}" (${b.titel}) — overgeslagen.`);
      continue;
    }
    const tijd = extractTime(b.wanneer.split('|')[1] ?? '');
    if (b.genre && !isBekendGenre(b.genre)) onbekendeGenres[b.genre] = (onbekendeGenres[b.genre] ?? 0) + 1;
    const extern = b.locatie && !EIGEN_ZAAL.test(b.locatie) ? b.locatie : null;
    if (extern) externe[extern] = (externe[extern] ?? 0) + 1;
    const prijs = prijsVan(b.prijs);
    const genreSleutel = (b.genre ?? '').toLowerCase();
    const waarom =
      (PODIUMPAS_UITGESLOTEN_GENRES.has(genreSleutel) && b.genre) ||
      (extern && 'externe locatie') ||
      (prijs != null && prijs > PODIUMPAS_PRIJSGRENS && `prijs €${prijs}`) ||
      null;
    if (waarom) reden[waarom] = (reden[waarom] ?? 0) + 1;
    statussen[b.status ?? '(geen knop)'] = (statussen[b.status ?? '(geen knop)'] ?? 0) + 1;

    const ondertitelIsMaker = b.ondertitel && !isWervend(b.ondertitel);
    const show = {
      id: buildId(theater.id, b.titel, datum, tijd),
      titel: b.titel,
      theaterId: theater.id,
      theaterNaam: theater.naam,
      stad: theater.stad,
      podiumpas: theater.podiumpas && !waarom,
      datum,
      tijd,
      genre: normalizeGenre(b.genre),
      genreRuw: b.genre,
      beschikbaarheid: classifyBeschikbaarheid(b.status, b.label),
      beschrijving: b.tagline ?? (ondertitelIsMaker ? null : b.ondertitel),
      maker: ondertitelIsMaker ? b.ondertitel : null,
      prijs,
      ...(extern ? { locatie: extern } : {}),
      reserverenUrl: new URL(b.href, theater.baseUrl).toString(),
      bron: theater.agendaUrl,
      opgehaaldOp,
    };
    // Cabaret: artiest in de titel, voorstelling in de ondertitel.
    shows.push(pasTitelConventieToe(show, { artiest: b.titel, voorstelling: b.ondertitel, makerWordtLeeg: true }));
  }

  const lijst = (o) => Object.entries(o).map(([k, n]) => `${k} (${n})`).join(', ');
  log(`statussen: ${lijst(statussen)}`);
  if (school) log(`${school} schoolvoorstelling(en) overgeslagen (Educatie zonder webverkoop).`);
  if (nieuweDatum) log(`${nieuweDatum} speeldatum/-data met label "verplaatst" (nieuwe datum, gewoon te boeken).`);
  if (Object.keys(reden).length) log(`podiumpas: false bij ${lijst(reden)}`);
  if (Object.keys(externe).length) log(`externe locaties: ${lijst(externe)}`);
  if (Object.keys(onbekendeGenres).length) warn(`onbekende brongenres (nu Overig): ${lijst(onbekendeGenres)}`);
  log(`${zwaar.verzoeken()} verzoek(en) naar de site (plus robots.txt); ${zwaar.geblokkeerd()} afbeeldingen/scripts/fonts niet geladen`);
  return shows;
}
