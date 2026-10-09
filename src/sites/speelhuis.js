import { createDutchAbbrevDayParser, extractTime, createIdBuilder } from '../lib/normalize.js';
import { normalizeGenreFromList, isBekendGenre } from '../lib/genre.js';
import { pasTitelConventieToe, isWervend, isGeenMaker, titelUitKopEnOndertitel } from '../lib/titels.js';
import { blokkeerZwareBronnen } from '../lib/zwareBronnen.js';
import { classifyPepperedButton } from '../lib/peppered.js';
import { leesDataLayerInBrowser, dataLayerDatum, pagineerCre8ion } from '../lib/cre8ion.js';
import { prijsUitTekst } from '../lib/wpTheatre.js';

const AGENDA_PATH = '/programma';

// Titelvolgorde (okt 2026): de bron heeft twee regels (h3.title en
// p.subtitle). Over alle 169 producties in de agenda (6 okt 2026) is de
// volgorde per genre vast Maker / Titel bij Cabaret (30 van 30), Dans (7),
// College (5), Show (4), Muziektheater (3), Divers (2), Beeldend theater (2),
// Comedy (1) en Opera (1): "Conny Janssen Danst" / "Danslokaal 14" →
// "Danslokaal 14 – Conny Janssen Danst". Bij Toneel, Jeugd, Muziek,
// Klassiek, Musical, Lokaal en Literair wisselt het ("Het Zuidelijk Toneel" /
// "Vondels Angels", maar "Boeing Boeing" / "Loiza Lamers …"): daar de oude
// aanpak (bronvolgorde, ondertitel als maker als dat kan).
const MAKER_TITEL_GENRES = new Set(['cabaret', 'comedy', 'college', 'dans', 'show', 'muziektheater', 'divers', 'beeldend theater', 'opera']);

// Podiumpas bij Het Speelhuis: op podiumpas.nl/waar-te-besteden (6 okt
// 2026). De eigen pagina (https://theaterspeelhuis.nl/podiumpas, 6 okt 2026)
// zegt alleen "Vanaf vandaag te gebruiken in Het Speelhuis!", zonder
// voorwaarden. Daarom (akkoord 6 okt 2026, open vraag 2) Podiumpas bij alle
// voorstellingen, zonder prijsgrens; alleen gratis voorstellingen niet (geen
// kaartje nodig, zoals bij DOK6). In config.js een melding dat de
// voorwaarden nog niet bekend zijn.

// Draait in de browser, met de dataLayer (id → gegevens) als argument.
function leesSpeelhuis(dl) {
  const tekst = (el) => el?.textContent.replace(/\s+/g, ' ').trim() || null;
  return [...document.querySelectorAll('ul.events-list li.paging-container')]
    .map((li) => {
      const a = li.querySelector('h3.title a[data-detail-link]');
      if (!a) return null;
      const id = a.getAttribute('data-detail-link');
      const knop = li.querySelector('a[data-ticket-link]');
      return {
        id,
        titel: tekst(a),
        ondertitel: tekst(li.querySelector('p.subtitle')),
        tags: [...li.querySelectorAll('span.tag')].map((s) => tekst(s)).filter(Boolean),
        datumTekst: tekst(li.querySelector('p.date')),
        tijdTekst: tekst(li.querySelector('p.time')),
        prijsTekst: tekst(li.querySelector('p.price')),
        knopTekst: tekst(knop),
        knopHref: knop?.getAttribute('href') ?? null,
        href: a.getAttribute('href'),
        dl: dl[id] ?? null,
      };
    })
    .filter(Boolean);
}

const EXTRACT = `(() => { const dl = (${leesDataLayerInBrowser.toString()})(); return (${leesSpeelhuis.toString()})(dl); })()`;

/**
 * Het Speelhuis (Helmond).
 *
 * Structuur (geïnspecteerd op https://theaterspeelhuis.nl/programma, 6 okt
 * 2026): CMS van The Cre8ion.Lab (lib/cre8ion.js), 20 speeldata per pagina,
 * ~21 pagina's (?page=N). Per speeldatum (li.paging-container): titel (h3),
 * ondertitel, genre (span.tag), "donderdag 15 okt." (zonder jaar), tijd,
 * prijs en de ticketknop (koop tickets, laatste tickets, wachtlijst, …).
 * Daarnaast per programma een dataLayer-script met zaal ("Theaterzaal - Het
 * Speelhuis") en de datum mét jaar ("15-10-2026"): die gebruiken we voor de
 * datum; de zichtbare datum alleen als terugval. ~22 verzoeken per run.
 *
 * Titels: zie MAKER_TITEL_GENRES hierboven; bij de genres met een vaste
 * volgorde "Voorstelling – Maker", bij de rest bronvolgorde met de
 * ondertitel als maker, tenzij wervend, beschrijvend (kleine letter) of
 * nooit-maker (titels.js).
 */
export async function scrapeSpeelhuis({ page, theater, robots, waitForTurn, log, warn = log }) {
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
    sleutelVan: (it) => `${it.id}|${it.dl?.datum ?? it.datumTekst}|${it.dl?.tijd ?? it.tijdTekst}`,
  });

  const parseDay = createDutchAbbrevDayParser();
  const buildId = createIdBuilder();
  const opgehaaldOp = new Date().toISOString();
  const shows = [];
  const onbekend = {};
  const knoppen = {};
  let zonderDataLayer = 0;
  let rondleidingen = 0;
  for (const it of items) {
    if (!it.titel) continue;
    const zichtbaar = parseDay(it.datumTekst); // ook voor de jaar-rollover
    const datum = dataLayerDatum(it.dl?.datum) ?? zichtbaar;
    if (!it.dl) zonderDataLayer++;
    if (!datum) {
      log(`kon datum niet lezen: "${it.datumTekst}" (${it.titel}) — overgeslagen.`);
      continue;
    }
    const tijd = extractTime(it.dl?.tijd ?? it.tijdTekst);
    const genreRuw = it.tags[0] ?? it.dl?.genre ?? null;
    // Rondleidingen zijn geen voorstelling (akkoord 6 okt 2026).
    if (/^rondleiding/i.test(genreRuw ?? '') || /^rondleiding/i.test(it.titel)) {
      rondleidingen++;
      continue;
    }
    // Samengesteld genre ("Muziek / Muziektheater", "Toneel / Muziek"): het
    // eerste deel dat we kennen; "Nabespreking" e.d. tellen niet.
    const delen = (genreRuw ?? '').split('/').map((d) => d.trim()).filter(Boolean);
    const genre = normalizeGenreFromList(delen);
    if (genreRuw && !delen.some((d) => isBekendGenre(d))) onbekend[genreRuw] = (onbekend[genreRuw] ?? 0) + 1;
    const beschikbaarheid = classifyPepperedButton(it.knopTekst);
    if (beschikbaarheid === null) continue;
    knoppen[it.knopTekst ?? '(geen knop)'] = (knoppen[it.knopTekst ?? '(geen knop)'] ?? 0) + 1;
    const prijs = prijsUitTekst(it.prijsTekst) ?? (Number.isFinite(it.dl?.prijs) ? it.dl.prijs : null);
    const gratis = prijs === 0 || /gratis/i.test(it.prijsTekst ?? '');
    // Zaal uit de dataLayer: "Theaterzaal - Het Speelhuis"; iets anders is een externe locatie.
    const zaalTekst = it.dl?.zaal ?? null;
    const eigen = !zaalTekst || /speelhuis/i.test(zaalTekst);
    const sub = it.ondertitel;
    const makerOk = sub && !isWervend(sub) && !isGeenMaker(sub) && !/^\p{Ll}/u.test(sub);
    const show = {
      id: buildId(theater.id, it.titel, datum, tijd),
      titel: it.titel,
      theaterId: theater.id,
      theaterNaam: theater.naam,
      stad: theater.stad,
      ...(eigen ? {} : { locatie: zaalTekst }),
      zaal: eigen && zaalTekst ? zaalTekst.replace(/\s*-\s*Het Speelhuis\s*$/i, '') || null : null,
      // Gratis: geen pas nodig (false); anders die van het theater (true, of
      // null = nog niet bekend).
      podiumpas: gratis ? false : theater.podiumpas,
      datum,
      tijd,
      genre: genre ?? (genreRuw ? 'Overig' : null),
      genreRuw: it.tags.join(', ') || genreRuw,
      beschikbaarheid,
      beschrijving: makerOk ? null : sub,
      maker: makerOk ? sub : null,
      prijs: gratis ? 0 : prijs,
      reserverenUrl: new URL(it.knopHref ?? it.href, theater.baseUrl).toString(),
      bron: new URL(it.href, theater.baseUrl).toString(),
      opgehaaldOp,
    };
    const vast = MAKER_TITEL_GENRES.has((delen[0] ?? '').toLowerCase()) ? titelUitKopEnOndertitel(show, { kop: it.titel, ondertitel: sub, volgorde: 'maker-titel' }) : null;
    shows.push(vast ?? pasTitelConventieToe(show, { artiest: it.titel, voorstelling: sub, makerWordtLeeg: true }));
  }
  const lijst = (o) => Object.entries(o).map(([k, n]) => `${k} (${n})`).join(', ');
  log(`knopteksten: ${lijst(knoppen)}`);
  if (rondleidingen) log(`${rondleidingen} rondleiding(en) weggelaten.`);
  if (zonderDataLayer) log(`${zonderDataLayer} speeldata zonder dataLayer (datum uit de tekst, jaar via rollover).`);
  if (Object.keys(onbekend).length) warn(`onbekende brongenres (nu Overig): ${lijst(onbekend)}`);
  log(`${zwaar.verzoeken()} verzoek(en) naar de site (plus robots.txt); ${zwaar.geblokkeerd()} afbeeldingen/scripts/fonts niet geladen`);
  return shows;
}
