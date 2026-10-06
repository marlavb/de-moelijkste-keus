import { createDutchAbbrevDayParser, extractTime, createIdBuilder } from '../lib/normalize.js';
import { normalizeGenre, isBekendGenre } from '../lib/genre.js';
import { pasTitelConventieToe, isWervend, isGeenMaker, titelUitKopEnOndertitel } from '../lib/titels.js';
import { blokkeerZwareBronnen } from '../lib/zwareBronnen.js';
import { gaNaar } from '../lib/diagnose.js';
import { leesStandaardEvents, classifyWpBeschikbaarheid, prijsUitTekst } from '../lib/wpTheatre.js';

const AGENDA_PATH = '/programma/';

// Podiumpas bij Kattendans (bron: https://kattendans.nl/podiumpas/, 6 okt
// 2026): "alleen nog te gebruiken voor het boeken van tickets met een
// reguliere prijs tot maximaal € 50" en "uitsluitend … bij vele reguliere
// professionele voorstellingen in de Kattendans. Let op: sommige
// professionele voorstellingen zijn uitgesloten." Welke dat zijn, staat er
// niet: die passen we dus niet toe (akkoord 6 okt 2026, open vraag 7).
// Wel af te leiden: geen film (geen voorstelling), geen "Uit de regio"
// (amateurgezelschappen uit de streek, niet professioneel), niet boven € 50
// en niet gratis (€ 0: geen reguliere voorstelling, zoals bij DOK6).
const PODIUMPAS_PRIJSGRENS = 50;

// Titelvolgorde (okt 2026): titel en ondertitel (.wp_theatre_event_title en
// _subtitle). Over alle 130 producties (6 okt 2026) vast Maker / Titel bij
// Cabaret (43 van 44), Comedy, Komedie, Muziektheater, Musical, Dans, Show,
// Theatercollege, Personality show, Entertainment, Uit de regio en Muziek (29
// van 30): "Tangarine" / "Running in the Family II" → "Running in the
// Family II – Tangarine". Bij Film is de ondertitel een reeksnaam
// ("Dinsdagmiddagfilm"). Bij Toneel, Special en Jeugdtheater wisselt het
// (jeugdtheater meestal "Stuntelman ◆ 4+" / "door Het Laagland", maar 4 van
// 16 met de maker bovenaan: "Arno Huibers ◆ 4+" / "Verliefd op Truus"):
// daar de oude aanpak. Bekende uitzondering
// in Muziek: "De Gouden Herinnering" / "Een zolder vol verhalen" wordt
// omgedraaid.
const VOLGORDE_PER_GENRE = {
  cabaret: 'maker-titel',
  comedy: 'maker-titel',
  komedie: 'maker-titel',
  muziektheater: 'maker-titel',
  musical: 'maker-titel',
  dans: 'maker-titel',
  show: 'maker-titel',
  theatercollege: 'maker-titel',
  'personality show': 'maker-titel',
  entertainment: 'maker-titel',
  'uit de regio': 'maker-titel',
  muziek: 'maker-titel',
  film: 'titel-beschrijving',
};
const PODIUMPAS_UITGESLOTEN_GENRES = new Set(['film', 'uit-de-regio']);

/**
 * Haalt de agenda van Kattendans (Bergeijk) op.
 *
 * Structuur (geïnspecteerd op https://kattendans.nl/programma/, 6 okt 2026):
 * WordPress met de plugin "Theater for WordPress", dezelfde standaardopmaak
 * als DOK6 (zie lib/wpTheatre.js). Alle speeldata (~144) op één pagina,
 * zonder paginering; per speeldatum titel, ondertitel, categorie, "vr 6 nov
 * ‘26", tijd, ticketknop (Ticketmatic) en prijs. Eén verzoek per run (plus
 * robots.txt, geen crawl-delay). De pagina is groot (1,7 MB HTML), maar
 * afbeeldingen, scripts en fonts laden we niet.
 *
 * Titels: zie VOLGORDE_PER_GENRE hierboven ("Rundfunk" / "Wagyu" → "Wagyu –
 * Rundfunk"; "BOINK! ◆ 4+" / "door Oortwolk" → maker Oortwolk); zonder vaste
 * volgorde bronvolgorde met de ondertitel als maker, tenzij wervend of
 * nooit-maker.
 */
export async function scrapeKattendans({ page, theater, robots, waitForTurn, log, warn = log }) {
  if (!robots.isAllowed(AGENDA_PATH)) {
    log(`robots.txt verbiedt ${AGENDA_PATH} op ${theater.baseUrl} — sla over.`);
    return [];
  }
  const zwaar = await blokkeerZwareBronnen(page, { ookScripts: true });
  await waitForTurn();
  await gaNaar(page, theater.agendaUrl, { timeout: 60000 });
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
  let jaarAnders = 0;

  for (const it of items) {
    if (!it.titel || !it.datum) continue;
    const klassen = it.klassen.split(/\s+/);
    const genreKlasse = klassen.find((k) => k.startsWith('genre-'))?.slice('genre-'.length) ?? null;
    const datum = parseDay(it.datum);
    if (!datum) {
      log(`kon datum niet lezen: "${it.datum}" (${it.titel}) — overgeslagen.`);
      continue;
    }
    const jj = it.datum.match(/[‘'’](\d{2})\b/)?.[1];
    if (jj && datum.slice(2, 4) !== jj) jaarAnders++;
    const tijd = extractTime(it.tijd);
    const genreRuw = it.categorieen[0] ?? null;
    if (genreRuw && !isBekendGenre(genreRuw)) onbekendeGenres[genreRuw] = (onbekendeGenres[genreRuw] ?? 0) + 1;
    const prijs = prijsUitTekst(it.prijs);
    const gratis = prijs === 0;
    const waarom =
      (PODIUMPAS_UITGESLOTEN_GENRES.has(genreKlasse) && genreRuw) ||
      (gratis && 'prijs € 0') ||
      (prijs != null && prijs > PODIUMPAS_PRIJSGRENS && `prijs > € ${PODIUMPAS_PRIJSGRENS}`) ||
      null;
    if (waarom) reden[waarom] = (reden[waarom] ?? 0) + 1;
    knoppen[it.knopTekst ?? '(geen knop)'] = (knoppen[it.knopTekst ?? '(geen knop)'] ?? 0) + 1;

    const sub = it.ondertitel?.replace(/^door\s+/i, '') ?? null;
    const ondertitelIsMaker = sub && !isWervend(sub) && !isGeenMaker(sub) && !gratis;
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
      maker: ondertitelIsMaker ? sub : null,
      prijs,
      reserverenUrl: it.ticketUrl ?? (it.href ? new URL(it.href, theater.baseUrl).toString() : theater.agendaUrl),
      bron: theater.agendaUrl,
      opgehaaldOp,
    };
    const volgorde = VOLGORDE_PER_GENRE[(genreRuw ?? '').toLowerCase()] ?? null;
    const vast = volgorde ? titelUitKopEnOndertitel(show, { kop: it.titel, ondertitel: it.ondertitel, volgorde }) : null;
    shows.push(vast ?? (gratis ? show : pasTitelConventieToe(show, { artiest: it.titel, voorstelling: it.ondertitel, makerWordtLeeg: true })));
  }

  const lijst = (o) => Object.entries(o).map(([k, n]) => `${k} (${n})`).join(', ');
  log(`knopteksten: ${lijst(knoppen)}`);
  if (Object.keys(reden).length) log(`podiumpas: false bij ${lijst(reden)}`);
  if (jaarAnders) warn(`${jaarAnders} speeldata waar het jaartal ("‘26") niet klopt met de weekdag — datumparser nakijken.`);
  if (Object.keys(onbekendeGenres).length) warn(`onbekende brongenres (nu Overig): ${lijst(onbekendeGenres)}`);
  log(`${zwaar.verzoeken()} verzoek(en) naar de site (plus robots.txt); ${zwaar.geblokkeerd()} afbeeldingen/scripts/fonts niet geladen`);
  return shows;
}
