import { createIdBuilder } from '../lib/normalize.js';
import { metEnDash } from '../lib/titels.js';
import { vervallenStatus } from '../lib/beschikbaarheid.js';
import { lowestPrice } from '../lib/exclusions.js';
import { gaNaar } from '../lib/diagnose.js';
import { blokkeerZwareBronnen } from '../lib/zwareBronnen.js';

const AGENDA_PATH = '/programma/';
const MAX_PAGINAS = 15;

// Podiumpas bij De Muze (bron: https://demuze.nl/podiumpas/, 8 okt 2026):
// tickets tot €50, niet bijbetalen. De prijs staat op elke kaart.
export const PODIUMPAS_MAX_PRIJS = 50;

// Categorie op de kaart: films laten we weg (zoals bij PLT, Agnietenhof).
const FILM = /^film$/i;

// Niet openbaar: "Een besloten voorstelling voor genodigde …".
const BESLOTEN = /\bbesloten (voorstelling|bijeenkomst|avond)\b/i;

// Een festivalnaam vooraan de titel ("MINI MUZE – Nijntje op de fiets – …"):
// hoort in de beschrijving.
const FESTIVAL_VOORAAN = /^(mini muze)\s+–\s+/i;

// Draait in de browser: de kaarten van één lijstpagina en het aantal pagina's.
function leesKaarten() {
  const t = (e) => e?.textContent.trim().replace(/\s+/g, ' ') || null;
  const kaarten = [...document.querySelectorAll('article')]
    .filter((a) => a.querySelector('h3 a, a h3') && a.querySelector('a[href*="speeldata="]') && a.closest('.swiper-slide') === null)
    .map((a) => {
      const link = a.querySelector('a[href*="speeldata="]');
      const knop = a.querySelector('a.c-btn');
      const spans = [...a.querySelectorAll('span')].map(t).filter(Boolean);
      return {
        href: link?.getAttribute('href') ?? null,
        titel: t(a.querySelector('h3')),
        categorie: t(a.querySelector('.md\\:hidden > div')) ?? t(a.querySelector('.bg-primary\\/10')),
        tijd: spans.find((s) => /^\d{1,2}:\d{2}$/.test(s)) ?? null,
        prijs: spans.find((s) => /€/.test(s)) ?? null,
        knop: t(knop),
        ticket: knop?.getAttribute('href') ?? null,
        tekst: t(a.querySelector('p')),
      };
    });
  const paginas = [...document.querySelectorAll('a[href*="/programma/page/"]')]
    .map((x) => Number(/\/page\/(\d+)\//.exec(x.getAttribute('href'))?.[1]))
    .filter(Number.isFinite);
  return { kaarten, paginas: paginas.length ? Math.max(...paginas) : 1 };
}

/**
 * De Muze (Noordwijk). WordPress; /programma/ en /programma/page/N/ zijn
 * server-rendered (~4 pagina's). Per kaart: datum en tijd in de link
 * (?speeldata=2026-10-12-16-15), categorie (Theater/Film), prijs, knop
 * (Tickets/Uitverkocht) met de link naar de kaartverkoop (Ticketworks).
 * De bovenste carrousel (.swiper-slide) herhaalt kaarten: overslaan.
 */
export async function scrapeDeMuze({ page, theater, robots, waitForTurn, log, warn }) {
  if (!robots.isAllowed(AGENDA_PATH)) throw new Error(`robots.txt verbiedt ${AGENDA_PATH} — niet scrapen`);
  const zwaar = await blokkeerZwareBronnen(page, { ookScripts: true, ookOverig: true });
  const kaarten = [];
  let totaal = 1;
  for (let p = 1; p <= Math.min(totaal, MAX_PAGINAS); p++) {
    const url = p === 1 ? `${theater.baseUrl}${AGENDA_PATH}` : `${theater.baseUrl}${AGENDA_PATH}page/${p}/`;
    if (!robots.isAllowed(new URL(url).pathname)) throw new Error(`robots.txt verbiedt ${url}`);
    await waitForTurn();
    const res = await gaNaar(page, url, { timeout: 45000 });
    if (!res || res.status() !== 200) throw new Error(`programma gaf HTTP ${res?.status() ?? '?'} op ${url}`);
    const r = await page.evaluate(leesKaarten);
    // Sanity check: de eerste pagina moet kaarten hebben.
    if (p === 1 && r.kaarten.length === 0) throw new Error(`geen programmakaarten op ${url} — site veranderd of geblokkeerd?`);
    if (p === 1) totaal = r.paginas;
    kaarten.push(...r.kaarten);
  }
  if (totaal > MAX_PAGINAS) warn(`${totaal} pagina's, meer dan ${MAX_PAGINAS} — niet alles gelezen.`);
  const shows = verwerkDeMuze(kaarten, { theater, log });
  log(`${zwaar.verzoeken()} verzoeken`);
  return shows;
}

/** De kaarten → voorstellingen (los te testen). */
export function verwerkDeMuze(kaarten, { theater, log = () => {}, opgehaaldOp = new Date().toISOString() }) {
  const buildId = createIdBuilder();
  const shows = [];
  const gezien = new Set();
  const weg = {};
  const geenPas = {};
  const tel = (o, k) => (o[k] = (o[k] ?? 0) + 1);
  for (const k of kaarten) {
    if (!k.href || gezien.has(k.href)) continue;
    gezien.add(k.href);
    const m = /speeldata=(\d{4}-\d{2}-\d{2})-(\d{2})-(\d{2})/.exec(k.href);
    if (!k.titel || !m) continue;
    if (FILM.test(k.categorie ?? '')) {
      tel(weg, 'film');
      continue;
    }
    if (BESLOTEN.test(k.tekst ?? '')) {
      tel(weg, 'besloten');
      continue;
    }
    let titel = metEnDash(k.titel);
    let festival = null;
    const f = FESTIVAL_VOORAAN.exec(titel);
    if (f) {
      festival = f[1].toUpperCase();
      titel = titel.slice(f[0].length);
    }
    const prijs = lowestPrice(k.prijs);
    let podiumpas = theater.podiumpas;
    if (prijs != null && prijs > PODIUMPAS_MAX_PRIJS) {
      podiumpas = false;
      tel(geenPas, `prijs > €${PODIUMPAS_MAX_PRIJS}`);
    }
    const knop = k.knop ?? '';
    const beschikbaarheid = vervallenStatus(knop) ?? (/uitverkocht/i.test(knop) ? 'uitverkocht' : /wachtlijst/i.test(knop) ? 'wachtlijst' : /tickets|bestel|reserveer/i.test(knop) ? 'beschikbaar' : 'onbekend');
    const bron = new URL(k.href, theater.baseUrl).toString();
    const [, datum, uur, minuut] = m;
    const tijd = `${uur}:${minuut}`;
    shows.push({
      id: buildId(theater.id, titel, datum, tijd),
      titel,
      theaterId: theater.id,
      theaterNaam: theater.naam,
      stad: theater.stad,
      podiumpas,
      datum,
      tijd,
      // De categorie (Theater, Verenigingen & Organisaties) is geen genre;
      // het genre komt dan van andere theaters (genreMeerderheid.js).
      genre: null,
      genreRuw: null,
      beschikbaarheid,
      beschrijving: [festival, k.tekst].filter(Boolean).join(' · ') || null,
      maker: null,
      prijs,
      reserverenUrl: k.ticket && /^https:\/\/tickets\./.test(k.ticket) ? k.ticket : bron,
      bron,
      opgehaaldOp,
    });
  }
  const lijst = (o) => Object.entries(o).map(([x, n]) => `${x} (${n})`).join(', ');
  if (Object.keys(weg).length) log(`weggelaten: ${lijst(weg)}`);
  if (Object.keys(geenPas).length) log(`podiumpas false: ${lijst(geenPas)}`);
  return shows;
}
