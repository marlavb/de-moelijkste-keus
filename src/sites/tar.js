import { createNumericDayParser, extractTime, createIdBuilder } from '../lib/normalize.js';
import { normalizeGenre, isBekendGenre } from '../lib/genre.js';
import { gaNaar } from '../lib/diagnose.js';
import { blokkeerZwareBronnen } from '../lib/zwareBronnen.js';

const AGENDA_PATH = '/agenda/';
const MAX_VERZOEKEN = 20;

// Tags die geen genre zijn: verhaallijnen, labels, typen.
const LABELS = /^(première|no dutch required|crossing the threshold|dig where you stand|fluid voices|loading the gun|tar productie|tar-productie|projecten)$/i;

// Geen voorstelling: Happy Hour (gesprek/presentatie), residenties en workshops.
const WEGLATEN_TAG = /^(happy hour|residenties)$/i;
const WEGLATEN_TITEL = /^(happy hour\b|workshop\b)/i;

// Draait in de browser: de producties-artikelen uit de agendapagina of uit
// de HTML die het lijst-endpoint teruggeeft (`html`).
function leesArtikelen(html) {
  const t = (e) => e?.textContent.trim().replace(/\s+/g, ' ') || null;
  const root = html == null ? document : new DOMParser().parseFromString(html, 'text/html');
  const lijst = root.querySelector('[data-lazy-endpoint]');
  return {
    lazy: lijst
      ? {
          endpoint: lijst.getAttribute('data-lazy-endpoint'),
          post: lijst.getAttribute('data-lazy-post'),
          block: lijst.getAttribute('data-lazy-block'),
          offset: Number(lijst.getAttribute('data-lazy-offset')),
          size: Number(lijst.getAttribute('data-lazy-size')),
          total: Number(lijst.getAttribute('data-lazy-total')),
        }
      : null,
    rijen: [...root.querySelectorAll('article[id^="production-"]')].map((a) => {
      const h3 = a.querySelector('h3');
      const ps = [...a.querySelectorAll('h3 + div p')].map(t);
      const ticket = [...a.querySelectorAll('a')].find((x) => /^tickets/i.test(t(x) ?? ''));
      return {
        dag: t(a.querySelector('span.text-large')),
        titel: h3 ? t(h3.firstChild) ?? t(h3.querySelector('.sr-only')) : null,
        onder: ps.length > 1 ? ps[0] : null,
        tijd: ps[ps.length - 1] ?? null,
        tags: [...a.querySelectorAll('span.text-small')].map(t).filter(Boolean),
        tekst: t(a.querySelector('.col-span-4.mb-0')),
        href: a.querySelector('h3 a')?.getAttribute('href') ?? null,
        ticket: ticket?.getAttribute('href') ?? null,
        knop: ticket ? t(ticket).replace(/\s*—.*$/, '') : null,
      };
    }),
  };
}

/**
 * TAR (Theater a/d Rijn, Arnhem). WordPress: de agendapagina toont de eerste
 * 8 speeldata (een artikel per speeldatum, "05.11" zonder jaar, chronologisch);
 * de rest komt van het eigen lijst-endpoint (/wp-json/tar/v1/list, JSON met
 * HTML-rijen, `hasMore`), net als de knop "meer laden" op de site. Samen ~6
 * verzoeken. Geen statuslabels behalve de ticketknop.
 */
export async function scrapeTar({ page, theater, robots, waitForTurn, log, warn }) {
  if (!robots.isAllowed(AGENDA_PATH)) {
    log(`robots.txt verbiedt ${AGENDA_PATH} op ${theater.baseUrl} — sla over.`);
    return [];
  }
  const zwaar = await blokkeerZwareBronnen(page, { ookScripts: true });
  await waitForTurn();
  const url = new URL(AGENDA_PATH, theater.baseUrl).toString();
  const res = await gaNaar(page, url, { timeout: 45000 });
  if (!res || res.status() !== 200) throw new Error(`agenda gaf HTTP ${res?.status() ?? '?'} op ${url}`);
  const eerste = await page.evaluate(leesArtikelen, null);
  // Sanity check: de lijst (met endpoint) en de eerste rijen moeten er staan.
  if (!eerste.lazy || eerste.rijen.length === 0) throw new Error(`geen productielijst op ${url} — site veranderd of geblokkeerd?`);
  const rijen = [...eerste.rijen];

  const { endpoint, post, block, size, total } = eerste.lazy;
  let offset = eerste.lazy.offset;
  for (let i = 0; offset < total && i < MAX_VERZOEKEN; i++) {
    const lijstUrl = `${endpoint}?post=${post}&block=${block}&offset=${offset}&size=${size}`;
    if (!robots.isAllowed(new URL(lijstUrl).pathname)) throw new Error(`robots.txt verbiedt ${new URL(lijstUrl).pathname}`);
    await waitForTurn();
    const r = await gaNaar(page, lijstUrl, { timeout: 30000 });
    if (!r || r.status() !== 200) throw new Error(`lijst gaf HTTP ${r?.status() ?? '?'} op ${lijstUrl}`);
    const data = await r.json();
    const deel = await page.evaluate(leesArtikelen, data.rows ?? '');
    rijen.push(...deel.rijen);
    if (!data.hasMore || deel.rijen.length === 0) break;
    offset = Number(data.offset) || offset + size;
  }
  if (rijen.length < total) warn(`${rijen.length} van ${total} speeldata gelezen — lijst-endpoint veranderd?`);

  const parseDay = createNumericDayParser();
  const buildId = createIdBuilder();
  const opgehaaldOp = new Date().toISOString();
  const shows = [];
  const weg = {};
  const onbekend = {};
  const tel = (o, k) => (o[k] = (o[k] ?? 0) + 1);
  for (const r of rijen) {
    if (!r.titel || !r.dag) continue;
    // Datum vóór het weglaten: de jaar-rollover hangt van de volgorde af.
    const datum = parseDay(r.dag);
    if (r.tags.some((x) => WEGLATEN_TAG.test(x)) || WEGLATEN_TITEL.test(r.titel)) {
      tel(weg, r.tags.find((x) => WEGLATEN_TAG.test(x)) ?? 'workshop');
      continue;
    }
    if (!datum) {
      log(`kon datum niet lezen: "${r.dag}" (${r.titel}) — overgeslagen.`);
      continue;
    }
    const genres = r.tags.filter((x) => !LABELS.test(x));
    for (const g of genres) if (!isBekendGenre(g)) tel(onbekend, g);
    const genreRuw = genres[0] ?? null;
    const premiere = r.tags.some((x) => /^première$/i.test(x));
    // Ondertitel = maker ("Hanneke van der Paardt"), tenzij die de titel herhaalt ("Het Debuut").
    // Een vraag ("Hoe kunnen we omgaan met prikkels …?") is een omschrijving.
    const vraag = r.onder && /\?$/.test(r.onder);
    const maker = r.onder && !vraag && !r.titel.toLowerCase().startsWith(r.onder.toLowerCase()) ? r.onder : null;
    const tijd = extractTime(r.tijd);
    const bron = r.href ? new URL(r.href, theater.baseUrl).toString() : url;
    shows.push({
      id: buildId(theater.id, r.titel, datum, tijd),
      titel: r.titel,
      theaterId: theater.id,
      theaterNaam: theater.naam,
      stad: theater.stad,
      podiumpas: theater.podiumpas,
      datum,
      tijd,
      genre: normalizeGenre(genreRuw),
      genreRuw,
      beschikbaarheid: /^tickets$/i.test(r.knop ?? '') ? 'beschikbaar' : /uitverkocht/i.test(r.knop ?? '') ? 'uitverkocht' : 'onbekend',
      beschrijving: premiere ? `Première${r.tekst ? `. ${r.tekst}` : ''}` : (vraag ? r.onder : r.tekst),
      maker,
      prijs: null,
      reserverenUrl: r.ticket && /^https?:/.test(r.ticket) ? r.ticket : bron,
      bron,
      opgehaaldOp,
    });
  }
  const lijst = (o) => Object.entries(o).map(([x, n]) => `${x} (${n})`).join(', ');
  if (Object.keys(weg).length) log(`weggelaten: ${lijst(weg)}`);
  if (Object.keys(onbekend).length) warn(`onbekende brongenres (nu Overig): ${lijst(onbekend)}`);
  log(`${zwaar.verzoeken()} verzoek(en) naar de site (plus robots.txt)`);
  return shows;
}
