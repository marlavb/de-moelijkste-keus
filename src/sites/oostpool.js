import { createDutchDayParser, extractTime, createIdBuilder } from '../lib/normalize.js';
import { vervallenStatus } from '../lib/beschikbaarheid.js';
import { gaNaar } from '../lib/diagnose.js';
import { blokkeerZwareBronnen } from '../lib/zwareBronnen.js';

const AGENDA_PATH = '/agenda/';

// Alleen speeldata in het eigen huis; de rest is tournee (bij theaters die al
// in de app staan, of elders) en zou dubbel komen.
const EIGEN_PLEK = /^huis oostpool$/i;

/** Tekst van de bestelknop → beschikbaarheid. */
export function oostpoolStatus(tekst) {
  const t = String(tekst ?? '').trim().toLowerCase();
  const vervallen = vervallenStatus(t);
  if (vervallen) return vervallen;
  if (/uitverkocht/.test(t)) return 'uitverkocht';
  if (/wachtlijst/.test(t)) return 'wachtlijst';
  if (/^bestel/.test(t)) return 'beschikbaar';
  return 'onbekend'; // "Verwacht" (nog niet in verkoop)
}

// Draait in de browser: per maandkop ("Oktober 2026") de rijen eronder.
function leesAgenda() {
  const t = (e) => e?.textContent.trim().replace(/\s+/g, ' ') || null;
  return [...document.querySelectorAll('.agenda__month')].map((maand) => ({
    kop: t(maand.querySelector('h2')),
    rijen: [...maand.querySelectorAll('article.playlist-item')].map((a) => {
      const knop = a.querySelector('.playlist-item__order');
      return {
        dag: t(a.querySelector('.playlist-item__date')),
        tijd: t(a.querySelector('.playlist-item__time')),
        titel: t(a.querySelector('.playlist-item__title')),
        plek: t(a.querySelector('.playlist-item__location')),
        stad: t(a.querySelector('.playlist-item__city')),
        bijzonder: t(a.querySelector('.playlist-item__special'))?.replace(/^ $/, '') || null,
        knop: t(knop) ?? t(a.querySelector('.playlist-item__tickets')),
        href: knop?.getAttribute('href') ?? null,
      };
    }),
  }));
}

/**
 * Huis Oostpool (Arnhem), het huis van Theater Oostpool. De hele agenda
 * (eigen huis én tournee, ~170 speeldata) staat op één WordPress-pagina,
 * per maand een kop met jaartal; we nemen alleen de rijen met plek "Huis
 * Oostpool" (~12). 1 verzoek. Geen genre of maker op de pagina: alles is
 * van Theater Oostpool (maker); het genre komt via de meerderheid van andere
 * theaters waar dezelfde productie speelt (genreMeerderheid.js).
 */
export async function scrapeOostpool({ page, theater, robots, waitForTurn, log }) {
  if (!robots.isAllowed(AGENDA_PATH)) {
    log(`robots.txt verbiedt ${AGENDA_PATH} op ${theater.baseUrl} — sla over.`);
    return [];
  }
  const zwaar = await blokkeerZwareBronnen(page, { ookScripts: true });
  await waitForTurn();
  const url = new URL(AGENDA_PATH, theater.baseUrl).toString();
  const res = await gaNaar(page, url, { timeout: 45000 });
  if (!res || res.status() !== 200) throw new Error(`agenda gaf HTTP ${res?.status() ?? '?'} op ${url}`);
  const maanden = await page.evaluate(leesAgenda);
  const alle = maanden.flatMap((m) => m.rijen);
  // Sanity check: geen maanden of rijen = pagina veranderd of geblokkeerd.
  if (alle.length === 0) throw new Error(`geen agendarijen op ${url} — site veranderd of geblokkeerd?`);

  const buildId = createIdBuilder();
  const opgehaaldOp = new Date().toISOString();
  const shows = [];
  let elders = 0;
  for (const m of maanden) {
    const jaar = m.kop?.match(/\b(20\d{2})\b/)?.[1];
    const parseDay = createDutchDayParser();
    for (const r of m.rijen) {
      if (!EIGEN_PLEK.test(r.plek ?? '')) {
        elders++;
        continue;
      }
      const datum = jaar && r.dag ? parseDay(`${r.dag.replace(/^[a-z]+\.\s*/i, '')} ${jaar}`) : null;
      if (!datum || !r.titel) {
        log(`kon rij niet lezen: "${r.dag}" "${r.titel}" (${m.kop}) — overgeslagen.`);
        continue;
      }
      const tijd = extractTime(r.tijd);
      // "try-out", "première", "inleiding vooraf": vooraan in de beschrijving.
      const bijzonder = r.bijzonder ? r.bijzonder.charAt(0).toUpperCase() + r.bijzonder.slice(1) : null;
      shows.push({
        id: buildId(theater.id, r.titel, datum, tijd),
        titel: r.titel,
        theaterId: theater.id,
        theaterNaam: theater.naam,
        stad: theater.stad,
        podiumpas: theater.podiumpas,
        datum,
        tijd,
        genre: null,
        genreRuw: null,
        beschikbaarheid: oostpoolStatus(r.knop),
        beschrijving: bijzonder,
        // Het huis speelt alleen eigen producties (agenda en Podiumpas-pagina, 7 okt 2026).
        maker: 'Theater Oostpool',
        prijs: null,
        reserverenUrl: r.href && /^https?:/.test(r.href) ? r.href : url,
        bron: url,
        opgehaaldOp,
      });
    }
  }
  if (shows.length === 0) log(`geen speeldata in Huis Oostpool (${elders} elders) — alleen tournee op dit moment?`);
  log(`${elders} speeldatum(s) elders (tournee) overgeslagen; ${zwaar.verzoeken()} verzoek(en) naar de site (plus robots.txt)`);
  return shows;
}
