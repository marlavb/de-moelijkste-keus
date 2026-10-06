import { pagineerListing } from '../lib/peppered.js';
import { createDutchDayParser, extractTime, createIdBuilder } from '../lib/normalize.js';
import { normalizeGenreFromList } from '../lib/genre.js';
import { draaiTitelEnMakerOm, pasTitelConventieToe, isWervend } from '../lib/titels.js';
import { vervallenStatus } from '../lib/beschikbaarheid.js';
import { blokkeerZwareBronnen } from '../lib/zwareBronnen.js';

const AGENDA_PATH = '/agenda';
const MAX_LISTING_PAGES = 50;

// Knoptekst: "Tickets", "Laatste tickets", "Aanmelden" = beschikbaar;
// "Wachtlijst"; "Uitverkocht".
function classifyBeschikbaarheid(knop) {
  const vervallen = vervallenStatus(knop);
  if (vervallen) return vervallen;
  const t = (knop ?? '').trim().toLowerCase();
  if (t.includes('uitverkocht')) return 'uitverkocht';
  if (t.includes('wachtlijst')) return 'wachtlijst';
  if (t.includes('ticket') || t.includes('aanmelden') || t.includes('bestel')) return 'beschikbaar';
  return 'onbekend';
}

/**
 * Cpunt (Hoofddorp). Geen Podiumpas-theater (config podiumpas: false);
 * toegevoegd om o.a. "Jordy van Loon speelt Louis Davids" te volgen.
 *
 * Structuur (geïnspecteerd op https://www.cpunt.nl/agenda, 1 okt 2026): eigen
 * CMS, server-rendered, ~33 pagina's via ?page=N met 24 items, per dag
 * gegroepeerd. De agenda bevat ook bibliotheek, film, activiteiten en
 * poppodium: we houden alleen items met categorie "Theater" (item_category2
 * in het dataLayer-script bij elk item; het sitefilter locatie=theater mist
 * de Kleine Pier). Per item: titel (h3), ondertitel (p.categories), een reeks
 * p.article-subtitle (eventueel een slogan, dan de hoofdcategorie
 * "Theater…", dan het genre), locatie (alleen buiten de theaterzalen, bv.
 * "Kleine Pier, Raadhuisplein 3-9, Hoofddorp"), datum en tijd (ook als
 * 02-10-2026 en 20:00 in het dataLayer-script), knop en prijs.
 * Alles uit de listing: ~34 verzoeken per run (pagina's plus robots.txt).
 *
 * Titels: bij cabaret artiest/voorstelling ("Kasper van der Laan" / "Ruim")
 * omdraaien; anders bronvolgorde met de ondertitel als maker ("Jordy van
 * Loon" / "Speelt Louis Davids", "Next to Normal" / "Willemijn Verkaik,
 * Edwin Jonker e.a."). Een wervende ondertitel wordt geen maker.
 */
export async function scrapeCpunt({ page, theater, robots, waitForTurn, log, warn = log }) {
  if (!robots.isAllowed(AGENDA_PATH)) {
    log(`robots.txt verbiedt ${AGENDA_PATH} op ${theater.baseUrl} — sla over.`);
    return [];
  }
  const zwaar = await blokkeerZwareBronnen(page, { ookScripts: true });

  const items = await pagineerListing({
    page,
    theater,
    robots,
    waitForTurn,
    log,
    warn,
    agendaPath: AGENDA_PATH,
    maxPages: MAX_LISTING_PAGES,
    parameter: 'page',
    leesParameter: false,
    leegIsFout: true,
    label: 'items',
    sleutelVan: (it) => `${it.href}|${it.datumData ?? it.datumTekst}|${it.tijdData ?? it.tijdTekst}`,
    extract: () =>
      Array.from(document.querySelectorAll('.article-wrapper')).map((el) => {
        const tekst = (e) => e?.textContent.replace(/\s+/g, ' ').trim() || null;
        // Het dataLayer-script direct na het item (wordt niet uitgevoerd,
        // scripts zijn geblokkeerd; de tekst staat wel in de DOM).
        let script = el.nextElementSibling;
        while (script && script.tagName !== 'SCRIPT' && !script.classList.contains('article-wrapper')) script = script.nextElementSibling;
        const data = script?.tagName === 'SCRIPT' ? script.textContent : '';
        const veld = (naam) => data.match(new RegExp(`${naam}: "([^"]*)"`))?.[1]?.trim() ?? null;
        return {
          href: el.querySelector('a.ticket-row')?.getAttribute('href') ?? null,
          titel: tekst(el.querySelector('.article-title')),
          ondertitel: tekst(el.querySelector('p.categories')),
          regels: Array.from(el.querySelectorAll('p.article-subtitle')).map(tekst).filter(Boolean),
          locatie: tekst(el.querySelector('.article-location')),
          datumTekst: tekst(el.querySelector('.article-date')),
          tijdTekst: tekst(el.querySelector('.article-time')),
          knop: tekst(el.querySelector('.btn-secondary-text')),
          categorie: veld('item_category2'),
          zaal: veld('item_category3'),
          datumData: veld('item_category4'),
          tijdData: veld('item_category5'),
          prijs: data.match(/price: ([\d.]+)/)?.[1] ?? null,
        };
      }),
  });

  const parseDay = createDutchDayParser();
  const buildId = createIdBuilder();
  const opgehaaldOp = new Date().toISOString();
  const shows = [];
  const zonderGenre = {};
  const knoppen = {};
  const gezien = new Set();
  let andere = 0;
  let dubbel = 0;

  for (const it of items) {
    if (!it.titel || !it.href) continue;
    if (!/theater/i.test(it.categorie ?? '')) {
      andere++;
      continue;
    }
    // Testitems van de site zelf ("TESTING - EUS30", 1 nov 2028, gezien 1 okt 2026).
    if (/^test(ing)?\b/i.test(it.titel)) {
      log(`testitem overgeslagen: "${it.titel}"`);
      continue;
    }
    // Datum/tijd uit het dataLayer-script (dd-mm-jjjj, uu:mm), anders de tekst.
    const m = (it.datumData ?? '').match(/^(\d{2})-(\d{2})-(\d{4})$/);
    const datum = m ? `${m[3]}-${m[2]}-${m[1]}` : it.datumTekst ? parseDay(it.datumTekst) : null;
    if (!datum) {
      log(`kon datum niet lezen: "${it.datumTekst}" (${it.titel}) — overgeslagen.`);
      continue;
    }
    const tijd = extractTime(it.tijdData) ?? extractTime(it.tijdTekst);
    // Hetzelfde item staat soms twee keer op een pagina (uitgelicht en in de lijst).
    const sleutel = `${it.titel}|${datum}|${tijd}`;
    if (gezien.has(sleutel)) {
      dubbel++;
      continue;
    }
    gezien.add(sleutel);

    // Regels vóór de hoofdcategorie ("Theater", "Concerten, Theater", …) zijn
    // een slogan; de regels erna het genre.
    const hoofd = it.regels.findIndex((r) => /\btheater\b/i.test(r) && r.split(',').every((d) => /^(theater|concerten|kids\/jeugd|onze culturele gasten)$/i.test(d.trim())));
    const slogan = hoofd > 0 ? it.regels.slice(0, hoofd).join(' · ') : null;
    const genreRegels = hoofd >= 0 ? it.regels.slice(hoofd + 1) : it.regels;
    const kids = hoofd >= 0 && /kids\/jeugd/i.test(it.regels[hoofd]);
    const genre = normalizeGenreFromList(genreRegels.flatMap((r) => [r, ...r.split(',').map((d) => d.trim())])) ?? (kids ? 'Familie & Jeugd' : null);
    if (!genre && genreRegels.length) zonderGenre[genreRegels.join(', ')] = (zonderGenre[genreRegels.join(', ')] ?? 0) + 1;
    knoppen[it.knop ?? '(geen knop)'] = (knoppen[it.knop ?? '(geen knop)'] ?? 0) + 1;

    const ondertitelIsMaker = it.ondertitel && !isWervend(it.ondertitel);
    // Zalen in het eigen gebouw (Raadhuisplein 3-9: Grote Meer, Kleine Meer,
    // Kleine Pier, Café Duyck) als zaal; een plek elders als locatie.
    const [plek, ...adres] = (it.locatie ?? '').split(/,\s*/);
    const eigenGebouw = /raadhuisplein 3-9/i.test(adres.join(' '));
    const zaal = it.locatie && eigenGebouw ? plek.replace(/^Theater\s*-\s*/i, '').trim() : null;
    const locatie = it.locatie && !eigenGebouw ? `${plek} | ${adres.join(', ')}` : null;
    const show = {
      id: buildId(theater.id, it.titel, datum, tijd),
      titel: it.titel,
      theaterId: theater.id,
      theaterNaam: theater.naam,
      stad: theater.stad,
      podiumpas: theater.podiumpas,
      datum,
      tijd,
      genre: genre ?? (genreRegels.length ? 'Overig' : null),
      genreRuw: genreRegels.join(', ') || null,
      beschikbaarheid: classifyBeschikbaarheid(it.knop),
      beschrijving: slogan ?? (ondertitelIsMaker ? null : it.ondertitel),
      maker: ondertitelIsMaker ? it.ondertitel : null,
      prijs: it.prijs != null ? Number(it.prijs) : null,
      ...(zaal ? { zaal } : {}),
      ...(locatie ? { locatie } : {}),
      reserverenUrl: new URL(it.href, theater.baseUrl).toString(),
      bron: theater.agendaUrl,
      opgehaaldOp,
    };
    // Plus een paar titels waar artiest en voorstelling buiten cabaret omgedraaid staan (OMGEDRAAID).
    shows.push(draaiTitelEnMakerOm(pasTitelConventieToe(show, { artiest: it.titel, voorstelling: it.ondertitel, makerWordtLeeg: true })));
  }

  const lijst = (o) => Object.entries(o).map(([k, n]) => `${k} (${n})`).join(', ');
  log(`${andere} items buiten de categorie Theater overgeslagen (bibliotheek, film, poppodium, …); ${dubbel} dubbel op de pagina`);
  log(`knopteksten: ${lijst(knoppen)}`);
  if (Object.keys(zonderGenre).length) warn(`onbekende brongenres (nu Overig): ${lijst(zonderGenre)}`);
  log(`${zwaar.verzoeken()} verzoek(en) naar de site (plus robots.txt); ${zwaar.geblokkeerd()} afbeeldingen/scripts/fonts niet geladen`);
  return shows;
}
