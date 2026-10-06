import { extractTime, createIdBuilder } from '../lib/normalize.js';
import { normalizeGenre, isBekendGenre } from '../lib/genre.js';
import { titelUitKopEnOndertitel, pasTitelConventieToe } from '../lib/titels.js';
import { vervallenStatus } from '../lib/beschikbaarheid.js';
import { createGroupScraper } from '../lib/peppered.js';
import { blokkeerZwareBronnen } from '../lib/zwareBronnen.js';
import { gaNaar } from '../lib/diagnose.js';
import { THEATERS } from '../lib/config.js';

const AGENDA_PATH = '/programma';
const MAX_PAGINAS = 80;

// Logo op de tegel → config-id. Tegels zonder zaallogo (reeks "Bij de
// Buren", "Buiten onze theaters") en onbekende logo's laten we weg
// (inventarisatie §6.4, voorstel).
const THEATER_VOOR_LOGO = {
  'theater heerlen': 'pltheerlen',
  'theater kerkrade': 'pltkerkrade',
  'toon hermans theater sittard': 'pltsittard',
};

// Kop/ondertitel per genre (inventarisatie §2.3): bij cabaret, show, muziek,
// regio en klassiek staat de artiest bovenaan ("Sjoerd Janssen" / "Zonder
// invloed"), bij toneel, dans en jeugd de voorstelling ("SOEKARNO" / "Bo
// Tarenskeen | Het Nationale Theater").
const MAKER_EERST = /^(cabaret & stand-up|show|muziek|regio|klassiek & opera)$/i;

const MAANDEN = { jan: 1, feb: 2, mrt: 3, maa: 3, apr: 4, mei: 5, jun: 6, jul: 7, aug: 8, sep: 9, okt: 10, nov: 11, dec: 12 };

/** "Dans - Wo 07 okt. 2026 - 19:30 uur" → { genre, datum, tijd }. */
export function leesPltDetails(tekst) {
  const t = String(tekst ?? '').replace(/\s+/g, ' ').trim();
  const m = t.match(/(\d{1,2})\s+([a-z]{3})[a-z]*\.?\s+(\d{4})/i);
  const maand = m && MAANDEN[m[2].toLowerCase()];
  const datum = maand ? `${m[3]}-${String(maand).padStart(2, '0')}-${m[1].padStart(2, '0')}` : null;
  const genre = t.split(/\s+-\s+(?:ma|di|wo|do|vr|za|zo)\b/i)[0]?.trim() || null;
  return { genre, datum, tijd: extractTime(t.slice(m ? m.index : 0)) };
}

/** Statuslabel op de tegel → beschikbaarheid. */
export function pltStatus(label) {
  const l = String(label ?? '').toLowerCase();
  if (!l) return 'beschikbaar';
  const vervallen = vervallenStatus(l);
  if (vervallen) return vervallen;
  if (/uitverkocht/.test(l)) return 'uitverkocht';
  if (/wachtlijst/.test(l)) return 'wachtlijst';
  return 'beschikbaar'; // "Laatste tickets" e.d.
}

// Draait in de browser.
function leesPltPagina() {
  const tekst = (el) => el?.textContent.replace(/\s+/g, ' ').trim() || null;
  return {
    totaalPaginas: Number(document.querySelector('select.show-overview__page option:last-child')?.textContent.match(/\/\s*(\d+)/)?.[1]) || null,
    items: [...document.querySelectorAll('a.show-tile')].map((a) => ({
      href: a.getAttribute('href'),
      details: tekst(a.querySelector('.show-tile__content p')),
      kop: tekst(a.querySelector('.show-tile__content .h4')),
      ondertitel: tekst(a.querySelector('.show-tile__content .h3')),
      logo: a.querySelector('.show-tile__logo')?.getAttribute('alt') ?? null,
      label: [...a.querySelectorAll('.show-tile__label')].filter((l) => !l.classList.contains('hide')).map((l) => tekst(l)).filter(Boolean).join(' ') || null,
    })),
  };
}

/**
 * PLT Heerlen Sittard Kerkrade: één agenda voor Theater Heerlen, Theater
 * Kerkrade en Toon Hermans Theater Sittard.
 *
 * Structuur (geïnspecteerd op https://www.plt.nl/programma, 6 okt 2026):
 * Craft CMS, server-side, 12 tegels per pagina, ~55 pagina's (?page=N). Eén
 * tegel = één speeldatum: "Dans - Wo 07 okt. 2026 - 19:30 uur", kop,
 * ondertitel, logo van de zaal en een statuslabel (Laatste tickets,
 * Uitverkocht, Geannuleerd, Wachtlijst). Geen detailpagina's, ~55
 * verzoeken per run. Film (Filmhuis de Spiegel) laten we weg.
 */
async function scrapeAllPlt({ page, theater, robots, waitForTurn, log, warn = log }) {
  if (!robots.isAllowed(AGENDA_PATH)) {
    log(`robots.txt verbiedt ${AGENDA_PATH} op ${theater.baseUrl} — sla over.`);
    return [];
  }
  const zwaar = await blokkeerZwareBronnen(page, { ookScripts: true, ookOverig: true });
  const items = [];
  const gezien = new Set();
  let totaal = null;
  let p = 1;
  for (; p <= MAX_PAGINAS; p++) {
    const url = p === 1 ? theater.agendaUrl : `${theater.agendaUrl}?page=${p}`;
    await waitForTurn();
    try {
      await gaNaar(page, url, { timeout: 45000 });
    } catch (err) {
      if (p === 1) throw err;
      warn(`kon pagina ${p} niet laden: ${err.message} — stop.`);
      break;
    }
    const { items: deze, totaalPaginas } = await page.evaluate(leesPltPagina);
    if (p === 1) {
      // Sanity check: een geldige agenda heeft tegels en een paginateller.
      if (deze.length === 0) throw new Error(`geen voorstellingen (a.show-tile) op ${page.url()} — site veranderd of geblokkeerd?`);
      totaal = totaalPaginas;
      if (!totaal) warn('geen paginateller gevonden — we bladeren tot er niets nieuws komt.');
    }
    const nieuw = deze.filter((it) => !gezien.has(it.href) && gezien.add(it.href));
    items.push(...nieuw);
    if (nieuw.length === 0 || (totaal && p >= totaal)) break;
  }
  log(`${p} pagina's, ${items.length} speeldata${totaal ? ` (teller: ${totaal} pagina's)` : ''}`);
  if (totaal && p < totaal) warn(`gestopt bij pagina ${p} van ${totaal}.`);

  const buildId = createIdBuilder();
  const opgehaaldOp = new Date().toISOString();
  const shows = [];
  const weg = {};
  const onbekend = {};
  const tel = (o, k) => { o[k] = (o[k] ?? 0) + 1; };
  for (const it of items) {
    const { genre: genreRuw, datum, tijd } = leesPltDetails(it.details);
    if (!it.kop || !datum) {
      log(`kon tegel niet lezen: "${it.details}" (${it.kop}) — overgeslagen.`);
      continue;
    }
    if (/^film$/i.test(genreRuw ?? '')) {
      tel(weg, 'film');
      continue;
    }
    const theaterId = THEATER_VOOR_LOGO[String(it.logo ?? '').trim().toLowerCase()];
    if (!theaterId) {
      tel(weg, `${it.logo ?? 'zonder logo'}`);
      continue;
    }
    if (genreRuw && !isBekendGenre(genreRuw)) tel(onbekend, genreRuw);
    const lid = THEATERS.find((t) => t.id === theaterId);
    const url = new URL(it.href, theater.baseUrl).toString();
    const basis = {
      id: buildId(theaterId, it.kop, datum, tijd),
      titel: it.kop,
      theaterId,
      theaterNaam: lid?.naam ?? theaterId,
      stad: lid?.stad ?? theater.stad,
      podiumpas: lid?.podiumpas === true,
      datum,
      tijd,
      genre: genreRuw ? normalizeGenre(genreRuw) ?? 'Overig' : null,
      genreRuw,
      beschikbaarheid: pltStatus(it.label),
      beschrijving: null,
      maker: null,
      prijs: null,
      reserverenUrl: url,
      bron: url,
      opgehaaldOp,
    };
    const volgorde = MAKER_EERST.test(genreRuw ?? '') ? 'maker-titel' : 'titel-maker';
    const show = titelUitKopEnOndertitel(basis, { kop: it.kop, ondertitel: it.ondertitel, volgorde });
    shows.push(show.maker ? pasTitelConventieToe(show, { artiest: show.maker, voorstelling: show.titel, makerWordtLeeg: true }) : show);
  }
  const lijst = (o) => Object.entries(o).map(([k, n]) => `${k} (${n})`).join(', ');
  if (Object.keys(weg).length) log(`weggelaten: ${lijst(weg)}`);
  if (Object.keys(onbekend).length) warn(`onbekende brongenres (nu Overig): ${lijst(onbekend)}`);
  log(`${zwaar.verzoeken()} verzoek(en) naar de site (plus robots.txt); ${zwaar.geblokkeerd()} afbeeldingen/scripts/fonts niet geladen`);
  return shows;
}

/** Voor Theater Heerlen, Theater Kerkrade en Toon Hermans Theater Sittard. */
export const scrapePltGroep = createGroupScraper(scrapeAllPlt);

export { scrapeAllPlt };
