import { createDutchAbbrevDayParser, extractTime, createIdBuilder } from '../lib/normalize.js';
import { normalizeGenre, isBekendGenre } from '../lib/genre.js';
import { pasTitelConventieToe, isWervend } from '../lib/titels.js';
import { leesStandaardEvents, classifyWpBeschikbaarheid, prijsUitTekst } from '../lib/wpTheatre.js';
import { blokkeerZwareBronnen } from '../lib/zwareBronnen.js';
import { gaNaar } from '../lib/diagnose.js';

const AGENDA_PATH = '/theater/programma/';

// Podiumpas bij DOK6 (bron: https://dok6.eu/theater/podiumpas/, 30 sep 2026:
// "uitsluitend reguliere professionele voorstellingen in DOK6 Theater").
// Nagegaan in het Ticketmatic-widget (30 sep 2026): Max van den Burg (Cabaret)
// heeft het prijstype "Rang 1 - Podiumpas", Kids Live Concert 2026 (Uit de
// regio) niet. Dus false voor Uit de regio, Events, Educatie en een prijs van
// € 0. De class is_free telt niet: die staat ook bij voorstellingen van
// € 16,50 (waarschijnlijk "kinderen gratis").
const PODIUMPAS_UITGESLOTEN_GENRES = new Set(['uit-de-regio', 'events', 'educatie']);

/**
 * Haalt de agenda van DOK6 Theater (Panningen) op.
 *
 * Structuur (geïnspecteerd op https://dok6.eu/theater/programma/, 30 sep
 * 2026): WordPress met de plugin "Theater for WordPress"; alle speeldata
 * (~90) staan op één pagina als div.wp_theatre_event, zonder paginering.
 * Per speeldatum: titel en ondertitel (links naar /theater/productie/…),
 * categorie (li.wpt_production_category), "za 3 okt ‘26" en "20:15", de
 * ticketknop (Ticketmatic) en de prijs. De classes van het blok geven het
 * genre (genre-…), tags (tag-geen-kaartverkoop, tag-try-out) en is_free.
 * Eén verzoek per run (plus robots.txt).
 *
 * Titels zoals bij De Maaspoort: bij cabaret artiest in de titel en
 * voorstelling in de ondertitel (omdraaien); anders bronvolgorde met de
 * ondertitel als maker, tenzij dat een wervende zin is.
 */
export async function scrapeDok6({ page, theater, robots, waitForTurn, log, warn = log }) {
  if (!robots.isAllowed(AGENDA_PATH)) {
    log(`robots.txt verbiedt ${AGENDA_PATH} op ${theater.baseUrl} — sla over.`);
    return [];
  }
  const zwaar = await blokkeerZwareBronnen(page, { ookScripts: true });
  await waitForTurn();
  await gaNaar(page, theater.agendaUrl, { timeout: 45000 });

  const items = await leesStandaardEvents(page);
  // Sanity check: een geldige programmapagina heeft speeldata.
  if (items.length === 0) throw new Error(`geen voorstellingen (div.wp_theatre_event) op ${page.url()} — site veranderd of geblokkeerd?`);

  const parseDay = createDutchAbbrevDayParser();
  const buildId = createIdBuilder();
  const opgehaaldOp = new Date().toISOString();
  const shows = [];
  const reden = {};
  const onbekendeGenres = {};
  const knoppen = {};
  let school = 0;
  let jaarAnders = 0;

  for (const it of items) {
    if (!it.titel || !it.datum) continue;
    const klassen = it.klassen.split(/\s+/);
    const genreKlasse = klassen.find((k) => k.startsWith('genre-'))?.slice('genre-'.length) ?? null;
    // Schoolvoorstellingen: Educatie zonder kaartverkoop → weglaten.
    if (genreKlasse === 'educatie' && klassen.includes('tag-geen-kaartverkoop')) {
      school++;
      parseDay(it.datum); // de jaar-rollover blijft dezelfde volgorde zien
      continue;
    }
    const datum = parseDay(it.datum);
    if (!datum) {
      log(`kon datum niet lezen: "${it.datum}" (${it.titel}) — overgeslagen.`);
      continue;
    }
    // Controle: het jaar in "‘26" moet kloppen met wat de weekdag zegt.
    const jj = it.datum.match(/[‘'’](\d{2})\b/)?.[1];
    if (jj && datum.slice(2, 4) !== jj) jaarAnders++;
    const tijd = extractTime(it.tijd);
    const genreRuw = it.categorieen[0] ?? null;
    if (genreRuw && !isBekendGenre(genreRuw)) onbekendeGenres[genreRuw] = (onbekendeGenres[genreRuw] ?? 0) + 1;
    const prijs = prijsUitTekst(it.prijs);
    // € 0: geen reguliere voorstelling (tv-opname, prijsuitreiking, …): geen
    // Podiumpas, en de ondertitel is dan geen voorstellingsnaam ("De Cabaret
    // Club op z'n Limburgs" / "tv opnames"), dus niet omdraaien.
    const gratis = prijs === 0;
    const waarom =
      (PODIUMPAS_UITGESLOTEN_GENRES.has(genreKlasse) && genreRuw) ||
      (gratis && 'prijs € 0') ||
      null;
    if (waarom) reden[waarom] = (reden[waarom] ?? 0) + 1;
    knoppen[it.knopTekst ?? '(geen knop)'] = (knoppen[it.knopTekst ?? '(geen knop)'] ?? 0) + 1;

    const ondertitelIsMaker = it.ondertitel && !isWervend(it.ondertitel) && !gratis;
    const show = {
      id: buildId(theater.id, it.titel, datum, tijd),
      titel: it.titel,
      theaterId: theater.id,
      theaterNaam: theater.naam,
      stad: theater.stad,
      podiumpas: theater.podiumpas && !waarom,
      datum,
      tijd,
      genre: normalizeGenre(genreRuw),
      genreRuw: it.categorieen.join(', ') || null,
      beschikbaarheid: classifyWpBeschikbaarheid(it.knopTekst, it.knopKlasse),
      beschrijving: ondertitelIsMaker ? null : it.ondertitel,
      maker: ondertitelIsMaker ? it.ondertitel : null,
      prijs: Number.isFinite(prijs) ? prijs : null,
      reserverenUrl: it.ticketUrl ?? (it.href ? new URL(it.href, theater.baseUrl).toString() : theater.agendaUrl),
      bron: theater.agendaUrl,
      opgehaaldOp,
    };
    shows.push(gratis ? show : pasTitelConventieToe(show, { artiest: it.titel, voorstelling: it.ondertitel, makerWordtLeeg: true }));
  }

  const lijst = (o) => Object.entries(o).map(([k, n]) => `${k} (${n})`).join(', ');
  log(`knopteksten: ${lijst(knoppen)}`);
  if (school) log(`${school} schoolvoorstelling(en) overgeslagen (Educatie zonder kaartverkoop).`);
  if (Object.keys(reden).length) log(`podiumpas: false bij ${lijst(reden)}`);
  if (jaarAnders) warn(`${jaarAnders} speeldata waar het jaartal ("‘26") niet klopt met de weekdag — datumparser nakijken.`);
  if (Object.keys(onbekendeGenres).length) warn(`onbekende brongenres (nu Overig): ${lijst(onbekendeGenres)}`);
  log(`${zwaar.verzoeken()} verzoek(en) naar de site (plus robots.txt); ${zwaar.geblokkeerd()} afbeeldingen/scripts/fonts niet geladen`);
  return shows;
}
