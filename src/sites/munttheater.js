import { createIdBuilder, todayIsoDate } from '../lib/normalize.js';
import { normalizeGenre, isBekendGenre } from '../lib/genre.js';
import { titelUitKopEnOndertitel, pasTitelConventieToe } from '../lib/titels.js';
import { vervallenStatus } from '../lib/beschikbaarheid.js';
import { laagstePrijs } from '../lib/peppered.js';
import { blokkeerZwareBronnen } from '../lib/zwareBronnen.js';
import { gaNaar } from '../lib/diagnose.js';

const SITEMAP_PATH = '/sitemap.xml';
const MAX_PRODUCTIES = 250;

// Geen voorstellingen voor publiek: schoolvoorstellingen (inventarisatie §2.5).
const GENRE_WEG = /^educatie$|\beducatie\b/i;
const MAKER_EERST = /^(cabaret|show|muziek|komedie|speciaal)$/i;

/** Productie-URL's uit de sitemap (alleen /agenda/<slug>, niet koop-ticket). */
export function productieUrls(xml) {
  const urls = [...String(xml).matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1]);
  return [...new Set(urls.filter((u) => /\/agenda\/[^/?#]+$/.test(u) && !/\/agenda\/koop-ticket$/.test(u)))];
}

/**
 * Genre uit de labels bovenaan ("Muziek", soms ook een reeks als
 * "Toneelserie"): het eerste bekende genre, anders het eerste label.
 */
export function genreUitTags(tags) {
  const lijst = (tags ?? []).flatMap((t) => String(t).split('/')).map((t) => t.trim()).filter(Boolean);
  return lijst.find((t) => isBekendGenre(t)) ?? lijst[0] ?? null;
}

/** Knoptekst → beschikbaarheid. */
export function muntStatus(knop, eventStatus) {
  if (/cancel/i.test(eventStatus ?? '')) return 'afgelast';
  if (/postpone|reschedul/i.test(eventStatus ?? '')) return 'verplaatst';
  const t = String(knop ?? '').toLowerCase();
  if (!t) return 'onbekend';
  const vervallen = vervallenStatus(t);
  if (vervallen) return vervallen;
  if (/uitverkocht/.test(t)) return 'uitverkocht';
  if (/wachtlijst/.test(t)) return 'wachtlijst';
  if (/kaarten|tickets|bestel/.test(t)) return 'beschikbaar';
  return 'onbekend';
}

// Draait in de browser: JSON-LD-voorstellingen, ticketrijen en koppen.
function leesProductie() {
  const tekst = (el) => el?.textContent.replace(/\s+/g, ' ').trim() || null;
  // JSON-LD bevat soms HTML-entities ("Peek &amp; Bowl").
  const ontcijfer = (t) => (t == null ? null : new DOMParser().parseFromString(String(t), 'text/html').documentElement.textContent.trim() || null);
  const events = [];
  for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const d = JSON.parse(s.textContent);
      for (const x of [].concat(d)) if (/Event$/.test(x?.['@type'] ?? '')) events.push(x);
    } catch {
      // Ongeldige JSON-LD: overslaan.
    }
  }
  return {
    tags: [...document.querySelectorAll('.event-tags-wrapper .tag-pill')].map((t) => tekst(t)).filter(Boolean),
    events: events.map((e) => ({ naam: ontcijfer(e.name), performer: ontcijfer(e.performer?.name), start: e.startDate ?? null, status: e.eventStatus ?? null, prijs: e.offers?.price ?? null })),
    // Meerdere data: rijen in het blok "Tickets & tijden"; één datum: één
    // rij met knop in het samenvattingsblok.
    rijen: [...document.querySelectorAll('.contentblock-Tickets .ticket-row')].concat(document.querySelector('.contentblock-Tickets .ticket-row') ? [] : [...document.querySelectorAll('.summary-block .ticket-row')]).map((r) => ({
      datum: tekst(r.querySelector('strong')),
      knop: tekst(r.querySelector('.btn-ticket') ?? r.querySelector('a.btn')),
    })),
  };
}

/**
 * Munttheater (Weert).
 *
 * Structuur (geïnspecteerd 6 okt 2026, inventarisatie §2.5): de agenda toont
 * 10 speeldata en laadt de rest via /mvc/event/partial, maar robots.txt
 * verbiedt /mvc/. Daarom: sitemap.xml (~150 productiepagina's onder /agenda/,
 * ook voorbije) en per productie de pagina zelf: per speeldatum een
 * TheaterEvent in JSON-LD (startDate met jaar, eventStatus, prijs) en een
 * ticketrij met knop (Kaarten/Uitverkocht). Genre uit de labels
 * bovenaan (.event-tags-wrapper .tag-pill). ~150 verzoeken per run.
 */
export async function scrapeMunttheater({ page, theater, robots, waitForTurn, log, warn = log, vandaag = todayIsoDate() }) {
  if (!robots.isAllowed(SITEMAP_PATH)) {
    log(`robots.txt verbiedt ${SITEMAP_PATH} op ${theater.baseUrl} — sla over.`);
    return [];
  }
  const zwaar = await blokkeerZwareBronnen(page, { ookScripts: true, ookOverig: true });
  await waitForTurn();
  const res = await gaNaar(page, new URL(SITEMAP_PATH, theater.baseUrl).toString(), { timeout: 45000 });
  const urls = productieUrls(await res.text());
  // Sanity check: de sitemap noemt de producties.
  if (urls.length === 0) throw new Error('geen productiepagina\'s (/agenda/…) in sitemap.xml — site veranderd of geblokkeerd?');
  if (urls.length > MAX_PRODUCTIES) warn(`${urls.length} producties in de sitemap; alleen de eerste ${MAX_PRODUCTIES}.`);

  const buildId = createIdBuilder();
  const opgehaaldOp = new Date().toISOString();
  const shows = [];
  const weg = {};
  const onbekend = {};
  const tel = (o, k) => { o[k] = (o[k] ?? 0) + 1; };
  let geladen = 0;
  let mislukt = 0;
  for (const url of urls.slice(0, MAX_PRODUCTIES)) {
    if (!robots.isAllowed(new URL(url).pathname)) continue;
    await waitForTurn();
    let p;
    try {
      const r = await gaNaar(page, url, { timeout: 45000 });
      if (r && r.status() >= 400) {
        mislukt++;
        continue;
      }
      p = await page.evaluate(leesProductie);
      geladen++;
    } catch (err) {
      mislukt++;
      log(`kon ${url} niet laden: ${err.message}`);
      continue;
    }
    const genreRuw = genreUitTags(p.tags);
    const komend = p.events.filter((e) => e.start && e.start.slice(0, 10) >= vandaag);
    if (komend.length === 0) continue;
    if (p.tags.some((t) => GENRE_WEG.test(t))) {
      tel(weg, `${komend[0].naam} (${genreRuw})`);
      continue;
    }
    if (genreRuw && !isBekendGenre(genreRuw)) tel(onbekend, genreRuw);
    // Ticketrijen en JSON-LD staan in dezelfde volgorde; alleen bij gelijke
    // aantallen koppelen we de knop.
    const rijen = p.rijen.length === p.events.length ? p.rijen : null;
    for (const e of komend) {
      const i = p.events.indexOf(e);
      const datum = e.start.slice(0, 10);
      const tijd = e.start.slice(11, 16) || null;
      const kop = e.naam;
      if (!kop) continue;
      const basis = {
        id: buildId(theater.id, kop, datum, tijd),
        titel: kop,
        theaterId: theater.id,
        theaterNaam: theater.naam,
        stad: theater.stad,
        podiumpas: theater.podiumpas,
        datum,
        tijd,
        genre: genreRuw ? normalizeGenre(genreRuw) ?? 'Overig' : null,
        genreRuw,
        beschikbaarheid: muntStatus(rijen?.[i]?.knop, e.status),
        beschrijving: null,
        maker: null,
        prijs: laagstePrijs(e.prijs ? `€ ${e.prijs}` : null),
        reserverenUrl: url,
        bron: url,
        opgehaaldOp,
      };
      const volgorde = MAKER_EERST.test(genreRuw ?? '') ? 'maker-titel' : 'titel-maker';
      const show = titelUitKopEnOndertitel(basis, { kop, ondertitel: e.performer, volgorde });
      shows.push(show.maker ? pasTitelConventieToe(show, { artiest: show.maker, voorstelling: show.titel, makerWordtLeeg: true }) : show);
    }
  }
  log(`${urls.length} producties in de sitemap, ${geladen} geladen, ${mislukt} mislukt, ${shows.length} komende speeldata`);
  if (geladen === 0) throw new Error('geen enkele productiepagina geladen — geblokkeerd?');
  if (mislukt > urls.length / 4) warn(`${mislukt} van ${urls.length} productiepagina's mislukt.`);
  const lijst = (o) => Object.entries(o).map(([k, n]) => `${k} (${n})`).join(', ');
  if (Object.keys(weg).length) log(`weggelaten: ${lijst(weg)}`);
  if (Object.keys(onbekend).length) warn(`onbekende brongenres (nu Overig): ${lijst(onbekend)}`);
  log(`${zwaar.verzoeken()} verzoek(en) naar de site (plus robots.txt); ${zwaar.geblokkeerd()} afbeeldingen/scripts/fonts niet geladen`);
  return shows;
}
