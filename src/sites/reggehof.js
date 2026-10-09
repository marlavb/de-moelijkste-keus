import { createIdBuilder } from '../lib/normalize.js';
import { normalizeGenre } from '../lib/genre.js';
import { pasTitelConventieToe, metEnDash, labelUitTitel } from '../lib/titels.js';
import { blokkeerZwareBronnen } from '../lib/zwareBronnen.js';
import { haalXcomPaginas, leesXcomArtikelen, xcomBeschikbaarheid, xcomToonStatus } from '../lib/xcom.js';

// De genrefilters van de site zelf (data-genre op /programma, 9 okt 2026).
// "huisgemaakt", "regio" en "special" zijn geen genre maar herkomst of soort:
// een speeldatum die ook onder cabaret/familie/muziek staat, krijgt dat genre.
export const GENRE_FILTERS = ['cabaret', 'familie', 'muziek', 'special', 'huisgemaakt', 'regio'];

// Geen voorstelling (inventarisatie 8 okt 2026): een sportgala van de
// gemeente en informatieavonden met gratis entree.
const WEGLATEN = /\bsportgala\b|^de kunst van leven tot het laatst$/i;

const GENREWOORD = /^(cabaret|muziek|toneel|theater|familie|special)$/i;

// "(zitten)" / "(staan)": één speeldatum met twee soorten kaarten.
const KAARTSOORT = /\s*\((zitten|staan)\)\s*$/i;

/**
 * De Reggehof (Goor). X-com + Itix: /shows.php?type=theatre&page=N geeft
 * JSON met HTML-blokken (2 pagina's, ~40 speeldata); genre via de
 * genrefilters van de site (~6 verzoeken). De status "uitverkocht" staat niet
 * in de lijst: de site haalt die apart op bij Itix
 * (itix.reggehof.nl/framework/public/ajax/site/show.php?action=getStatus),
 * maar de robots.txt van itix.reggehof.nl verbiedt dat pad (9 okt 2026). Dus
 * geen uitverkocht-status: "beschikbaar" betekent hier "te bestellen", tenzij
 * de lijst zelf iets anders zegt.
 */
export async function scrapeReggehof({ page, theater, robots, waitForTurn, log, warn }) {
  const zwaar = await blokkeerZwareBronnen(page, { ookScripts: true, ookOverig: true });
  const query = { genres: '', dates: '', type: 'theatre' };
  const antwoorden = await haalXcomPaginas({ page, theater, robots, waitForTurn, log, warn, query });
  const artikelen = [];
  for (const a of antwoorden) artikelen.push(...(await page.evaluate(leesXcomArtikelen, a.html ?? '')));
  if (artikelen.length === 0) throw new Error('/shows.php gaf geen voorstellingen — veranderd of geblokkeerd?');
  const totaal = antwoorden[0]?.countItemsTotal;
  if (typeof totaal === 'number' && artikelen.length < totaal) warn(`${artikelen.length} van ${totaal} speeldata gelezen.`);

  const genres = new Map();
  for (const filter of GENRE_FILTERS) {
    const deel = await haalXcomPaginas({ page, theater, robots, waitForTurn, log: () => {}, warn, query: { ...query, genres: filter } });
    for (const a of deel) {
      for (const art of await page.evaluate(leesXcomArtikelen, a.html ?? '')) {
        if (!genres.has(String(art.showid))) genres.set(String(art.showid), filter);
      }
    }
  }

  const shows = verwerkReggehof(artikelen, { theater, genres, log });
  log(`${zwaar.verzoeken()} verzoeken`);
  return shows;
}

/** De artikelen → voorstellingen (los te testen). */
export function verwerkReggehof(artikelen, { theater, genres = new Map(), log = () => {}, opgehaaldOp = new Date().toISOString() }) {
  const buildId = createIdBuilder();
  const perMoment = new Map();
  const weg = {};
  const statussen = {};
  const tel = (o, k) => (o[k] = (o[k] ?? 0) + 1);

  for (const a of artikelen) {
    const kaartsoort = KAARTSOORT.exec(a.titel ?? '')?.[1]?.toLowerCase() ?? null;
    const labTitel = labelUitTitel(metEnDash((a.titel ?? '').replace(KAARTSOORT, '').trim()));
    const labOnder = labelUitTitel(metEnDash(a.ondertitel?.trim() ?? '') || null);
    const titel = labTitel.tekst;
    const onder = labOnder.tekst;
    const label = labTitel.label ?? labOnder.label;
    const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(a.start ?? '');
    if (!titel || !m) continue;
    if (WEGLATEN.test(titel) || WEGLATEN.test(onder ?? '')) {
      tel(weg, titel);
      continue;
    }
    const [, datum, tijd] = m;
    const toon = xcomToonStatus(a.status, a.webstatus || '', null);
    let beschikbaarheid = xcomBeschikbaarheid(toon);
    if (beschikbaarheid === null) {
      tel(statussen, toon);
      beschikbaarheid = 'onbekend';
    }
    const genreRuw = genres.get(String(a.showid)) ?? null;
    const genre = normalizeGenre(genreRuw);
    const prijs = /(\d+)[,.](\d{2})/.exec(a.prijs ?? '');
    const bron = a.href ? new URL(a.href, theater.baseUrl).toString() : theater.agendaUrl;
    let show = {
      id: null,
      titel,
      theaterId: theater.id,
      theaterNaam: theater.naam,
      stad: theater.stad,
      podiumpas: theater.podiumpas,
      datum,
      tijd,
      genre,
      genreRuw,
      beschikbaarheid,
      beschrijving: onder,
      maker: null,
      prijs: prijs ? Number(`${prijs[1]}.${prijs[2]}`) || null : null,
      reserverenUrl: a.showid ? new URL(`/bestel/${a.showid}`, theater.baseUrl).toString() : bron,
      bron,
      opgehaaldOp,
    };
    // Titel = artiest, ondertitel = voorstelling ("Rayen Panday" / "Grip"):
    // bij cabaret "Grip – Rayen Panday" (titels.js). Andere genres blijven
    // zoals ze zijn, met de ondertitel als omschrijving.
    // Niet als de ondertitel een genrewoord is ("Nationaal Theaterweekend" /
    // "Cabaret").
    const metConventie = GENREWOORD.test(onder ?? '') ? show : pasTitelConventieToe(show, { artiest: titel, voorstelling: onder });
    if (metConventie !== show) show = { ...metConventie, beschrijving: null, maker: null };
    if (label) show = { ...show, beschrijving: [label, show.beschrijving].filter(Boolean).join(' · ') };

    // Zitten en staan op hetzelfde moment: één voorstelling; de laagste prijs,
    // en beschikbaar als een van beide nog kaarten heeft.
    const sleutel = `${show.titel}|${datum}|${tijd}`;
    const eerder = perMoment.get(sleutel);
    if (eerder && kaartsoort) {
      if (show.prijs != null && (eerder.prijs == null || show.prijs < eerder.prijs)) eerder.prijs = show.prijs;
      if (eerder.beschikbaarheid !== 'beschikbaar' && show.beschikbaarheid === 'beschikbaar') eerder.beschikbaarheid = 'beschikbaar';
      tel(weg, 'zitten/staan samengevoegd');
      continue;
    }
    perMoment.set(sleutel, show);
  }
  const shows = [...perMoment.values()].map((s) => ({ ...s, id: buildId(theater.id, s.titel, s.datum, s.tijd) }));
  const lijst = (o) => Object.entries(o).map(([x, n]) => `${x} (${n})`).join(', ');
  if (Object.keys(weg).length) log(`weggelaten: ${lijst(weg)}`);
  if (Object.keys(statussen).length) log(`onbekende statussen (als "onbekend"): ${lijst(statussen)}`);
  return shows;
}
