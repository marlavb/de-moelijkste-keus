import { createDutchDayParser, extractTime, createIdBuilder } from '../lib/normalize.js';
import { normalizeGenre, isBekendGenre } from '../lib/genre.js';
import { pasTitelConventieToe, isWervend, isGeenMaker, titelUitKopEnOndertitel } from '../lib/titels.js';
import { vervallenStatus } from '../lib/beschikbaarheid.js';
import { blokkeerZwareBronnen } from '../lib/zwareBronnen.js';
import { gaNaar } from '../lib/diagnose.js';
import { makerStaatInTitel } from '../../public/js/weergave.js';

const AGENDA_PATH = '/theater/';

// Podiumpas bij De Hofnar (bron: https://www.hofnar.nl/podiumpas/, 6 okt
// 2026): "uitsluitend … bij reguliere professionele voorstellingen in Theater
// De Hofnar (dus niet bij voorstellingen uit eigen streek of bij
// kinderbuffetten)", en niet bij "voorstellingen waarbij de kaartverkoop door
// derden wordt verzorgd (o.a. Tonpraoten en YesJazz)". Uit de agenda af te
// leiden: de genoemde namen (Yes Jazz, Tonpraoten, kinderbuffet). "Eigen
// streek" staat er niet bij als label: niet toegepast (akkoord 6 okt 2026,
// open vraag 7). Geen prijsgrens genoemd.
const PODIUMPAS_UITGESLOTEN = /\b(yes ?jazz|tonpraoten|kinderbuffet)/i;

// Titelvolgorde (okt 2026): titel (h4.event-item__title) en teaser.
// Over alle 129 producties (6 okt 2026): vast Maker / Titel bij Cabaret
// (op "Comedy Café" na, waar de teaser een omschrijving is) en
// Theatercollege (6 van 6): "Joep en Rob" / "De Verbinders" → "De
// Verbinders – Joep en Rob". Vast Titel / Maker bij Jeugdtheater ("Pippi en
// de Piraten (6+)" / "Theater Terra"). Bij Muziek, Show, Toneel, Musical en
// Klassiek wisselt het ("Century's Crime" / "A Tribute to Supertramp",
// "Revue aon de Mert" / "Stichting Carnavalsviering Striepersgat"): daar de
// oude aanpak. "Yes Jazz" is geen titel of maker maar de concertreeks (de
// externe organisator, bij 6 verschillende bands): die gaat naar de
// beschrijving.
const VOLGORDE_PER_GENRE = { cabaret: 'maker-titel', theatercollege: 'maker-titel', jeugdtheater: 'titel-maker' };
const REEKS = /^yes ?jazz$/i;

// Muziek (7 okt 2026, na de eerste nachtrun): bijna altijd Artiest /
// Voorstelling ("Loïs Lane" / "Loïs Lane in concert: 40 jaar", "Tim Knol" /
// "Wanderings"). Uitzonderingen: een tribute of tagline als teaser ("The
// Cosmic Carnival" / "A tribute to Fleetwood Mac", "Best of Ireland" / "De
// grootste hits uit Ierland!") gaat naar de beschrijving; een organisator of
// ensemble ("Bandjesdag" / "de Hofnar – kunstencentrum", "UNA Proms" /
// "Harmonie en slagwerkgroep UNA") blijft maker.
const TAGLINE = /tribute|hit show|grootste hits/i;
const ORGANISATOR = /kunstencentrum|^harmonie\b/i;

/** Titelvolgorde van een Hofnar-productie (zie titelUitKopEnOndertitel), of null: oude aanpak. */
export function hofnarVolgorde(genre, teaser) {
  if (REEKS.test(teaser ?? '')) return 'titel-beschrijving';
  const g = String(genre ?? '').toLowerCase();
  if (g === 'muziek' && teaser) {
    if (TAGLINE.test(teaser)) return 'titel-beschrijving';
    if (ORGANISATOR.test(teaser)) return 'titel-maker';
    return 'maker-titel';
  }
  return VOLGORDE_PER_GENRE[g] ?? null;
}

// Geen voorstelling (inventarisatie, akkoord 6 okt 2026): evenementen en
// festivals.
const GEEN_VOORSTELLING_GENRES = new Set(['evenement', 'festival']);

// Draait in de browser: de producties op de overzichtspagina.
function leesOverzicht() {
  const tekst = (el) => el?.textContent.replace(/\s+/g, ' ').trim() || null;
  return [...document.querySelectorAll('a.event-item')].map((a) => ({
    href: a.getAttribute('href'),
    titel: tekst(a.querySelector('.event-item__title')),
    teaser: tekst(a.querySelector('.event-item__teaser')),
    genre: tekst(a.querySelector('.event-item__genre')),
    datumTekst: tekst(a.querySelector('.event-item__date')),
    knopTekst: tekst(a.querySelector('.event-item__button .btn')),
  }));
}

// Draait in de browser: de speeldata op een productiepagina.
function leesDetail() {
  const tekst = (el) => el?.textContent.replace(/\s+/g, ' ').trim() || null;
  const prijs = [...document.querySelectorAll('.event-detail span, .event-detail div')].map((el) => tekst(el)).find((t) => /^€\s*\d/.test(t ?? '')) ?? null;
  const rijen = [...document.querySelectorAll('.event-detail__dates--full .event-date-item')].map((item) => {
    const waarde = (titel) =>
      tekst([...item.querySelectorAll('.event-info-item')].find((i) => tekst(i.querySelector('.event-info-item__title')) === titel)?.querySelector('.event-info-item__value'));
    const knop = item.querySelector('.event-date-item__actions a, .event-date-item__actions button, .event-date-item__actions span');
    return { datum: waarde('Datum'), aanvang: waarde('Aanvang'), knopTekst: tekst(knop), knopHref: knop?.getAttribute?.('href') ?? null };
  });
  return { prijs, rijen };
}

/** "Uitverkocht | wachtlijst" → wachtlijst (je kunt je nog aanmelden); enz. */
export function hofnarStatus(tekst) {
  const t = String(tekst ?? '').toLowerCase();
  const vervallen = vervallenStatus(t);
  if (vervallen) return vervallen;
  if (t.includes('wachtlijst')) return 'wachtlijst';
  if (t.includes('uitverkocht')) return 'uitverkocht';
  if (t.includes('ticket') || t.includes('bestel') || t.includes('kaarten')) return 'beschikbaar';
  return 'onbekend';
}

/**
 * Theater de Hofnar (Valkenswaard).
 *
 * Structuur (geïnspecteerd op https://www.hofnar.nl/theater/, 6 okt 2026):
 * WordPress met Ticketmatic. Het overzicht toont alle producties (~130) op
 * één pagina, maar per productie: één datum of een reeks ("wo 04 nov - za 07
 * nov"), zonder aanvangstijd. De tijden staan alleen op de productiepagina
 * (per speeldatum datum met jaar, aanvang, eindtijd en status; plus de
 * prijs). Een andere bron met tijden is er niet: de WordPress REST-API geeft
 * 401 (gesloten voor bezoekers, 6 okt 2026), en de kaartverkoop loopt via
 * een Ticketmatic-widget per event. Dus: 1 overzicht + 1 pagina per
 * productie (niet per speeldatum), met waitForTurn() en minstens 1 s
 * pauze; robots.txt staat alles toe. ~120 verzoeken per run (~3 min).
 *
 * Titels: zie VOLGORDE_PER_GENRE hierboven; zonder vaste volgorde de teaser
 * als maker, tenzij wervend of nooit-maker.
 */
export async function scrapeHofnar({ page, theater, robots, waitForTurn, log, warn = log }) {
  if (!robots.isAllowed(AGENDA_PATH)) {
    log(`robots.txt verbiedt ${AGENDA_PATH} op ${theater.baseUrl} — sla over.`);
    return [];
  }
  const zwaar = await blokkeerZwareBronnen(page, { ookScripts: true, ookOverig: true });
  await waitForTurn();
  await gaNaar(page, theater.agendaUrl, { timeout: 45000 });
  const overzicht = await page.evaluate(leesOverzicht);
  // Sanity check: een geldige agenda heeft producties.
  if (overzicht.length === 0) throw new Error(`geen producties (a.event-item) op ${page.url()} — site veranderd of geblokkeerd?`);

  // Eén pagina per productie (sommige producties staan twee keer in het overzicht).
  const producties = new Map();
  const weg = {};
  for (const p of overzicht) {
    if (!p.href || !p.titel) continue;
    if (GEEN_VOORSTELLING_GENRES.has((p.genre ?? '').toLowerCase())) {
      weg[`${p.genre}: ${p.titel}`] = 1;
      continue;
    }
    if (!producties.has(p.href)) producties.set(p.href, p);
  }

  const parseDay = createDutchDayParser();
  const buildId = createIdBuilder();
  const opgehaaldOp = new Date().toISOString();
  const shows = [];
  const onbekend = {};
  const reden = {};
  let mislukt = 0;
  let zonderData = 0;
  for (const [href, p] of producties) {
    const url = new URL(href, theater.baseUrl);
    if (!robots.isAllowed(url.pathname)) continue;
    await waitForTurn();
    let detail;
    try {
      await gaNaar(page, url.toString(), { timeout: 30000 });
      detail = await page.evaluate(leesDetail);
    } catch (err) {
      mislukt++;
      log(`kon productiepagina niet laden (${url}): ${err.message}`);
      continue;
    }
    if (detail.rijen.length === 0) zonderData++;
    if (p.genre && !isBekendGenre(p.genre)) onbekend[p.genre] = (onbekend[p.genre] ?? 0) + 1;
    const prijsM = detail.prijs?.match(/(\d+)(?:[,.](\d{2}))?/);
    const prijs = prijsM ? Number(`${prijsM[1]}.${prijsM[2] ?? '00'}`) : null;
    const uitgesloten = PODIUMPAS_UITGESLOTEN.test(`${p.titel} ${p.teaser ?? ''}`);
    for (const r of detail.rijen) {
      const datum = r.datum ? parseDay(r.datum) : null;
      if (!datum) {
        log(`kon datum niet lezen: "${r.datum}" (${p.titel}) — overgeslagen.`);
        continue;
      }
      if (uitgesloten) reden['verkoop door derden / kinderbuffet'] = (reden['verkoop door derden / kinderbuffet'] ?? 0) + 1;
      const tijd = extractTime(r.aanvang);
      const makerOk = p.teaser && !isWervend(p.teaser) && !isGeenMaker(p.teaser) && !REEKS.test(p.teaser);
      const show = {
        id: buildId(theater.id, p.titel, datum, tijd),
        titel: p.titel,
        theaterId: theater.id,
        theaterNaam: theater.naam,
        stad: theater.stad,
        podiumpas: theater.podiumpas && !uitgesloten,
        datum,
        tijd,
        genre: normalizeGenre(p.genre),
        genreRuw: p.genre,
        beschikbaarheid: hofnarStatus(r.knopTekst),
        beschrijving: makerOk ? null : p.teaser,
        maker: makerOk ? p.teaser : null,
        prijs,
        reserverenUrl: r.knopHref && /^https?:/.test(r.knopHref) ? r.knopHref : url.toString(),
        bron: url.toString(),
        opgehaaldOp,
      };
      const volgorde = hofnarVolgorde(p.genre, p.teaser);
      // Staat de artiest al in de voorstellingsnaam ("Rhobijn – 40 jaar Rowwen
      // Hèze"), dan alleen de voorstelling als titel, niet twee keer de artiest.
      const alInNaam = volgorde === 'maker-titel' && makerStaatInTitel(p.teaser, p.titel);
      const vast = alInNaam
        ? { ...show, titel: p.teaser, maker: null, beschrijving: null }
        : volgorde
          ? titelUitKopEnOndertitel(show, { kop: p.titel, ondertitel: p.teaser, volgorde })
          : null;
      shows.push(vast ?? pasTitelConventieToe(show, { artiest: p.titel, voorstelling: p.teaser, makerWordtLeeg: true }));
    }
  }
  const lijst = (o) => Object.entries(o).map(([k, n]) => `${k} (${n})`).join(', ');
  log(`${producties.size} producties, ${shows.length} speeldata.`);
  if (Object.keys(weg).length) log(`weggelaten (geen voorstelling): ${Object.keys(weg).join(', ')}`);
  if (Object.keys(reden).length) log(`podiumpas: false bij ${lijst(reden)}`);
  if (mislukt) warn(`${mislukt} productiepagina('s) niet geladen; die speeldata ontbreken deze run.`);
  if (zonderData) warn(`${zonderData} productiepagina('s) zonder speeldata — opmaak veranderd?`);
  if (Object.keys(onbekend).length) warn(`onbekende brongenres (nu Overig): ${lijst(onbekend)}`);
  log(`${zwaar.verzoeken()} verzoek(en) naar de site (plus robots.txt); ${zwaar.geblokkeerd()} afbeeldingen/scripts/fonts niet geladen`);
  return shows;
}
