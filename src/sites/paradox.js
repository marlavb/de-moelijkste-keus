import { extractTime, createIdBuilder } from '../lib/normalize.js';
import { blokkeerZwareBronnen } from '../lib/zwareBronnen.js';
import { gaNaar } from '../lib/diagnose.js';
import { vervallenStatus } from '../lib/beschikbaarheid.js';

// Paradox zet een status soms als los woord vóór de titel, zonder
// scheidingsteken: "GEANNULEERD Sasha Berliner Quartet" (7 okt 2026). Alleen
// in hoofdletters of met een dubbele punt, zodat een titel die met zo'n
// woord begint ("Afgelast feest") blijft staan.
const STATUS_VOORAAN = /^(?:(GEANNULEERD|AFGELAST|VERPLAATST)\b|([Gg]eannuleerd|[Aa]fgelast|[Vv]erplaatst)\s*:)[\s:–-]*/;

/** { titel, status } — status 'afgelast'/'verplaatst' als die vooraan de titel stond, anders null. */
export function paradoxTitelEnStatus(titel) {
  const t = String(titel ?? '').trim();
  const m = t.match(STATUS_VOORAAN);
  if (!m) return { titel: t, status: null };
  const rest = t.slice(m[0].length).trim();
  return rest ? { titel: rest, status: vervallenStatus(m[1] ?? m[2]) } : { titel: t, status: null };
}
import { classifyWpBeschikbaarheid, prijsUitTekst } from '../lib/wpTheatre.js';
import { makerZonderVoorvoegsel } from '../lib/titels.js';

const AGENDA_PATH = '/agenda/';
const MAX_LAAD_MEER = 30;

// Podiumpas bij Paradox (bron: https://www.paradoxtilburg.nl/over-paradox/
// tickets-kortingspassen/, 6 okt 2026): Paradox is aangesloten bij
// Podiumpas; "voor een entreeticket stuur je een mail". Geen uitsluitingen
// genoemd. Gratis toegankelijke avonden (de jazzsessies) hebben geen ticket
// nodig: daar geen Podiumpas, zoals bij € 0 bij DOK6 en Kattendans.

// De muziekstijlen die Paradox als "genre" geeft; allemaal concerten, dus bij
// ons Muziek & Concert. Een stijl die hier niet staat, melden we (warn).
const MUZIEKSTIJLEN = new Set([
  'modern creative',
  'funk & jazzrock',
  'straight-ahead',
  'vocal jazz',
  'global',
  'chamber music',
  'electronics',
  'blues & americana',
  'singer-songwriter',
  'concert',
  'jazz',
  'latin',
  'big band',
  'fusion',
  'world',
  'improvisatie',
  'soul & pop',
  'free jazz',
  // De jazzsessies (meenemen, akkoord 6 okt 2026) en examenconcerten van het
  // conservatorium (gratis, openbaar).
  'sessie/workshop',
  'examen / tentamen',
]);
// Geen concert: weglaten (akkoord 6 okt 2026, open vraag 6).
const GEEN_CONCERT_GENRES = new Set(['debat', 'lezing', 'workshop', 'masterclass']);
export const GEEN_CONCERT_TITEL = /\b(masterclass|workshop|cursus)\b|science caf/i;

const MAANDEN = { jan: 1, feb: 2, mrt: 3, maa: 3, apr: 4, mei: 5, jun: 6, jul: 7, aug: 8, sep: 9, okt: 10, nov: 11, dec: 12 };

/** "zo 11 okt 2026" → "2026-10-11" (Paradox zet het jaar er altijd bij). */
export function parseParadoxDatum(tekst) {
  const m = String(tekst ?? '').toLowerCase().match(/(\d{1,2})\s+([a-z]{3})[a-z]*\.?\s+(\d{4})/);
  if (!m || !MAANDEN[m[2]]) return null;
  return `${m[3]}-${String(MAANDEN[m[2]]).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}

/** Leest de concerten uit de agenda (eigen thema op "Theater for WordPress"); draait in de browser. */
function leesParadox() {
  return Array.from(document.querySelectorAll('div.wp_theatre_event')).map((el) => {
    const tekst = (node) => node?.textContent.replace(/\s+/g, ' ').trim() || null;
    const link = el.querySelector('.wp_theatre_event_title a');
    const klein = link?.querySelector('.titleSmallText');
    const titel = link ? tekst(Array.from(link.childNodes).filter((n) => n !== klein).reduce((d, n) => (d.append(n.cloneNode(true)), d), document.createElement('span'))) : null;
    const meta = Array.from(el.querySelectorAll('.event-meta span')).map((s) => s.textContent.replace(/\s+/g, ' ').trim());
    const knop = el.querySelector('.wp_theatre_event_tickets_url');
    return {
      titel,
      ondertitel: tekst(klein),
      href: link?.getAttribute('href') ?? null,
      datum: tekst(el.querySelector('.event-date')),
      aanvang: meta.find((m) => /^aanvang/i.test(m)) ?? null,
      prijs: el.querySelector('.event-price')?.getAttribute('content') ?? tekst(el.querySelector('.event-price')),
      genres: Array.from(el.querySelectorAll('.event-genres span')).flatMap((s) => s.textContent.split('|')).map((g) => g.trim()).filter(Boolean),
      knopTekst: tekst(knop),
      ticketUrl: knop?.getAttribute('href') ?? null,
      // span.soldout is ook "Gratis toegang" (class free); alleen het
      // andere is een status (Uitverkocht!, Afgelast, …).
      status: (() => {
        const span = el.querySelector('.soldout');
        return span && !span.classList.contains('free') && !/gratis/i.test(span.textContent) ? tekst(span) : null;
      })(),
      gratisToegang: Boolean(Array.from(el.querySelectorAll('.soldout')).find((sp) => sp.classList.contains('free') || /gratis/i.test(sp.textContent))),
    };
  });
}

/**
 * Haalt de agenda van Paradox (Tilburg) op.
 *
 * Structuur (geïnspecteerd op https://www.paradoxtilburg.nl/agenda/, 6 okt
 * 2026): WordPress met "Theater for WordPress" en een eigen thema. De pagina
 * toont de eerste concerten (div.wp_theatre_event: titel met
 * .titleSmallText, "zo 11 okt 2026", "Aanvang 20:30", prijs, stijlen, knop
 * of span.soldout). De rest komt via de knop "Laad meer": een POST naar
 * admin-ajax.php (action "programm_filter", show "total", de nonce uit de
 * pagina, offset = aantal getoonde concerten) met JSON {status, output,
 * max}; status 999 = niets meer. Dat doen we precies zo na, met
 * waitForTurn() vóór elke POST, zonder de scripts van de site te laden
 * (robots.txt staat alles toe). ~88 concerten → ~1 + 12 verzoeken.
 *
 * Weglaten: debat, workshops, masterclasses (akkoord 6 okt 2026), en
 * concerten met "Tickets via Schouwburg Concertzaal": die staan bij dat
 * theater (geen dubbele speeldatum). Titel = de concerttitel; de kleine
 * regel eronder wordt de beschrijving ("EP presentatie"), behalve "o.l.v.
 * Tijn Trommelen": dan maker.
 */
export async function scrapeParadox({ page, theater, robots, waitForTurn, log, warn = log }) {
  if (!robots.isAllowed(AGENDA_PATH)) {
    log(`robots.txt verbiedt ${AGENDA_PATH} op ${theater.baseUrl} — sla over.`);
    return [];
  }
  const zwaar = await blokkeerZwareBronnen(page, { ookScripts: true });
  await waitForTurn();
  await gaNaar(page, theater.agendaUrl, { timeout: 45000 });
  // Sanity check: een geldige agenda heeft concerten.
  const eerste = await page.evaluate(leesParadox);
  if (eerste.length === 0) throw new Error(`geen concerten (div.wp_theatre_event) op ${page.url()} — site veranderd of geblokkeerd?`);

  // "Laad meer": dezelfde POST als de knop, tot status 999 of geen nieuwe.
  const ajax = await page.evaluate(() => {
    const knop = document.querySelector('button.load-more');
    const script = Array.from(document.scripts).map((s) => s.textContent).find((t) => /var ajax = \{/.test(t)) ?? '';
    const m = script.match(/var ajax = (\{[^;]*\});/);
    let cfg = null;
    try {
      cfg = m ? JSON.parse(m[1]) : null;
    } catch {
      cfg = null;
    }
    return { url: cfg?.ajax_url ?? null, nonce: cfg?.nonce ?? null, show: knop?.getAttribute('data-programma') ?? 'total', knop: Boolean(knop) };
  });
  let rondes = 0;
  if (ajax.knop && ajax.url && ajax.nonce) {
    const ajaxPad = new URL(ajax.url).pathname;
    if (!robots.isAllowed(ajaxPad)) {
      warn(`robots.txt verbiedt ${ajaxPad}: alleen de eerste ${eerste.length} concerten.`);
    } else {
      for (; rondes < MAX_LAAD_MEER; rondes++) {
        const voor = await page.evaluate(() => document.querySelectorAll('div.wp_theatre_event').length);
        await waitForTurn();
        const antwoord = await page.evaluate(
          async ({ url, nonce, show, offset }) => {
            const body = new URLSearchParams({ action: 'programm_filter', show, nonce, offset: String(offset) });
            const r = await fetch(url, { method: 'POST', body, headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' } });
            if (!r.ok) return { fout: `HTTP ${r.status}` };
            const json = await r.json().catch(() => null);
            if (!json) return { fout: 'geen JSON' };
            if (json.status == 999) return { klaar: true };
            const doel = document.querySelector('#cards') ?? document.querySelector('div.wp_theatre_event')?.parentElement;
            doel?.insertAdjacentHTML('beforeend', json.output ?? '');
            return { max: Number(json.max) || null };
          },
          { url: ajax.url, nonce: ajax.nonce, show: ajax.show, offset: voor }
        );
        if (antwoord.fout) {
          warn(`"Laad meer" gaf ${antwoord.fout} na ${voor} concerten; de rest ontbreekt deze run.`);
          break;
        }
        if (antwoord.klaar) break;
        const na = await page.evaluate(() => document.querySelectorAll('div.wp_theatre_event').length);
        if (na <= voor) break; // niets nieuws: klaar
        if (antwoord.max && na >= antwoord.max) {
          rondes++;
          break;
        }
      }
      if (rondes >= MAX_LAAD_MEER) warn(`"Laad meer" na ${MAX_LAAD_MEER} keer nog niet klaar — paginering vermoedelijk stuk.`);
    }
  } else {
    warn('geen knop "Laad meer" of geen nonce gevonden: alleen de eerste concerten.');
  }
  const items = await page.evaluate(leesParadox);

  const buildId = createIdBuilder();
  const opgehaaldOp = new Date().toISOString();
  const shows = [];
  const weg = {};
  const onbekend = {};
  const gezien = new Set();
  for (const it of items) {
    if (!it.titel || !it.datum) continue;
    const datum = parseParadoxDatum(it.datum);
    if (!datum) {
      log(`kon datum niet lezen: "${it.datum}" (${it.titel}) — overgeslagen.`);
      continue;
    }
    const tijd = extractTime(it.aanvang);
    const sleutel = `${it.href ?? it.titel}|${datum}|${tijd}`;
    if (gezien.has(sleutel)) continue; // "Laad meer" kan een overlap geven
    gezien.add(sleutel);
    const genresKlein = it.genres.map((g) => g.toLowerCase());
    let waarom = null;
    if (/tickets via/i.test(it.knopTekst ?? '')) waarom = `${it.knopTekst}`;
    else if (genresKlein.some((g) => GEEN_CONCERT_GENRES.has(g)) || GEEN_CONCERT_TITEL.test(it.titel)) waarom = `geen concert (${it.genres.join(', ') || it.titel})`;
    if (waarom) {
      weg[waarom] = (weg[waarom] ?? 0) + 1;
      continue;
    }
    for (const g of genresKlein) if (!MUZIEKSTIJLEN.has(g)) onbekend[g] = (onbekend[g] ?? 0) + 1;
    const prijs = prijsUitTekst(it.prijs);
    const gratis = it.gratisToegang || prijs === 0 || /gratis/i.test(it.knopTekst ?? '');
    const { titel, status: titelStatus } = paradoxTitelEnStatus(it.titel);
    const beschikbaarheid = titelStatus
      ?? (it.status
        ? vervallenStatus(it.status) ?? classifyWpBeschikbaarheid(it.status, null)
        : gratis
          ? 'beschikbaar'
          : classifyWpBeschikbaarheid(it.knopTekst, null));
    shows.push({
      id: buildId(theater.id, titel, datum, tijd),
      titel,
      theaterId: theater.id,
      theaterNaam: theater.naam,
      stad: theater.stad,
      podiumpas: theater.podiumpas && !gratis,
      datum,
      tijd,
      genre: 'Muziek & Concert',
      genreRuw: it.genres.join(', ') || null,
      beschikbaarheid,
      // "o.l.v. Tijn Trommelen (vocals/gitaar)" → maker; anders beschrijving.
      beschrijving: /^o\.l\.v\.\s/i.test(it.ondertitel ?? '') ? null : it.ondertitel,
      maker: /^o\.l\.v\.\s/i.test(it.ondertitel ?? '') ? makerZonderVoorvoegsel(it.ondertitel) : null,
      prijs: gratis ? 0 : prijs,
      reserverenUrl: it.ticketUrl ?? (it.href ? new URL(it.href, theater.baseUrl).toString() : theater.agendaUrl),
      bron: theater.agendaUrl,
      opgehaaldOp,
    });
  }
  const lijst = (o) => Object.entries(o).map(([k, n]) => `${k} (${n})`).join(', ');
  log(`${items.length} concerten gelezen (${rondes} keer "Laad meer").`);
  if (Object.keys(weg).length) log(`weggelaten: ${lijst(weg)}`);
  if (Object.keys(onbekend).length) warn(`onbekende muziekstijlen (nu Muziek & Concert): ${lijst(onbekend)}`);
  log(`${zwaar.verzoeken()} verzoek(en) naar de site (plus robots.txt); ${zwaar.geblokkeerd()} afbeeldingen/scripts/fonts niet geladen`);
  return shows;
}
