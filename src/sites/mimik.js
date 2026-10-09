import { createIdBuilder, todayIsoDate } from '../lib/normalize.js';
import { normalizeGenre, isBekendGenre } from '../lib/genre.js';
import { titelUitKopEnOndertitel, metEnDash } from '../lib/titels.js';
import { vervallenStatus } from '../lib/beschikbaarheid.js';
import { lowestPrice } from '../lib/exclusions.js';
import { productieUrls } from '../lib/cre8ion.js';
import { openDetailCache } from '../lib/detailCache.js';
import { blokkeerZwareBronnen } from '../lib/zwareBronnen.js';
import { gaNaar } from '../lib/diagnose.js';

const SITEMAP_PATH = '/sitemap.xml';
const DAG = 86_400_000;

// Hooguit zoveel productiepagina's per run. De opbouw (~200 adressen in de
// sitemap, ook films) gaat zo over 3 nachten (80 + 80 + ~40); daarna ~35 per
// nacht: nieuwe adressen, producties met een speeldatum in de komende 7 dagen
// (dagelijks, voor uitverkocht/afgelast) en de wekelijkse verversing.
export const MAX_OPHALEN_PER_RUN = 80;
// Een productie met een speeldatum binnen zoveel dagen: dagelijks verversen.
export const DAGELIJKS_BINNEN_DAGEN = 7;
// Weggelaten producties (film e.d.): hooguit eens per zoveel dagen opnieuw.
const WEG_VERVERSEN_DAGEN = 30;

/**
 * Wat weg moet (geen theater- of podiumvoorstelling), uit de categorie bovenaan
 * de pagina en de titel. Geeft een reden of null.
 */
export function mimikWeglaten({ categorie, kop, onder }) {
  const c = String(categorie ?? '').trim();
  const t = `${kop ?? ''} ${onder ?? ''}`;
  // "Film", "Film, Junior", "Sneak Preview" (een verrassingsfilm).
  if (/\bfilm\b|^sneak preview$/i.test(c)) return 'film';
  if (/\b(workshop|cursus|masterclass)\b/i.test(t)) return 'workshop/cursus';
  return null;
}

/** Knoptekst → beschikbaarheid. */
export function mimikStatus(knop) {
  const t = String(knop ?? '').trim().toLowerCase();
  if (!t) return 'onbekend';
  const vervallen = vervallenStatus(t);
  if (vervallen) return vervallen;
  if (/uitverkocht/.test(t)) return 'uitverkocht';
  if (/wachtlijst/.test(t)) return 'wachtlijst';
  if (/tickets|bestel|laatste kaarten|reserveer/.test(t)) return 'beschikbaar';
  return 'onbekend';
}

/** "Verkoop start 23 oktober 12:00": de verkoop is nog niet begonnen (status onbekend, geen waarschuwing). */
export function isVerkoopNogNiet(knop) {
  return /^verkoop\s*start/i.test(String(knop ?? '').trim());
}

/**
 * De speeldata van een productie: rijen "za 10-10" (zonder jaar) met tijd;
 * het jaar uit de eerste JSON-LD-startDate, daarna oplopend (een maand die
 * terugspringt = volgend jaar). Zonder JSON-LD: het jaar van `vandaag`.
 */
export function mimikSpeeldata(rijen, eersteStart, vandaag = todayIsoDate()) {
  const uit = [];
  let jaar = Number((eersteStart ?? vandaag).slice(0, 4));
  let vorigeMaand = Number((eersteStart ?? vandaag).slice(5, 7));
  for (const r of rijen) {
    const m = /(\d{1,2})-(\d{1,2})/.exec(r.datum ?? '');
    if (!m) continue;
    const maand = Number(m[2]);
    if (maand < vorigeMaand) jaar++;
    vorigeMaand = maand;
    const t = /(\d{1,2})[:.](\d{2})/.exec(r.tijd ?? '');
    uit.push({
      ...r,
      datum: `${jaar}-${String(maand).padStart(2, '0')}-${m[1].padStart(2, '0')}`,
      tijd: t ? `${t[1].padStart(2, '0')}:${t[2]}` : null,
    });
  }
  return uit;
}

// Draait in de browser: categorie, kop, ondertitel, JSON-LD en de speeldata.
function leesProductie() {
  const t = (e) => e?.textContent.replace(/\s+/g, ' ').trim() || null;
  const starts = [];
  for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      for (const x of [].concat(JSON.parse(s.textContent))) if (/Event$/.test(x?.['@type'] ?? '') && x.startDate) starts.push(x.startDate);
    } catch {
      // Ongeldige JSON-LD: overslaan.
    }
  }
  const held = document.querySelector('.event-hero .slick-slide') ?? document;
  return {
    categorie: t(held.querySelector('h2.genre')),
    kop: t(held.querySelector('h1.title')),
    onder: t(held.querySelector('h2.subtitle')),
    eersteStart: starts.sort()[0] ?? null,
    rijen: [...document.querySelectorAll('#tickets li')].map((li) => ({
      datum: t(li.querySelector('.date')),
      tijd: t(li.querySelector('.time')),
      zaal: t(li.querySelector('.room')),
      prijs: t(li.querySelector('.sales')),
      knop: t(li.querySelector('.button a, .button')),
      href: li.querySelector('.button a')?.getAttribute('href') ?? null,
    })),
  };
}

/**
 * MIMIK (Deventer). The Cre8ion.Lab, zoals Munttheater: de agenda laadt via
 * /mvc/, en dat verbiedt robots.txt. Daarom sitemap.xml (~200 /agenda/-
 * adressen, ook films) en per productie de pagina zelf, via de detailcache
 * (cache/detail/mimik.json; zie MAX_OPHALEN_PER_RUN).
 */
export async function scrapeMimik({ page, theater, robots, waitForTurn, log, warn = log, vandaag = todayIsoDate(), nu = () => Date.now() }) {
  if (!robots.isAllowed(SITEMAP_PATH)) throw new Error(`robots.txt verbiedt ${SITEMAP_PATH} — niet scrapen`);
  const zwaar = await blokkeerZwareBronnen(page, { ookScripts: true, ookOverig: true });
  await waitForTurn();
  const res = await gaNaar(page, new URL(SITEMAP_PATH, theater.baseUrl).toString(), { timeout: 45000 });
  if (!res || res.status() !== 200) throw new Error(`sitemap.xml gaf HTTP ${res?.status() ?? '?'}`);
  const urls = productieUrls(await res.text()).filter((u) => robots.isAllowed(new URL(u).pathname));
  // Sanity check: de sitemap noemt de producties.
  if (urls.length === 0) throw new Error("geen productiepagina's (/agenda/…) in sitemap.xml — site veranderd of geblokkeerd?");

  const cache = await openDetailCache('mimik');
  const binnenkort = new Date(Date.parse(`${vandaag}T00:00:00Z`) + DAGELIJKS_BINNEN_DAGEN * DAG).toISOString().slice(0, 10);
  const leeftijd = (url) => nu() - (cache.opgehaaldOp(url) ?? 0);
  // Per adres: moet hij opgehaald, en met welke voorrang?
  const plan = [];
  let voorbij = 0;
  for (const url of urls) {
    const oud = cache.get(url);
    if (!oud) {
      plan.push({ url, voorrang: 2, reden: 'nieuw' });
      continue;
    }
    const data = oud.speeldata ?? [];
    if (mimikWeglaten(oud)) {
      if (leeftijd(url) > WEG_VERVERSEN_DAGEN * DAG) plan.push({ url, voorrang: 3, reden: 'weg, verversen' });
      continue;
    }
    if (data.length && data.every((s) => s.datum < vandaag)) {
      voorbij++;
      continue;
    }
    if (data.some((s) => s.datum >= vandaag && s.datum <= binnenkort) && leeftijd(url) >= 20 * 3_600_000) plan.push({ url, voorrang: 1, reden: 'binnenkort' });
    else if (cache.moetOphalen(url)) plan.push({ url, voorrang: 3, reden: 'wekelijks' });
  }
  plan.sort((a, b) => a.voorrang - b.voorrang);
  const nu_ophalen = plan.slice(0, MAX_OPHALEN_PER_RUN);
  const uitgesteld = plan.slice(MAX_OPHALEN_PER_RUN);
  let mislukt = 0;
  for (const { url } of nu_ophalen) {
    try {
      await cache.haal(
        url,
        async () => {
          await waitForTurn();
          const r = await gaNaar(page, url, { timeout: 45000 });
          if (!r || r.status() !== 200) throw new Error(`HTTP ${r?.status() ?? '?'}`);
          const p = await page.evaluate(leesProductie);
          // Wat weg moet, bepalen we bij het verwerken (mimikWeglaten), niet
          // hier: dan geldt een aangepaste regel ook voor de cache.
          return { ...p, speeldata: mimikSpeeldata(p.rijen, p.eersteStart, vandaag), rijen: undefined };
        },
        { forceer: true }
      );
    } catch (err) {
      mislukt++;
      log(`productiepagina ${url}: ${err.message} — overgeslagen.`);
    }
  }
  const nieuwUitgesteld = uitgesteld.filter((x) => x.reden === 'nieuw').length;
  await cache.bewaar();
  log(
    `${urls.length} adressen in de sitemap; opgehaald ${nu_ophalen.length} (${['binnenkort', 'nieuw', 'wekelijks', 'weg, verversen'].map((r) => `${r} ${nu_ophalen.filter((x) => x.reden === r).length}`).join(', ')}), ${uitgesteld.length} uitgesteld (grens ${MAX_OPHALEN_PER_RUN}), ${voorbij} voorbij, ${mislukt} mislukt`
  );
  if (nieuwUitgesteld > 0) warn(`${nieuwUitgesteld} nieuwe productiepagina('s) nog niet opgehaald (grens ${MAX_OPHALEN_PER_RUN} per run); volgende nacht verder.`);
  if (mislukt > Math.max(5, nu_ophalen.length / 4)) warn(`${mislukt} productiepagina's mislukt.`);

  const producties = urls.map((url) => ({ url, data: cache.get(url) })).filter((x) => x.data);
  const shows = verwerkMimik(producties, { theater, vandaag, log, warn });
  log(`${zwaar.verzoeken()} verzoek(en) naar de site (plus robots.txt)`);
  return shows;
}

/** Productiegegevens (uit de cache) → voorstellingen (los te testen). */
export function verwerkMimik(producties, { theater, vandaag = todayIsoDate(), log = () => {}, warn = log, opgehaaldOp = new Date().toISOString() }) {
  const buildId = createIdBuilder();
  const shows = [];
  const weg = {};
  const onbekend = {};
  const knoppen = {};
  const tel = (o, k) => (o[k] = (o[k] ?? 0) + 1);
  for (const { url, data } of producties) {
    const komend = (data.speeldata ?? []).filter((s) => s.datum >= vandaag);
    if (komend.length === 0) continue;
    const reden = mimikWeglaten(data);
    if (reden) {
      tel(weg, reden);
      continue;
    }
    if (!data.kop) continue;
    const genreRuw = data.categorie ?? null;
    if (genreRuw && !isBekendGenre(genreRuw)) tel(onbekend, genreRuw);
    const podium = PODIUMPAS_CATEGORIE.test(genreRuw ?? '');
    // Kop en ondertitel in delen ("Millennium Jazz Orchestra | april",
    // "Gelukskoekje | try-out"): het eerste deel telt, de rest (maand,
    // try-out, reprise) gaat naar de beschrijving. Een ondertitel die alleen
    // de maand herhaalt ("Januari"), valt weg.
    const [kop, ...kopRest] = data.kop.split(/\s+\|\s+/).map((d) => d.trim()).filter(Boolean);
    const [onderRuw, ...onderRest] = String(data.onder ?? '').split(/\s+\|\s+/).map((d) => d.trim()).filter(Boolean);
    const onder = onderRuw && !kopRest.some((d) => d.toLowerCase() === onderRuw.toLowerCase()) ? onderRuw : null;
    // Kop = maker, ondertitel = voorstelling ("Femke Arnouts" / "Het wakker
    // liggen van Wanda"): "Voorstelling – Maker" (titels.js).
    // Een reeks met de maand in de kop ("Tent van het Oosten | maart"): de
    // ondertitel is dan de gast ("Zilan Hasret Yıldız"), geen voorstelling.
    const uit = kopRest.length
      ? { titel: metEnDash(kop), maker: null, beschrijving: onder ?? null }
      : titelUitKopEnOndertitel({ beschrijving: null }, { kop: metEnDash(kop), ondertitel: onder ? metEnDash(onder) : null, volgorde: 'maker-titel' }) ?? { titel: kop, maker: null, beschrijving: null };
    const basis = { ...uit, beschrijving: [...kopRest, ...onderRest, uit.beschrijving].filter(Boolean).join(' · ') || null };
    for (const s of komend) {
      const status = mimikStatus(s.knop);
      if (status === 'onbekend' && s.knop && !isVerkoopNogNiet(s.knop)) tel(knoppen, s.knop);
      const zaal = (s.zaal ?? '').trim() || null;
      shows.push({
        id: buildId(theater.id, basis.titel, s.datum, s.tijd),
        titel: basis.titel,
        theaterId: theater.id,
        theaterNaam: theater.naam,
        stad: theater.stad,
        podiumpas: podium ? theater.podiumpas : null,
        ...(podium ? {} : { podiumpasNoot: PODIUMPAS_NOOT }),
        datum: s.datum,
        tijd: s.tijd,
        genre: genreRuw ? normalizeGenre(genreRuw) : null,
        genreRuw,
        beschikbaarheid: status,
        beschrijving: basis.beschrijving ?? null,
        maker: basis.maker ?? null,
        prijs: lowestPrice(s.prijs),
        ...(zaal ? { zaal } : {}),
        reserverenUrl: s.href ? new URL(s.href, theater.baseUrl).toString() : url,
        bron: url,
        opgehaaldOp,
      });
    }
  }
  const lijst = (o) => Object.entries(o).map(([k, n]) => `${k} (${n})`).join(', ');
  if (Object.keys(weg).length) log(`weggelaten (komende producties): ${lijst(weg)}`);
  if (Object.keys(onbekend).length) warn(`onbekende categorieën (nu Overig): ${lijst(onbekend)}`);
  if (Object.keys(knoppen).length) log(`onbekende knopteksten (als "onbekend"): ${lijst(knoppen)}`);
  return shows;
}

// Podiumpas bij MIMIK (bron: https://www.mimik.nl/podiumpas en
// https://www.mimik.nl/jouw-bezoek/theater, 9 okt 2026): "onbeperkt naar
// theatervoorstellingen"; films niet (daarvoor Cineville). Reserveren alleen
// via het formulier, vanaf 30 dagen. Welke categorieën theater zijn, zegt
// MIMIK zelf: het filter van /agenda?categorie=theater (8 okt 2026) noemt
// Cabaret, Dans, Fysiek theater, Junior, Muziektheater, Special, Theater,
// Theaterconcert en Woordkunst. Die dus true; andere ("Te gast"): null (nog
// niet bekend), met een noot.
const PODIUMPAS_CATEGORIE = /^(cabaret|dans|fysiek theater|junior|muziektheater|special|theater|theaterconcert|woordkunst)$/i;
const PODIUMPAS_NOOT = 'Geldt de Podiumpas hier? MIMIK noemt alleen theatervoorstellingen — vraag het theater.';
