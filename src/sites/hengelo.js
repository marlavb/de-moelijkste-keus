import { createIdBuilder, slugify } from '../lib/normalize.js';
import { normalizeGenre, isBekendGenre } from '../lib/genre.js';
import { pasTitelConventieToe, metEnDash, labelUitTitel } from '../lib/titels.js';
import { vervallenStatus } from '../lib/beschikbaarheid.js';
import { gaNaar } from '../lib/diagnose.js';
import { blokkeerZwareBronnen } from '../lib/zwareBronnen.js';
import { openDetailCache } from '../lib/detailCache.js';
import { lowestPrice } from '../lib/exclusions.js';

const AGENDA_PATH = '/theaterprogramma';
const MAX_PAGINAS = 30;

// Podiumpas bij Schouwburg Hengelo (bron:
// https://www.schouwburghengelo.nl/bezoek/podiumpas, 8 okt 2026): alleen
// professionele voorstellingen in de Middenzaal of de Rabozaal ("voorstellingen
// op andere locaties zijn uitgesloten"), niet uitverkocht; niet bij
// (culturele) verhuringen en kaartverkoop door derden; tickets tot €50. De
// zaal staat in de lijst; prijs, verhuur en derden niet (die staan op de
// detailpagina: prijstype "Podiumpas" per rang). Zie de melding in config.js.
const PAS_ZAAL = /^(middenzaal|rabozaal)\b/i;
export const PODIUMPAS_MAX_PRIJS = 50;

// Zalen in het eigen gebouw (Beursstraat). Andere plekken krijgen `locatie`.
const EIGEN_ZAAL = /^(middenzaal|rabozaal|wolvecampfoyer|the green room)\b/i;
const PLAATS = { 'kulturhus borne': 'Borne' };

// Een tweede regel die geen maker is.
const GEEN_MAKER = /^(i\.?s\.?m\.?|presenteert|presents?)\s/i;

// Geen voorstelling: workshops, en een informatieavond met gratis entree
// (ook bij De Reggehof).
const WEGLATEN_GENRE = /^workshop$/i;
const WEGLATEN_TITEL = /^de kunst van leven tot het laatst$/i;

// "Alleen professionele voorstellingen" (bron hierboven): genre "Regionaal"
// is amateurwerk uit de regio (Hengelose Revue, koren, Federatie
// Amateurkunst; 9 okt 2026), dus geen Podiumpas.
const AMATEUR_GENRE = /^regionaal$/i;

const MAANDEN = { jan: 1, feb: 2, mrt: 3, maa: 3, apr: 4, mei: 5, jun: 6, jul: 7, aug: 8, sep: 9, okt: 10, nov: 11, dec: 12 };

/** "Za 17 okt. 2026 - 20:30 uur - Kulturhus Borne" → { datum, tijd, plek }. */
export function leesHengeloRegel(tekst) {
  const m = /(\d{1,2})\s+([a-z]{3})[a-z]*\.?\s+(\d{4})\s*-\s*(\d{1,2})[:.](\d{2})\s*uur(?:\s*-\s*(.+))?/i.exec(String(tekst ?? '').trim());
  if (!m || !MAANDEN[m[2].toLowerCase()]) return null;
  const pad = (n) => String(n).padStart(2, '0');
  return { datum: `${m[3]}-${pad(MAANDEN[m[2].toLowerCase()])}-${pad(m[1])}`, tijd: `${pad(m[4])}:${m[5]}`, plek: m[6]?.trim() || null };
}

/**
 * Welke van de twee regels op de tegel de voorstelling is: de URL is
 * /<voorstelling>-<artiest>/<datum> (9 okt 2026), terwijl de tegel soms de
 * artiest bovenaan zet ("Thijs Kemperink" / "Tot het uiterste gedreven") en
 * soms de voorstelling ("Afslag Gewist" / "Debby Petter & Emma Finkers"). De
 * slug wijkt soms wat af ("big-yari-…-jörgen-raymann" voor "Bigi Yari: …"),
 * dus per volgorde: hoeveel tekens van het begin van de slug passen bij de
 * eerste, en hoeveel van het eind bij de tweede. Alleen bij een duidelijk
 * verschil (≥ MARGE) beslist de URL; anders null.
 */
const MARGE = 4;
const gelijkBegin = (x, y) => {
  let i = 0;
  while (i < x.length && i < y.length && x[i] === y[i]) i++;
  return i;
};
const gelijkEind = (x, y) => gelijkBegin([...x].reverse().join(''), [...y].reverse().join(''));

export function hengeloVolgorde(href, kop, onder) {
  const slug = decodeURIComponent(String(href ?? '')).split('/').filter(Boolean).at(-2) ?? '';
  const s = slugify(slug);
  const a = slugify(kop ?? '');
  const b = slugify(onder ?? '');
  if (!s || !a || !b || a === b) return null;
  const kopEerst = gelijkBegin(s, a) + gelijkEind(s, b);
  const onderEerst = gelijkBegin(s, b) + gelijkEind(s, a);
  if (kopEerst >= onderEerst + MARGE) return { voorstelling: kop, artiest: onder };
  if (onderEerst >= kopEerst + MARGE) return { voorstelling: onder, artiest: kop };
  return null;
}

// Draait in de browser: de tegels van één lijstpagina en de link "volgende".
function leesTegels() {
  const t = (e) => e?.textContent.trim().replace(/\s+/g, ' ') || null;
  return {
    tegels: [...document.querySelectorAll('.show-tile')].map((tegel) => ({
      href: tegel.querySelector('a.show-tile__link')?.getAttribute('href') ?? null,
      kop: t(tegel.querySelector('.show-tile__link .h4')),
      onder: t(tegel.querySelector('.show-tile__link .h5')),
      regel: t(tegel.querySelector('.show-tile__content p')),
      tags: [...tegel.querySelectorAll('.show-tile__labels .tag')].map(t).filter(Boolean),
      labels: [...tegel.querySelectorAll('.show-tile__labels .label')].map(t).filter(Boolean),
      bestel: tegel.querySelector('a.btn--cart')?.getAttribute('href') ?? null,
      showid: tegel.querySelector('[data-showid]')?.getAttribute('data-showid') ?? null,
    })),
    volgende: document.querySelector('a.show-overview__next')?.getAttribute('href') ?? null,
  };
}

/**
 * Schouwburg Hengelo. Craft CMS (X-com), kaartverkoop via Itix.
 * /theaterprogramma?page=N is server-rendered: 24 tegels per pagina, één per
 * speeldatum, met titel, maker, "Za 17 okt. 2026 - 20:30 uur - Rabozaal",
 * genre en een label (Laatste kaarten / Uitverkocht). ~14 pagina's, dus ~14
 * verzoeken; geen detailpagina's.
 */
export async function scrapeHengelo({ page, theater, robots, waitForTurn, log, warn }) {
  if (!robots.isAllowed(AGENDA_PATH)) throw new Error(`robots.txt verbiedt ${AGENDA_PATH} — niet scrapen`);
  const zwaar = await blokkeerZwareBronnen(page, { ookScripts: true, ookOverig: true });
  const tegels = [];
  let url = new URL(AGENDA_PATH, theater.baseUrl).toString();
  for (let p = 1; url && p <= MAX_PAGINAS; p++) {
    if (!robots.isAllowed(new URL(url).pathname + new URL(url).search)) throw new Error(`robots.txt verbiedt ${url}`);
    await waitForTurn();
    const res = await gaNaar(page, url, { timeout: 45000 });
    if (!res || res.status() !== 200) throw new Error(`programma gaf HTTP ${res?.status() ?? '?'} op ${url}`);
    const r = await page.evaluate(leesTegels);
    // Sanity check: de eerste pagina moet tegels hebben.
    if (p === 1 && r.tegels.length === 0) throw new Error(`geen tegels op ${url} — site veranderd of geblokkeerd?`);
    tegels.push(...r.tegels);
    const volgende = r.volgende ? new URL(r.volgende, url).toString() : null;
    url = volgende && volgende !== url && r.tegels.length > 0 ? volgende : null;
    if (p === MAX_PAGINAS && url) warn(`meer dan ${MAX_PAGINAS} pagina's — paginering stuk?`);
  }
  // Een tegel met een periode ("Do 12 nov. t/m Za 14 nov. 2026 - Middenzaal")
  // heeft geen tijd: de speeldata staan op de detailpagina (uit de cache).
  const cache = await openDetailCache('hengelo');
  const alle = [];
  let mislukt = 0;
  for (const tg of tegels) {
    if (!isPeriode(tg.regel) || !tg.href) {
      alle.push(tg);
      continue;
    }
    const url = new URL(tg.href, theater.baseUrl).toString();
    if (!robots.isAllowed(new URL(url).pathname)) continue;
    try {
      const r = await cache.haal(url, async () => {
        await waitForTurn();
        const d = await gaNaar(page, url, { timeout: 30000 });
        if (!d || d.status() !== 200) throw new Error(`HTTP ${d?.status() ?? '?'}`);
        return page.evaluate(leesSpeeldata);
      });
      if (r.oud) log(`detailpagina ${url}: ${r.fout.message} — gegevens van eerder gebruikt.`);
      if (!r.data.length) log(`detailpagina ${url}: geen speeldata gevonden — overgeslagen.`);
      for (const sd of r.data) alle.push({ ...tg, regel: sd.regel, labels: sd.knop && !/^bestellen$/i.test(sd.knop) ? [sd.knop] : tg.labels.filter((l) => !/laatste|uitverkocht|wachtlijst/i.test(l)), bestel: sd.bestel ?? tg.bestel, showid: sd.showid, prijs: sd.prijs });
    } catch (err) {
      mislukt++;
      log(`detailpagina ${url}: ${err.message} — overgeslagen.`);
    }
  }
  await cache.bewaar();
  if (cache.stats.nieuw + cache.stats.ververst + cache.stats.uitCache + mislukt > 0) {
    log(`detailpagina's (periodes): ${cache.stats.nieuw} nieuw, ${cache.stats.ververst} ververst, ${cache.stats.uitCache} uit de cache, ${mislukt} mislukt`);
  }
  const shows = verwerkHengelo(alle, { theater, log });
  log(`${zwaar.verzoeken()} verzoeken`);
  return shows;
}

const isPeriode = (regel) => /\bt\/m\b/i.test(regel ?? '');

// Draait in de browser op een detailpagina: alle speeldata (ook die achter
// "Bekijk alle speeldata"), één keer per showid.
function leesSpeeldata() {
  const t = (e) => e?.textContent.trim().replace(/\s+/g, ' ') || null;
  const gezien = new Set();
  const uit = [];
  for (const blok of document.querySelectorAll('.show-details__price')) {
    const knop = blok.querySelector('[data-showid]');
    const id = knop?.getAttribute('data-showid') ?? t(blok.querySelector('.show-details__date'));
    if (!id || gezien.has(id)) continue;
    gezien.add(id);
    uit.push({
      regel: t(blok.querySelector('.show-details__date')),
      prijs: t(blok.querySelector('.show-details__price__range')),
      knop: t(knop) ?? t(blok.querySelector('.show-details__conversion')),
      bestel: knop?.getAttribute('href') ?? null,
      showid: knop?.getAttribute('data-showid') ?? null,
    });
  }
  return uit;
}

/** De tegels → voorstellingen (los te testen). */
export function verwerkHengelo(tegels, { theater, log = () => {}, opgehaaldOp = new Date().toISOString() }) {
  const buildId = createIdBuilder();
  const shows = [];
  const gezien = new Set();
  const weg = {};
  const onbekend = {};
  const geenPas = {};
  const twijfel = [];
  const tel = (o, k) => (o[k] = (o[k] ?? 0) + 1);

  for (const tg of tegels) {
    const r = leesHengeloRegel(tg.regel);
    if (!tg.kop || !r) {
      if (tg.kop) log(`kon datum niet lezen: "${tg.regel}" (${tg.kop}) — overgeslagen.`);
      continue;
    }
    const genreRuw = tg.tags[0] ?? null;
    if ((genreRuw && WEGLATEN_GENRE.test(genreRuw)) || WEGLATEN_TITEL.test(tg.kop)) {
      tel(weg, genreRuw && WEGLATEN_GENRE.test(genreRuw) ? genreRuw : tg.kop);
      continue;
    }
    if (genreRuw && !isBekendGenre(genreRuw)) tel(onbekend, genreRuw);
    const bron = tg.href ? new URL(tg.href, theater.baseUrl).toString() : theater.agendaUrl;
    // Dezelfde tegel kan op twee lijstpagina's staan; een periode geeft
    // meer speeldata met dezelfde link.
    const sleutel = `${bron}|${r.datum}|${r.tijd}`;
    if (gezien.has(sleutel)) continue;
    gezien.add(sleutel);

    const label = tg.labels.join(' ');
    const beschikbaarheid =
      vervallenStatus(label) ?? (/uitverkocht/i.test(label) ? 'uitverkocht' : /wachtlijst/i.test(label) ? 'wachtlijst' : tg.bestel ? 'beschikbaar' : 'onbekend');

    const plek = r.plek;
    const eigen = !plek || EIGEN_ZAAL.test(plek);
    const prijs = tg.prijs ? lowestPrice(tg.prijs) : null;
    let podiumpas = theater.podiumpas;
    if (!plek || !PAS_ZAAL.test(plek)) {
      podiumpas = false;
      tel(geenPas, plek ?? 'zaal onbekend');
    } else if (genreRuw && AMATEUR_GENRE.test(genreRuw)) {
      podiumpas = false;
      tel(geenPas, 'regionaal (amateur)');
    } else if (prijs != null && prijs > PODIUMPAS_MAX_PRIJS) {
      podiumpas = false;
      tel(geenPas, `prijs > €${PODIUMPAS_MAX_PRIJS}`);
    }

    const kop = metEnDash(tg.kop);
    const onder = tg.onder ? metEnDash(tg.onder) : null;
    const volgorde = onder ? hengeloVolgorde(tg.href, tg.kop, tg.onder) : null;
    let titel = kop;
    let maker = onder;
    if (volgorde) {
      titel = metEnDash(volgorde.voorstelling);
      maker = metEnDash(volgorde.artiest);
    } else if (onder) {
      twijfel.push(`${kop} / ${onder}`);
    }
    // "i.s.m. Tetem", "presents A Celebration of …": geen maker.
    let beschrijving = null;
    if (maker && GEEN_MAKER.test(maker)) {
      beschrijving = maker;
      maker = null;
    }
    const lab = labelUitTitel(titel);
    titel = lab.tekst;
    const labMaker = labelUitTitel(maker);
    maker = labMaker.tekst;
    const titelLabel = lab.label ?? labMaker.label;
    if (titelLabel) beschrijving = [titelLabel, beschrijving].filter(Boolean).join(' · ');

    let show = {
      id: null,
      titel,
      theaterId: theater.id,
      theaterNaam: theater.naam,
      stad: theater.stad,
      podiumpas,
      datum: r.datum,
      tijd: r.tijd,
      genre: normalizeGenre(genreRuw),
      genreRuw,
      beschikbaarheid,
      beschrijving,
      maker,
      prijs,
      ...(eigen ? { zaal: plek } : { locatie: `${plek} | ${PLAATS[plek.toLowerCase()] ?? theater.stad}` }),
      reserverenUrl: tg.bestel && /^https?:/.test(tg.bestel) ? tg.bestel : bron,
      bron,
      opgehaaldOp,
    };
    // Cabaret: "Voorstelling – Artiest" (titels.js).
    if (volgorde) {
      const c = pasTitelConventieToe(show, { artiest: maker, voorstelling: titel });
      if (c !== show) show = { ...c, maker: null };
    }
    shows.push({ ...show, id: buildId(theater.id, show.titel, show.datum, show.tijd) });
  }
  const lijst = (o) => Object.entries(o).map(([x, n]) => `${x} (${n})`).join(', ');
  if (Object.keys(weg).length) log(`weggelaten: ${lijst(weg)}`);
  if (Object.keys(geenPas).length) log(`podiumpas false: ${lijst(geenPas)}`);
  if (Object.keys(onbekend).length) log(`onbekende genres: ${lijst(onbekend)}`);
  if (twijfel.length) log(`volgorde titel/maker niet uit de URL af te leiden (kop = titel, onder = maker): ${twijfel.length}× — ${twijfel.slice(0, 5).join('; ')}`);
  return shows;
}
