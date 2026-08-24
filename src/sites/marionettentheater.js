import { createDutchAbbrevDayParser, extractTime, createIdBuilder } from '../lib/normalize.js';

const AGENDA_PATH = '/agenda/';

function classifyBeschikbaarheid(buttons) {
  const ticketBtn = buttons.find((b) => (b.text ?? '').toLowerCase().includes('ticket') && b.href);
  if (ticketBtn) return 'beschikbaar';
  const freeBtn = buttons.find((b) => /free|gratis/i.test(b.text ?? ''));
  if (freeBtn) return 'beschikbaar';
  return 'onbekend';
}

/**
 * Haalt de agenda van Amsterdams Marionetten Theater op.
 *
 * LET OP — fragiele scraper: dit is een handmatig samengestelde
 * Elementor-pagina (WordPress page-builder) zonder semantische markup voor
 * agenda-items. Er is geen "eventcard"-achtige structuur, geen
 * data-attributen, niets om herkenbaar op te selecteren. In plaats daarvan
 * staat elke speeldatum als los stukje platte tekst in een <p>, met een
 * vast maar losjes verbonden patroon: weekdag-afkorting + punt, dag,
 * maand-afkorting (soms met punt), optioneel een tijd, en dan de titel (bv.
 * "za. 26 sept 20.00 De Impresario – W.A. Mozart"). We selecteren dus ALLE
 * <p>-elementen op de pagina en filteren met een regex op wat aan een
 * Nederlands datum-label begint — als het contentteam ooit de tekststructuur
 * wijzigt (andere afkortingen, een ander scheidingsteken, HTML rond de
 * datum), breekt deze scraper stilzwijgend (levert 0 of te weinig
 * voorstellingen) zonder dat er een duidelijke foutmelding voor is. Bij
 * problemen: eerst de ruwe <p>-tekst op /agenda/ met de hand vergelijken
 * met de regex hierboven.
 *
 * Elke datum-paragraaf staat samen met een "Info"/"Tickets"-knoppenpaar in
 * een gedeelde Elementor-rij (.elementor-section.elementor-inner-section
 * met twee kolommen) — die knoppen gebruiken we als aanvullend signaal
 * voor boekingsstatus en -link, naast de eventuele link die al in de
 * paragraaf zelf zit (bij een eigen productie als "De Impresario").
 *
 * Geen genre-informatie beschikbaar in welke vorm dan ook op deze pagina
 * (geen tags, categorieën of consistente prefixen) — genre blijft altijd
 * null in plaats van te gokken op basis van bv. een toevallig "Comedy: "-
 * voorvoegsel in één titel.
 *
 * Geen robots.txt-beperkingen (Disallow: leeg) en geen crawl-delay
 * opgegeven — standaard-minimum vertraging. Laag volume: doorgaans één
 * herhalende hoofdproductie plus af en toe een los, incidenteel item.
 */
export async function scrapeMarionettentheater({ page, theater, robots, waitForTurn, log }) {
  if (!robots.isAllowed(AGENDA_PATH)) {
    log(`robots.txt verbiedt ${AGENDA_PATH} op ${theater.baseUrl} — sla over.`);
    return [];
  }

  await waitForTurn();
  await page.goto(theater.agendaUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

  const rawItems = await page.evaluate(() => {
    const DATE_RE = /^([a-z]{2})\.\s*(\d{1,2})\s+([a-zé]+)\.?\s*((?:\d{1,2}[.:]\d{2})?)/i;
    const results = [];
    for (const p of document.querySelectorAll('p')) {
      const text = p.textContent.trim().replace(/\s+/g, ' ');
      const m = text.match(DATE_RE);
      if (!m) continue;
      const [, , day, monthRaw, timeRaw] = m;
      const titel = text.slice(m[0].length).trim();
      const detailHref = p.querySelector('a')?.getAttribute('href') ?? null;
      const section = p.closest('.elementor-section.elementor-inner-section');
      const buttons = section
        ? Array.from(section.querySelectorAll('.elementor-widget-button')).map((btn) => ({
            text: btn.querySelector('.elementor-button-text')?.textContent.trim() ?? null,
            href: btn.querySelector('a')?.getAttribute('href') ?? null,
          }))
        : [];
      results.push({ day, monthRaw, timeRaw, titel, detailHref, buttons });
    }
    return results;
  });

  log(`${rawItems.length} datum-paragrafen gevonden op ${AGENDA_PATH}`);

  const parseDay = createDutchAbbrevDayParser();
  const buildId = createIdBuilder();
  const opgehaaldOp = new Date().toISOString();
  const shows = [];

  for (const item of rawItems) {
    if (!item.titel) continue;
    const datum = parseDay(`${item.day} ${item.monthRaw.slice(0, 3)}`);
    if (!datum) {
      log(`kon datum niet parsen: "${item.day} ${item.monthRaw}" (${item.titel}) — overgeslagen.`);
      continue;
    }
    const tijd = extractTime(item.timeRaw);

    const ticketBtn = item.buttons.find((b) => (b.text ?? '').toLowerCase().includes('ticket') && b.href);
    const infoBtn = item.buttons.find((b) => (b.text ?? '').toLowerCase() === 'info' && b.href);
    const rawDetailHref = item.detailHref ?? infoBtn?.href ?? null;
    const detailUrl = rawDetailHref ? new URL(rawDetailHref, theater.baseUrl).toString() : theater.agendaUrl;
    const ticketUrl = ticketBtn?.href ? new URL(ticketBtn.href, theater.baseUrl).toString() : null;

    shows.push({
      id: buildId(theater.id, item.titel, datum, tijd),
      titel: item.titel,
      theaterId: theater.id,
      theaterNaam: theater.naam,
      stad: theater.stad,
      podiumpas: theater.podiumpas,
      datum,
      tijd,
      genre: null,
      genreRuw: null,
      beschikbaarheid: classifyBeschikbaarheid(item.buttons),
      beschrijving: null,
      reserverenUrl: ticketUrl ?? detailUrl,
      bron: theater.agendaUrl,
      opgehaaldOp,
    });
  }

  return shows;
}
