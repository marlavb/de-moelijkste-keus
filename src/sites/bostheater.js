import { extractTime, createIdBuilder } from '../lib/normalize.js';
import { normalizeGenre } from '../lib/genre.js';

const AGENDA_PATH = '/ons-programma/';
const MAX_LISTING_PAGES = 20;

/**
 * Haalt de volledige agenda van het Amsterdamse Bostheater op.
 *
 * Structuur (geïnspecteerd op https://bostheater.nl/ons-programma/, aug 2026):
 * - robots.txt: alleen /wp-content/uploads/wpforms/ verboden, geen crawl-delay.
 * - Server-rendered. Elke productie is een <article class="event-card">,
 *   gepagineerd via ?sf_paged=N (wp-pagenavi) — geen "load more"-knop.
 * - .event-card-terms__type is "Concert"/"Theater" voor echte voorstellingen,
 *   maar ook "randprogrammering" voor een terugkerende boswandeling
 *   ("Boswandeling met Nico de Bosexpert") die als los-programma-item
 *   meeloopt in dezelfde lijst — die filteren we eruit op type, niet op de
 *   datum-range (zie hieronder waarom dat niet betrouwbaar is). Een generiek
 *   "Toegangsticket Bosfest"-dagkaartje kan in het Bosfest-seizoen ook
 *   verschijnen (niet aanwezig op het moment van bouwen) — die filteren we
 *   defensief op titel.
 * - BELANGRIJK: de kaart toont maar één datum (of, bij een reeks, een
 *   from/t-m-range) — dat is dus NIET betrouwbaar om reeksen ("Not Quichot":
 *   4 speeldata, "Voor ze verdwijnen": 5 speeldata met wisselende tijden) te
 *   onderscheiden van het ene randprogrammering-item dat ook als range
 *   getoond wordt. Voor élke productie bezoeken we daarom de detailpagina
 *   (/events/<slug>), die een <ul class="event-dates__list"> heeft met per
 *   speeldatum een eigen <li class="event-dates__item"> met exacte
 *   datum+tijd (<time datetime="2026-09-04 15:00">) en boekingsstatus
 *   (class-modifier "--sold-out" + .event-dates__sold-out-msg).
 * - De boekingsknop per speeldatum is ofwel een <a> (extern, bv. Eventim,
 *   met een echte href) ofwel een <button> (intern "voordemensen"-widget,
 *   zonder href) — in het laatste geval valt reserverenUrl terug op de
 *   detailpagina.
 * - Genre komt van .event-card-terms__genre-name op de kaart ("Muziek",
 *   "Toneel", "Overig") — die liggen al zo dicht bij ons eigen schema dat er
 *   geen aparte genre.js-mapping nodig is (normalizeGenre() valt voor
 *   "overig" toch al terug op "Overig").
 * - Podiumpas is bij dit theater NIET gewoon aan-of-uit voor de hele
 *   locatie (zoals overal elders in config.js) — volgens
 *   bostheater.nl/podiumpas/ is de pas uitsluitend te gebruiken bij
 *   theatervoorstellingen (en Bosfest-toegangstickets, die al eerder in de
 *   pipeline weggefilterd worden op titel/type), expliciet NIET bij
 *   concerten of filmavonden. .event-card-terms__type is hier het
 *   betrouwbare signaal (bevestigd via de site-eigen filter-taxonomie
 *   `_sft_event_type`, met als enige huidige waarden concert/theater/
 *   randprogrammering) — type "theater" is dus podiumpas-geldig, "concert"
 *   niet. Twee bij naam genoemde uitzonderingen op diezelfde pagina ("De
 *   laatste minuten", "Maanlicht in Etten-Leur") staan momenteel niet in de
 *   actieve agenda (geen toekomstige speeldata meer), dus hun eigen
 *   type-taxonomie kon niet herbevestigd worden — vandaar hardcoded op
 *   titel, zoals de podiumpas.nl-pagina ze zelf ook expliciet bij naam
 *   noemt in plaats van onder de algemene "theatervoorstellingen"-regel.
 */
const PODIUMPAS_TITLE_EXCEPTIONS = new Set(['de laatste minuten', 'maanlicht in etten-leur']);

function isPodiumpasEligible(card) {
  if (card.type?.trim().toLowerCase() === 'theater') return true;
  return PODIUMPAS_TITLE_EXCEPTIONS.has(card.titel?.trim().toLowerCase());
}

export async function scrapeBostheater({ page, theater, robots, waitForTurn, log }) {
  if (!robots.isAllowed(AGENDA_PATH)) {
    log(`robots.txt verbiedt ${AGENDA_PATH} op ${theater.baseUrl} — sla over.`);
    return [];
  }

  const cards = [];
  for (let pageNum = 1; pageNum <= MAX_LISTING_PAGES; pageNum++) {
    const url = pageNum === 1 ? theater.agendaUrl : `${theater.agendaUrl}?sf_paged=${pageNum}`;
    const listingPath = pageNum === 1 ? AGENDA_PATH : `${AGENDA_PATH}?sf_paged=${pageNum}`;
    if (!robots.isAllowed(listingPath)) {
      log(`robots.txt verbiedt ${listingPath} — stop met pagineren.`);
      break;
    }

    await waitForTurn();
    let pageCards;
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      pageCards = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('article.event-card')).map((card) => {
          const type = card.querySelector('.event-card-terms__type')?.textContent.trim() ?? null;
          const genreRuw = card.querySelector('.event-card-terms__genre-name')?.textContent.trim() ?? null;
          const titel = card.querySelector('.event-card-title')?.textContent.trim() ?? null;
          const beschrijving = card.querySelector('.event-card-description p')?.textContent.trim() ?? null;
          const detailHref =
            Array.from(card.querySelectorAll('.event-card__actions a')).find((a) =>
              a.getAttribute('href')?.includes('/events/')
            )?.getAttribute('href') ?? null;
          return { type, genreRuw, titel, beschrijving, detailHref };
        });
      });
    } catch (err) {
      log(`kon listingpagina ${pageNum} niet laden: ${err.message} — probeer volgende pagina.`);
      continue;
    }

    log(`pagina ${pageNum}: ${pageCards.length} producties`);
    if (pageCards.length === 0) break;
    cards.push(...pageCards);
  }

  const seenHrefs = new Set();
  const relevantCards = cards.filter((card) => {
    if (!card.titel || !card.detailHref) return false;
    if (card.type?.trim().toLowerCase() === 'randprogrammering') return false;
    if (/toegangsticket/i.test(card.titel)) return false;
    if (seenHrefs.has(card.detailHref)) return false;
    seenHrefs.add(card.detailHref);
    return true;
  });

  const buildId = createIdBuilder();
  const opgehaaldOp = new Date().toISOString();
  const shows = [];

  for (const card of relevantCards) {
    const detailUrl = new URL(card.detailHref, theater.baseUrl).toString();
    const detailPath = new URL(detailUrl).pathname;

    if (!robots.isAllowed(detailPath)) {
      log(`robots.txt verbiedt ${detailPath} — "${card.titel}" overgeslagen.`);
      continue;
    }

    await waitForTurn();
    let dateItems;
    try {
      await page.goto(detailUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      dateItems = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('li.event-dates__item')).map((li) => {
          const iso = li.querySelector('time[datetime]')?.getAttribute('datetime') ?? null;
          const soldOut =
            li.classList.contains('event-dates__item--sold-out') ||
            !!li.querySelector('.event-dates__sold-out-msg');
          const ticketHref = li.querySelector('a.event-dates__button')?.getAttribute('href') ?? null;
          return { iso, soldOut, ticketHref };
        });
      });
    } catch (err) {
      log(`kon detailpagina niet laden voor "${card.titel}" (${detailUrl}): ${err.message} — overgeslagen.`);
      continue;
    }

    if (dateItems.length === 0) {
      log(`geen speeldata gevonden op detailpagina voor "${card.titel}" (${detailUrl}) — overgeslagen.`);
      continue;
    }

    const podiumpas = isPodiumpasEligible(card);

    for (const item of dateItems) {
      if (!item.iso) continue;
      const datum = item.iso.slice(0, 10);
      const tijd = extractTime(item.iso.slice(10));

      shows.push({
        id: buildId(theater.id, card.titel, datum, tijd),
        titel: card.titel,
        theaterId: theater.id,
        theaterNaam: theater.naam,
        stad: theater.stad,
        podiumpas,
        datum,
        tijd,
        genre: normalizeGenre(card.genreRuw),
        genreRuw: card.genreRuw,
        beschikbaarheid: item.soldOut ? 'uitverkocht' : 'beschikbaar',
        beschrijving: card.beschrijving,
        reserverenUrl: item.ticketHref ?? detailUrl,
        bron: detailUrl,
        opgehaaldOp,
      });
    }
  }

  return shows;
}
