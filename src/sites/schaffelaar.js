import { extractTime, createIdBuilder, todayIsoDate } from '../lib/normalize.js';
import { normalizeGenre, isBekendGenre } from '../lib/genre.js';
import { pasTitelConventieToe } from '../lib/titels.js';
import { vervallenStatus } from '../lib/beschikbaarheid.js';
import { gaNaar } from '../lib/diagnose.js';
import { openDetailCache } from '../lib/detailCache.js';
import { laagstePrijs } from '../lib/peppered.js';
import { blokkeerZwareBronnen } from '../lib/zwareBronnen.js';

const SITEMAP_PATH = '/sitemap.xml';

// Hooguit zoveel detailpagina's per run ophalen (~1,5 s per pagina). De
// eerste nachten (~290 adressen in de sitemap, ook voorbije producties) gaat
// de cache dus in stappen vol; daarna zijn het er ~10–40 per nacht. Zo kan
// Schaffelaar de nachtrun niet oprekken: na de grens geeft de scraper wat hij
// heeft en bewaart hij de cache (een time-out zou de cache niet bewaren).
export const MAX_OPHALEN_PER_RUN = 120;

// Podiumpas (bron: https://schaffelaartheater.nl/je-bezoek/podiumpas/, 7 okt
// 2026): alleen per mail, vanaf 30 dagen; niet bij uitverkocht, extern
// verkocht of zaalverhuur. Extern: de kaartenknop gaat niet naar de eigen
// Ticketmatic-shop. Zaalverhuur: "verhuur" in genre of ondertitel, of het
// label "tegast" (Ondernemers Event gemeente Barneveld, Literair Café; 7 okt
// 2026): vermoedelijk zaalhuur, nagevraagd in mail 7 okt 2026. Tot het
// antwoord false (staat nergens letterlijk op de site).
const EIGEN_VERKOOP = /^apps\.ticketmatic\.com$/i;
const EIGEN_SHOP = /\/widgets\/schaffelaartheater\//i;
const VERHUUR = /\bverhuur\b|^tegast$/i;

// Labels, geen genre (reeksen van het theater).
const LABELS = /^(schaffelbende|dinsdagmiddagmatinee|vanbarneveldsebodem|tegast)$/i;

// Geen voorstelling: film (Rabokidsclub - bios), en de informatieavonden van
// OncoSalon Barneveld (genre "oncosalon" of zonder genre; 9 okt 2026).
const WEGLATEN_GENRE = /^film$/i;
const INFORMATIEAVOND = /^oncosalon\b/i;

/** Waarom een productie geen voorstelling is ('film', 'informatieavond'), of null. */
export function schaffelaarWeglaten(p) {
  if (p.genres.some((g) => WEGLATEN_GENRE.test(g))) return 'film';
  if (INFORMATIEAVOND.test(p.titel ?? '') || p.genres.some((g) => INFORMATIEAVOND.test(g))) return 'informatieavond';
  return null;
}

// Bij cabaret en show is de titel de artiest en de ondertitel het programma
// ("Klaas van der Eerden" / "Imperfect (Try Out)", "Johnny de Mol" / "Goed
// dat jij bestaat!"); bij de andere genres is de ondertitel meestal de maker
// ("De Notenkraker" / "Charkiv City Ballet", comedy "Boeing Boeing" / "Loiza
// Lamers, …"). Niet bij een titel met een cijfer of uitroepteken ("Tis hier
// geen hotel 3", "De Grote Jaren 80 Show!") en niet bij het Nationaal
// Theaterweekend ("Verrassingsvoorstelling …").
const ARTIEST_EERST = /^(cabaret|show)$/i;
// Titelregel per productie (Voorstelling – Maker), bron: de productiepagina's
// van 7 okt 2026. "Peter Pannekoek" / "Demonen (Try-Out)" heeft geen genre;
// "Tangarine" / "Running in the Family ll" (muziek) is de band met het programma.
const ARTIEST_TITELS = new Set(['Peter Pannekoek', 'Tangarine']);
// Een ondertitel die een omschrijving is ("Bouke Rocks Elvis" / "Een avond vol
// Elvis-magie"): naar de beschrijving, de titel blijft.
const OMSCHRIJVING = /^een (avond|middag|ode)\b/i;
const GEEN_ARTIEST = (titel, onder) => /\d|!/.test(titel) || /nationaal theaterweekend/i.test(onder);

// "Roel & Jos Maalderink - Verplaatst": de oude datum (de nieuwe staat op de eigen pagina).
const VERPLAATST = /\s*[-–]\s*verplaatst\s*$/i;

// "(Try Out)", "(Reprise)", "(Première)" achter het programma: naar de beschrijving.
const KENMERK = /\s*\((try[- ]?out|reprise|premi[eè]re)\)\s*$/i;

/** Knoptekst → beschikbaarheid. */
export function schaffelaarStatus(tekst) {
  const t = String(tekst ?? '').trim().toLowerCase();
  const vervallen = vervallenStatus(t);
  if (vervallen) return vervallen;
  if (/uitverkocht/.test(t)) return 'uitverkocht';
  if (/wachtlijst/.test(t)) return 'wachtlijst';
  if (/kaarten/.test(t)) return 'beschikbaar'; // "Kaarten", "Laatste kaarten"
  return 'onbekend';
}

/** "do. 25-03-2027 | 20:00" → { datum: "2027-03-25", tijd: "20:00" } of null. */
export function schaffelaarDatum(tekst) {
  const m = String(tekst ?? '').match(/(\d{1,2})-(\d{1,2})-(\d{4})/);
  if (!m) return null;
  return { datum: `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`, tijd: extractTime(String(tekst).split('|')[1] ?? '') };
}

/** Productie-adressen uit sitemap.xml: [{ url, lastmod }], zonder /agenda/ zelf. */
export function agendaUitSitemap(xml, baseUrl) {
  const uit = [];
  for (const blok of String(xml).match(/<url>[\s\S]*?<\/url>/g) ?? []) {
    const loc = blok.match(/<loc>\s*([^<\s]+)\s*<\/loc>/)?.[1];
    if (!loc) continue;
    const u = new URL(loc, baseUrl);
    if (!/^\/agenda\/[^/]+\/$/.test(u.pathname)) continue;
    const lastmod = Date.parse(blok.match(/<lastmod>\s*([^<\s]+)\s*<\/lastmod>/)?.[1] ?? '');
    uit.push({ url: u.toString(), lastmod: Number.isNaN(lastmod) ? null : lastmod });
  }
  return uit;
}

// Draait in de browser op een productiepagina.
function leesProductie() {
  const t = (e) => e?.textContent.trim().replace(/\s+/g, ' ') || null;
  const zij = document.querySelector('.production-info-side');
  const kop = [...(zij?.querySelectorAll('h5') ?? [])].find((h) => /locatie/i.test(h.textContent));
  // Een voorbije productie houdt haar adres, maar de pagina toont dan alleen
  // het kale sjabloon (geen #production-page): archief, nooit meer ophalen.
  if (!document.querySelector('#production-page')) return { archief: true, titel: null, onder: null, genres: [], zaal: null, prijs: null, rijen: [] };
  return {
    titel: t(document.querySelector('h1.production-content-title')),
    onder: t(document.querySelector('.production-content-subtitle')),
    genres: [...document.querySelectorAll('.production-content-genres a.genre')].map(t).filter(Boolean),
    zaal: t(kop?.nextElementSibling),
    prijs: t(zij?.querySelector('.pricetable')),
    rijen: [...document.querySelectorAll('.production-event-orders .button-group')].map((g) => {
      const knop = g.querySelector('a.event-cta');
      return { datum: t(g.querySelector('.event-cta-date')), knop: t(knop), href: knop?.getAttribute('href') || null };
    }),
  };
}

/**
 * Schaffelaartheater (Barneveld). De agenda op de site komt uit een API onder
 * /umbraco/, en die verbiedt robots.txt: die gebruiken we dus niet (ook niet
 * via een browser die de agendapagina rendert). We vragen het theater om
 * toestemming. Tot dan: sitemap.xml (toegestaan) voor de productie-adressen,
 * en per productie de detailpagina, via de detailcache (detailCache.js):
 * nieuwe producties meteen, bekende hooguit één keer per week, of eerder als
 * de sitemap een nieuwere lastmod geeft; voorbije producties nooit meer.
 * Let op: status (uitverkocht, laatste kaarten) en nieuwe speeldata van een
 * bekende productie kunnen daardoor tot een week achterlopen.
 */
export async function scrapeSchaffelaar({ page, theater, robots, waitForTurn, log, warn }) {
  if (!robots.isAllowed(SITEMAP_PATH)) throw new Error(`robots.txt verbiedt ${SITEMAP_PATH} — niet scrapen`);
  const zwaar = await blokkeerZwareBronnen(page, { ookScripts: true });
  // Elke productiepagina vraagt (inline script) het Ticketmatic-winkelmandje
  // op; dat lezen we niet (verdubbelde de verzoeken, 7 okt 2026).
  await page.route('https://apps.ticketmatic.com/**', (route) => route.abort('blockedbyclient').catch(() => {}));
  await waitForTurn();
  const sitemapUrl = new URL(SITEMAP_PATH, theater.baseUrl).toString();
  const res = await gaNaar(page, sitemapUrl, { timeout: 45000 });
  if (!res || res.status() !== 200) throw new Error(`sitemap gaf HTTP ${res?.status() ?? '?'} op ${sitemapUrl}`);
  const adressen = agendaUitSitemap(await res.text(), theater.baseUrl).filter((a) => robots.isAllowed(new URL(a.url).pathname));
  // Sanity check: een sitemap zonder agenda-adressen is veranderd of leeg.
  if (adressen.length === 0) throw new Error(`geen /agenda/-adressen in ${sitemapUrl} — sitemap veranderd?`);

  const vandaag = todayIsoDate();
  const cache = await openDetailCache(theater.id);
  // Nieuwe adressen eerst, de nieuwste (lastmod) voorop: die zijn het waarschijnlijkst nog actueel.
  adressen.sort((a, b) => Number(cache.opgehaaldOp(a.url) != null) - Number(cache.opgehaaldOp(b.url) != null) || (b.lastmod ?? 0) - (a.lastmod ?? 0));
  const producties = [];
  let opgehaald = 0;
  let voorbij = 0;
  let uitgesteld = 0;
  let mislukt = 0;
  for (const { url, lastmod } of adressen) {
    const oud = cache.get(url);
    // Een productie waarvan alle speeldata voorbij zijn, krijgt geen nieuwe.
    if (oud && (oud.archief || (oud.rijen.length > 0 && oud.rijen.every((r) => (schaffelaarDatum(r.datum)?.datum ?? '9999') < vandaag)))) {
      voorbij++;
      continue;
    }
    const gewijzigd = oud && lastmod != null && lastmod > (cache.opgehaaldOp(url) ?? 0);
    const nodig = !oud || gewijzigd || cache.moetOphalen(url);
    if (nodig && opgehaald >= MAX_OPHALEN_PER_RUN) {
      uitgesteld++;
      if (oud) producties.push({ url, ...oud });
      continue;
    }
    try {
      const r = await cache.haal(
        url,
        async () => {
          opgehaald++;
          await waitForTurn();
          const p = await gaNaar(page, url, { timeout: 30000 });
          if (!p || p.status() !== 200) throw new Error(`HTTP ${p?.status() ?? '?'}`);
          const data = await page.evaluate(leesProductie);
          if (!data.titel && !data.archief) throw new Error('geen titel op de pagina');
          return data;
        },
        { forceer: Boolean(gewijzigd) }
      );
      if (r.oud) log(`${url}: ${r.fout.message} — gegevens van een eerdere run gebruikt.`);
      if (r.data.archief) voorbij++;
      else producties.push({ url, ...r.data });
    } catch (err) {
      mislukt++;
      log(`${url}: ${err.message} — overgeslagen.`);
    }
  }
  await cache.bewaar();
  log(`detailpagina's: ${cache.stats.nieuw} nieuw, ${cache.stats.ververst} ververst, ${cache.stats.uitCache} uit de cache, ${voorbij} voorbij, ${uitgesteld} uitgesteld (grens ${MAX_OPHALEN_PER_RUN}), ${mislukt} mislukt`);
  if (mislukt > Math.max(5, opgehaald / 4)) warn(`${mislukt} detailpagina's mislukt.`);
  if (uitgesteld > 0) warn(`${uitgesteld} productiepagina('s) nog niet opgehaald (grens ${MAX_OPHALEN_PER_RUN} per run); volgende nacht verder.`);

  const buildId = createIdBuilder();
  const opgehaaldOp = new Date().toISOString();
  const shows = [];
  const onbekend = {};
  const geenPas = {};
  const tel = (o, k) => (o[k] = (o[k] ?? 0) + 1);
  const weg = {};
  for (const p of producties) {
    const reden = schaffelaarWeglaten(p);
    if (reden) {
      tel(weg, reden);
      continue;
    }
    for (const g of p.genres) if (!LABELS.test(g) && !isBekendGenre(g)) tel(onbekend, g);
    const genreRuw = p.genres.find((g) => !LABELS.test(g)) ?? null;
    const kenmerk = p.onder?.match(KENMERK)?.[1] ?? p.titel.match(KENMERK)?.[1] ?? null;
    // "Running in the Family ll": twee kleine L's voor Romeins II.
    const onderKaal = p.onder?.replace(KENMERK, '').replace(/\s+ll$/, ' II').trim() || null;
    const omschrijving = onderKaal && OMSCHRIJVING.test(onderKaal) ? onderKaal : null;
    const onder = omschrijving ? null : onderKaal;
    const verplaatst = VERPLAATST.test(p.titel);
    const titel = p.titel.replace(VERPLAATST, '').replace(KENMERK, '').trim();
    const verhuur = [...p.genres, p.onder ?? ''].some((x) => VERHUUR.test(x));
    const prijs = laagstePrijs(p.prijs);
    for (const r of p.rijen) {
      const d = schaffelaarDatum(r.datum);
      if (!d || d.datum < vandaag) continue;
      let extern = false;
      try {
        const h = r.href ? new URL(r.href, theater.baseUrl) : null;
        extern = Boolean(h && !(EIGEN_VERKOOP.test(h.hostname) && EIGEN_SHOP.test(h.pathname)) && h.hostname !== new URL(theater.baseUrl).hostname);
      } catch {
        extern = false;
      }
      const podiumpas = theater.podiumpas && !extern && !verhuur;
      if (!podiumpas) tel(geenPas, verhuur ? 'zaalverhuur' : 'extern verkocht');
      const kenmerkTekst = kenmerk ? kenmerk.replace(/^try[- ]?out$/i, 'Try-out').replace(/^reprise$/i, 'Reprise').replace(/^premi[eè]re$/i, 'Première') : null;
      const show = {
        id: buildId(theater.id, titel, d.datum, d.tijd),
        titel,
        theaterId: theater.id,
        theaterNaam: theater.naam,
        stad: theater.stad,
        zaal: p.zaal,
        podiumpas,
        datum: d.datum,
        tijd: d.tijd,
        genre: normalizeGenre(genreRuw),
        genreRuw,
        beschikbaarheid: verplaatst ? 'verplaatst' : schaffelaarStatus(r.knop),
        beschrijving: [kenmerkTekst, omschrijving].filter(Boolean).join('. ') || null,
        maker: onder,
        prijs,
        reserverenUrl: r.href && /^https?:/.test(r.href) ? r.href : p.url,
        bron: p.url,
        opgehaaldOp,
      };
      const artiestEerst = onder && ((ARTIEST_EERST.test(genreRuw ?? '') && !/:\s/.test(titel) && !GEEN_ARTIEST(titel, onder)) || ARTIEST_TITELS.has(titel));
      shows.push(artiestEerst ? pasTitelConventieToe(show, { artiest: titel, voorstelling: onder, makerWordtLeeg: true, alleGenres: true }) : show);
    }
  }
  const lijst = (o) => Object.entries(o).map(([x, n]) => `${x} (${n})`).join(', ');
  if (Object.keys(weg).length) log(`weggelaten: ${lijst(weg)}`);
  if (Object.keys(geenPas).length) log(`podiumpas: false bij ${lijst(geenPas)}`);
  if (Object.keys(onbekend).length) warn(`onbekende brongenres (nu Overig): ${lijst(onbekend)}`);
  log(`${zwaar.verzoeken()} verzoek(en) naar de site (plus robots.txt)`);
  return shows;
}
