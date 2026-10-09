import { createDutchAbbrevDayParser, extractTime, createIdBuilder } from '../lib/normalize.js';
import { normalizeGenre, normalizeGenreFromList, isBekendGenre } from '../lib/genre.js';
import { pasTitelConventieToe } from '../lib/titels.js';
import { blokkeerZwareBronnen } from '../lib/zwareBronnen.js';
import { classifyPepperedButton } from '../lib/peppered.js';
import { leesDataLayerInBrowser, datumMetJaar, pagineerCre8ion } from '../lib/cre8ion.js';

const AGENDA_PATH = '/nl/agenda';

// Podiumpas bij Schouwburg Concertzaal: op podiumpas.nl/waar-te-besteden (6
// okt 2026), met een link naar de homepage; de eigen site noemt de pas
// nergens (gezocht op /nl/je-bezoek/tickets, 6 okt 2026). Het boekingswidget
// gaf geen uitsluitsel. Daarom (akkoord 6 okt 2026, open vraag 2) Podiumpas
// bij alle voorstellingen, zonder prijsgrens; alleen gratis voorstellingen
// niet (geen kaartje nodig). In config.js een melding dat de voorwaarden nog
// niet bekend zijn.

// Zalen in het eigen gebouw (dataLayer item_category2). Iets anders is een
// externe locatie: die komt in `locatie`.
const EIGEN_ZALEN = new Set(['schouwburg', 'concertzaal', 'studio', 'jacques de leeuwzaal', 'hoofdhal', 'schouwburgfoyer', 'kleine zaal', 'grote zaal']);

// Niet in onze agenda (akkoord 6 okt 2026, open vraag 6 en de ontdubbeling):
// - locatie "De Nieuwe Vorst": die komt van De Nieuwe Vorst zelf;
// - Benee (stadscafé, terras): pubquiz en diner, geen voorstellingen;
// - masterclasses, workshops, werksessies en het professionele programma
//   van de Dansdagen.
const OVERSLAAN_LOCATIE = /^(de nieuwe vorst|benee\b)/i;
const OVERSLAAN_TITEL = /\b(masterclass(es)?|workshops?|werksessies?|professioneel programma|pubquiz)\b/i;

// Draait in de browser, met de dataLayer (id → gegevens) als argument.
function leesSct(dl) {
  const tekst = (el) => el?.textContent.replace(/\s+/g, ' ').trim() || null;
  return [...document.querySelectorAll('ul.events-list li.paging-container')]
    .map((li) => {
      const a = li.querySelector('h3.title a[data-detail-link]');
      if (!a) return null;
      const id = a.getAttribute('data-detail-link');
      const knop = li.querySelector('a.btn-ticket');
      const mobiel = li.querySelector('.date-wrapper-mobile');
      return {
        id,
        kop: tekst(a),
        ondertitel: tekst(li.querySelector('p.subtitle')),
        tags: [...li.querySelectorAll('span.tag')].map((s) => tekst(s)).filter(Boolean),
        datumTekst: tekst(mobiel?.querySelector('p.date')) ?? tekst(li.querySelector('p.date')),
        tijdTekst: tekst(mobiel?.querySelector('p.time')) ?? tekst(li.querySelector('p.time')),
        knopTekst: tekst(knop),
        href: a.getAttribute('href'),
        dl: dl[id] ?? null,
      };
    })
    .filter(Boolean);
}

const EXTRACT = `(() => { const dl = (${leesDataLayerInBrowser.toString()})(); return (${leesSct.toString()})(dl); })()`;

/**
 * Schouwburg Concertzaal Tilburg.
 *
 * Structuur (geïnspecteerd op https://www.schouwburgconcertzaaltilburg.nl/
 * nl/agenda, 6 okt 2026): CMS van The Cre8ion.Lab (lib/cre8ion.js), ~23
 * speeldata per pagina, 17 pagina's (?page=N; filters als ?genre= verbiedt
 * robots.txt, die gebruiken we niet). Per speeldatum (li.paging-container):
 * kop (maker), ondertitel (voorstelling), genre(s), "do 08 okt 2026" en
 * tijd, en de knop (Tickets, Laatste tickets, Wachtlijst, Gratis toegang,
 * Aanmelden). Per programma een dataLayer-script met o.a. de zaal of
 * locatie. ~18 verzoeken per run.
 *
 * Titels: de site noemt een programma zelf "KORDAAT - Kor Hoebe" (dataLayer
 * item_name), met de maker als kop en de voorstelling als ondertitel. Dus
 * bij cabaret "KORDAAT – Kor Hoebe"; bij andere genres titel = ondertitel
 * en maker = kop. Zonder ondertitel is de kop de titel.
 */
export async function scrapeSchouwburgConcertzaal({ page, theater, robots, waitForTurn, log, warn = log }) {
  if (!robots.isAllowed(AGENDA_PATH)) {
    log(`robots.txt verbiedt ${AGENDA_PATH} op ${theater.baseUrl} — sla over.`);
    return [];
  }
  const zwaar = await blokkeerZwareBronnen(page, { ookScripts: true });
  const items = await pagineerCre8ion({
    page,
    theater,
    robots,
    waitForTurn,
    log,
    warn,
    agendaPath: AGENDA_PATH,
    extract: EXTRACT,
    sleutelVan: (it) => `${it.id}|${it.datumTekst}|${it.tijdTekst}`,
  });

  const parseDay = createDutchAbbrevDayParser();
  const buildId = createIdBuilder();
  const opgehaaldOp = new Date().toISOString();
  const shows = [];
  const weg = {};
  const onbekend = {};
  const knoppen = {};
  for (const it of items) {
    if (!it.kop) continue;
    const terugval = parseDay(it.datumTekst ?? ''); // ook voor de jaar-rollover
    const datum = datumMetJaar(it.datumTekst) ?? terugval;
    if (!datum) {
      log(`kon datum niet lezen: "${it.datumTekst}" (${it.kop}) — overgeslagen.`);
      continue;
    }
    const plek = it.dl?.zaal ?? null;
    const titelTekst = `${it.ondertitel ?? ''} ${it.kop}`;
    const reden = (plek && OVERSLAAN_LOCATIE.test(plek) && `locatie ${plek}`) || (OVERSLAAN_TITEL.test(titelTekst) && 'workshop/masterclass/werksessie') || null;
    if (reden) {
      weg[reden] = (weg[reden] ?? 0) + 1;
      continue;
    }
    const beschikbaarheid = classifyPepperedButton(it.knopTekst);
    if (beschikbaarheid === null) continue;
    knoppen[it.knopTekst ?? '(geen knop)'] = (knoppen[it.knopTekst ?? '(geen knop)'] ?? 0) + 1;
    for (const g of it.tags) if (!isBekendGenre(g)) onbekend[g] = (onbekend[g] ?? 0) + 1;
    const tijd = extractTime(it.tijdTekst);
    const prijs = Number.isFinite(it.dl?.prijs) ? it.dl.prijs : null;
    const gratis = prijs === 0 || /gratis/i.test(it.knopTekst ?? '');
    const eigen = !plek || EIGEN_ZALEN.has(plek.toLowerCase());
    const titel = it.ondertitel || it.kop;
    const show = {
      id: buildId(theater.id, titel, datum, tijd),
      titel,
      theaterId: theater.id,
      theaterNaam: theater.naam,
      stad: theater.stad,
      ...(eigen ? {} : { locatie: plek }),
      zaal: eigen ? plek : null,
      // Gratis: geen pas nodig (false); anders die van het theater (true, of
      // null = nog niet bekend).
      podiumpas: gratis ? false : theater.podiumpas,
      datum,
      tijd,
      genre: normalizeGenreFromList(it.tags) ?? normalizeGenre(it.tags[0] ?? it.dl?.genre ?? null),
      genreRuw: it.tags.join(', ') || it.dl?.genre || null,
      beschikbaarheid,
      beschrijving: null,
      maker: it.ondertitel ? it.kop : null,
      prijs: gratis ? 0 : prijs,
      reserverenUrl: new URL(it.href, theater.baseUrl).toString(),
      bron: new URL(it.href, theater.baseUrl).toString(),
      opgehaaldOp,
    };
    shows.push(it.ondertitel ? pasTitelConventieToe(show, { artiest: it.kop, voorstelling: it.ondertitel, makerWordtLeeg: true }) : show);
  }
  const lijst = (o) => Object.entries(o).map(([k, n]) => `${k} (${n})`).join(', ');
  log(`knopteksten: ${lijst(knoppen)}`);
  if (Object.keys(weg).length) log(`weggelaten: ${lijst(weg)}`);
  if (Object.keys(onbekend).length) warn(`onbekende brongenres (nu Overig): ${lijst(onbekend)}`);
  log(`${zwaar.verzoeken()} verzoek(en) naar de site (plus robots.txt); ${zwaar.geblokkeerd()} afbeeldingen/scripts/fonts niet geladen`);
  return shows;
}
