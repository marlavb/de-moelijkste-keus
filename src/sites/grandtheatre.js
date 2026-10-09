import { createIdBuilder, createDutchAbbrevDayParser } from '../lib/normalize.js';
import { normalizeGenre, isBekendGenre } from '../lib/genre.js';
import { metEnDash } from '../lib/titels.js';
import { vervallenStatus } from '../lib/beschikbaarheid.js';
import { gaNaar } from '../lib/diagnose.js';
import { blokkeerZwareBronnen } from '../lib/zwareBronnen.js';

const AGENDA_PATH = '/nl/programma';

// Podiumpas bij Grand Theatre (bron:
// https://www.grandtheatregroningen.nl/nl/info/podiumpas, 8 okt 2026): alle
// voorstellingen in alle zalen, niet uitverkocht; uitgesloten zijn
// voorstellingen en (culturele) verhuringen waarvoor Grand Theatre de
// kaartverkoop niet doet (bv. Jonge Harten, ESNS, Noorderzon); tickets tot
// €50 (de prijs staat alleen op de detailpagina; de prijzen hier zijn laag).
// Herkenbaar in de lijst: class "verhuur", en een ticketlink buiten de eigen
// kaartverkoop (grandtheatregroningen.podiumnederland.nl).
const EIGEN_VERKOOP = /^grandtheatregroningen\.podiumnederland\.nl$/i;

// Labels die geen genre zijn.
const LABELS = /^(language no problem|no dutch required|english spoken|prikkelarme faciliteiten|coproductie|partner(programma)?|te gast|op locatie|clubhuis|oproer|festival|unfinished business|future scenarios|in de wereld|in the world|van hier|talking bodies|living images|achter de schermen bij|woordkunst)$/i;
// Geen voorstelling: workshops, kinderactiviteiten, rondleidingen.
const WEGLATEN = /^(workshop|kinderactiviteit|achter de schermen bij)$/i;

// Draait in de browser: de evenementen van de programmapagina.
function leesEvenementen() {
  const t = (e) => e?.textContent.trim().replace(/\s+/g, ' ') || null;
  return [...document.querySelectorAll('li.event-container')].map((li) => {
    const kop = li.querySelector('.event-item-2 h1');
    const onder = t(kop?.querySelector('.mc-text'));
    const titel = kop ? [...kop.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join(' ').trim().replace(/\s+/g, ' ') || null : null;
    return {
      verhuur: li.classList.contains('verhuur'),
      href: li.querySelector('a.overlay-link')?.getAttribute('href') ?? null,
      titel,
      onder,
      tekst: t(li.querySelector('.event-item-2 p')),
      labels: [...li.querySelectorAll('a.labels')].map(t).filter(Boolean),
      speeldata: [...li.querySelectorAll('ul.playtime')].map((ul) => {
        const h = [...ul.querySelectorAll('h1')].map(t);
        const knop = ul.querySelector('.ticket-button');
        return {
          dag: h.find((x) => /^(ma|di|wo|do|vr|za|zo)\s+\d/i.test(x)) ?? null,
          tijd: h.find((x) => /^\/\s*\d/.test(x))?.replace(/^\/\s*/, '') ?? null,
          noot: t(ul.querySelector('h6')),
          knop: t(knop),
          ticket: knop?.closest('a')?.getAttribute('href') ?? null,
        };
      }),
    };
  });
}

/**
 * Grand Theatre (Groningen). Kirby CMS, kaartverkoop via Podium Nederland
 * (mtTicket). Het hele programma staat op één pagina (/nl/programma, ~40
 * speeldata, een paar maanden vooruit): 1 verzoek. Per evenement: titel en
 * ondertitel, labels, en per speeldatum ("do 08 okt", zonder jaar) de tijd en
 * de ticketknop. robots.txt gaf op 8 en 9 okt 2026 HTTP 500; dan slaat de run
 * het theater over (RFC 9309, zie robots.js op de branch robots-5xx).
 */
export async function scrapeGrandTheatre({ page, theater, robots, waitForTurn, log }) {
  if (!robots.isAllowed(AGENDA_PATH)) throw new Error(`robots.txt verbiedt ${AGENDA_PATH} — niet scrapen`);
  const zwaar = await blokkeerZwareBronnen(page, { ookScripts: true, ookOverig: true });
  await waitForTurn();
  const url = `${theater.baseUrl}${AGENDA_PATH}`;
  const res = await gaNaar(page, url, { timeout: 45000 });
  if (!res || res.status() !== 200) throw new Error(`programma gaf HTTP ${res?.status() ?? '?'} op ${url}`);
  const evenementen = await page.evaluate(leesEvenementen);
  // Sanity check: de lijst moet er zijn.
  if (evenementen.length === 0) throw new Error(`geen evenementen op ${url} — site veranderd of geblokkeerd?`);
  const shows = verwerkGrandTheatre(evenementen, { theater, log });
  log(`${zwaar.verzoeken()} verzoeken`);
  return shows;
}

/** De evenementen → voorstellingen (los te testen). */
export function verwerkGrandTheatre(evenementen, { theater, log = () => {}, opgehaaldOp = new Date().toISOString(), referentie = new Date() }) {
  const parseDag = createDutchAbbrevDayParser(referentie);
  const buildId = createIdBuilder();
  const shows = [];
  const weg = {};
  const geenPas = {};
  const onbekend = {};
  const tel = (o, k) => (o[k] = (o[k] ?? 0) + 1);
  for (const ev of evenementen) {
    const labels = ev.labels.map((l) => l.trim());
    // Datum vóór het weglaten: de jaarovergang hangt van de volgorde af.
    const data = ev.speeldata.map((s) => ({ ...s, datum: s.dag ? parseDag(s.dag) : null }));
    if (!ev.titel) continue;
    if (labels.some((l) => WEGLATEN.test(l))) {
      tel(weg, labels.find((l) => WEGLATEN.test(l)).toLowerCase());
      continue;
    }
    const genres = labels.filter((l) => !LABELS.test(l));
    for (const g of genres) if (!isBekendGenre(g)) tel(onbekend, g);
    const genreRuw = genres[0] ?? null;
    const bron = ev.href ? new URL(ev.href, theater.baseUrl).toString() : theater.agendaUrl;
    for (const s of data) {
      if (!s.datum) continue;
      let host = null;
      try {
        host = s.ticket ? new URL(s.ticket, theater.baseUrl).hostname : null;
      } catch {
        host = null;
      }
      let podiumpas = theater.podiumpas;
      if (ev.verhuur) {
        podiumpas = false;
        tel(geenPas, 'verhuur');
      } else if (host && !EIGEN_VERKOOP.test(host)) {
        podiumpas = false;
        tel(geenPas, `externe kaartverkoop (${host})`);
      }
      const knop = s.knop ?? '';
      const beschikbaarheid = vervallenStatus(knop) ?? (/uitverkocht/i.test(knop) ? 'uitverkocht' : /tickets/i.test(knop) ? 'beschikbaar' : 'onbekend');
      const tijd = /^\d{1,2}:\d{2}$/.test(s.tijd ?? '') ? s.tijd.padStart(5, '0') : null;
      const titel = metEnDash(ev.titel);
      shows.push({
        id: buildId(theater.id, titel, s.datum, tijd),
        titel,
        theaterId: theater.id,
        theaterNaam: theater.naam,
        stad: theater.stad,
        podiumpas,
        datum: s.datum,
        tijd,
        genre: normalizeGenre(genreRuw),
        genreRuw,
        beschikbaarheid,
        beschrijving: [s.noot?.replace(/^\(|\)$/g, ''), ev.onder, ev.tekst].filter(Boolean).join(' · ') || null,
        maker: null,
        prijs: null,
        reserverenUrl: s.ticket && /^https?:/.test(s.ticket) ? s.ticket : bron,
        bron,
        opgehaaldOp,
      });
    }
  }
  const lijst = (o) => Object.entries(o).map(([x, n]) => `${x} (${n})`).join(', ');
  if (Object.keys(weg).length) log(`weggelaten: ${lijst(weg)}`);
  if (Object.keys(geenPas).length) log(`podiumpas false: ${lijst(geenPas)}`);
  if (Object.keys(onbekend).length) log(`onbekende genres: ${lijst(onbekend)}`);
  return shows;
}
