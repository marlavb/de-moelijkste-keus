import { createIdBuilder } from '../lib/normalize.js';
import { normalizeGenre, isBekendGenre } from '../lib/genre.js';
import { pasTitelConventieToe, metEnDash } from '../lib/titels.js';
import { blokkeerZwareBronnen } from '../lib/zwareBronnen.js';
import { haalXcomPaginas, amsterdamUitUnix, xcomBeschikbaarheid } from '../lib/xcom.js';

// Podiumpas bij Rabo Theater De Meenthe (bron:
// https://www.demeenthe.nl/informatie/podiumpas/, 8 okt 2026): "alle
// reguliere voorstellingen en concerten in het theater", niet uitverkocht.
// Uitgesloten: regionale voorstellingen, voorstellingen in de evenementenhal,
// het Schrijversfestival, Vrijdagavond Vestzakconcerten, producties van
// derden, Passie voor Bach en voorstellingen met een andere korting.
// Herkenbaar in de JSON: genre "Regionaal", zaal "Evenementenhal", en de
// reeksnaam in titel of ondertitel. "Producties van derden" en "andere
// korting" staan niet in de data: die blijven true.
const GEEN_PAS_GENRE = /^regionaal$/i;
const GEEN_PAS_ZAAL = /^evenementenhal$/i;
const GEEN_PAS_REEKS = /vrijdagavond vestzakconcert|schrijversfestival|passie voor bach/i;

// De eigen zalen in het gebouw aan het Stationsplein. Alles daarbuiten
// (Grote Kerk Steenwijk, De Grote Kerk Blokzijl) is een kerkconcert: mee met
// `locatie`; of de Podiumpas daar geldt, is nog niet bekend ("in het
// theater"; zie de melding in config.js).
const EIGEN_ZAAL = /^(eleq theaterzaal|dyka vestzaktheater|evenementenhal|1\.7 intermezzo|de meenthe|foyer)$/i;

// Geen voorstelling: een passe-partout voor een hele serie (de concerten
// staan ook los in de agenda), en evenementen in de hal die geen
// voorstelling zijn (darts, Lego-expo, banenfestival, bierproeverij; 9 okt 2026).
const WEGLATEN = /passe[- ]?partout|hele serie/i;
const WEGLATEN_EVENEMENT = /\b(darts|mega bricks|werkfestival|bierentocht)\b/i;

// Genre "evenement" (Live in de Hal, festivals, feesten): geen reguliere
// voorstelling of concert, dus geen Podiumpas.
const EVENEMENT = /^evenement$/i;

// Een code achter de titel: "Waylon (R)", "DeWolff (T)", "Amilia (AL)". De
// betekenis staat op /informatie/icoontjes/ alleen in een plaatje (9 okt
// 2026); de code hoort niet in de titel (anders geen match met andere
// theaters) en gaat weg.
const TITELCODE = /\s*\((?:[A-Z]{1,2})\)\s*$/;

/**
 * Rabo Theater De Meenthe (Steenwijk). X-com + Itix: /shows.php?showtype=
 * theater&page=N geeft JSON met per speeldatum titel, ondertitel, genre,
 * zaal (`location_title`), Unix-tijd (`itix_from_raw`, UTC) en de Itix-status.
 * ~10 pagina's van 24, dus ~10 verzoeken. Films staan onder een ander
 * showtype en komen hier niet mee.
 */
export async function scrapeMeenthe({ page, theater, robots, waitForTurn, log, warn }) {
  const zwaar = await blokkeerZwareBronnen(page, { ookScripts: true, ookOverig: true });
  const antwoorden = await haalXcomPaginas({ page, theater, robots, waitForTurn, log, warn, query: { showtype: 'theater' } });
  const items = antwoorden.flatMap((a) => a.raw ?? []);
  if (items.length === 0) throw new Error('/shows.php gaf geen voorstellingen — veranderd of geblokkeerd?');
  const shows = verwerkMeenthe(items, { theater, log });
  log(`${zwaar.verzoeken?.() ?? '?'} verzoeken`);
  return shows;
}

/** De JSON-items → voorstellingen (los te testen). */
export function verwerkMeenthe(items, { theater, log = () => {}, opgehaaldOp = new Date().toISOString() }) {
  const buildId = createIdBuilder();
  const shows = [];
  const weg = {};
  const onbekend = {};
  const geenPas = {};
  const statussen = {};
  const codes = {};
  const tel = (o, k) => (o[k] = (o[k] ?? 0) + 1);

  for (const it of items) {
    const ruw = String(it.title ?? '').trim();
    const titel = metEnDash(ruw.replace(TITELCODE, ''));
    if (titel !== metEnDash(ruw)) tel(codes, TITELCODE.exec(ruw)[0].trim());
    const onder = metEnDash(String(it.subtitle ?? '').trim()) || null;
    if (!titel) continue;
    if (WEGLATEN.test(`${titel} ${onder ?? ''}`)) {
      tel(weg, 'passe-partout');
      continue;
    }
    if (EVENEMENT.test(String(it.genre_title ?? '').trim()) && WEGLATEN_EVENEMENT.test(`${titel} ${onder ?? ''}`)) {
      tel(weg, titel);
      continue;
    }
    const tijdstip = amsterdamUitUnix(Number(it.itix_from_raw));
    if (!tijdstip) {
      log(`geen tijdstip voor "${titel}" — overgeslagen.`);
      continue;
    }
    const zaalRuw = String(it.location_title ?? '').trim() || null;
    const eigen = zaalRuw ? EIGEN_ZAAL.test(zaalRuw) : true;
    const genreRuw = String(it.genre_title ?? '').trim() || null;
    if (genreRuw && !isBekendGenre(genreRuw)) tel(onbekend, genreRuw);

    let beschikbaarheid = xcomBeschikbaarheid(it.itix_show_status);
    if (beschikbaarheid === null) {
      tel(statussen, it.itix_show_status);
      beschikbaarheid = 'onbekend';
    }

    let podiumpas = theater.podiumpas;
    const reden =
      (genreRuw && GEEN_PAS_GENRE.test(genreRuw) && 'regionaal') ||
      (zaalRuw && GEEN_PAS_ZAAL.test(zaalRuw) && 'evenementenhal') ||
      (GEEN_PAS_REEKS.test(`${titel} ${onder ?? ''}`) && 'uitgesloten reeks') ||
      (genreRuw && EVENEMENT.test(genreRuw) && 'evenement');
    if (reden) {
      podiumpas = false;
      tel(geenPas, reden);
    }

    const bron = it.url ? new URL(it.url, theater.baseUrl).toString() : theater.agendaUrl;
    let show = {
      id: buildId(theater.id, titel, tijdstip.datum, tijdstip.tijd),
      titel,
      theaterId: theater.id,
      theaterNaam: theater.naam,
      stad: theater.stad,
      podiumpas,
      datum: tijdstip.datum,
      tijd: tijdstip.tijd,
      genre: normalizeGenre(genreRuw),
      genreRuw,
      beschikbaarheid,
      beschrijving: onder,
      maker: null,
      prijs: null,
      ...(eigen ? { zaal: zaalRuw } : { locatie: `${zaalRuw} | ${zaalRuw.match(/blokzijl/i) ? 'Blokzijl' : theater.stad}` }),
      reserverenUrl: bron,
      bron,
      opgehaaldOp,
    };
    // Cabaret: titel = artiest, ondertitel = voorstelling ("Anuar" /
    // "[on]geduldig") → "[on]geduldig – Anuar". Bij andere genres is de
    // volgorde wisselend ("Tocht deur Overiessel" / "Featherhair Creations");
    // daar blijft de ondertitel een omschrijving.
    const metConventie = pasTitelConventieToe(show, { artiest: titel, voorstelling: onder });
    if (metConventie !== show) show = { ...metConventie, beschrijving: null, maker: null };
    shows.push(show);
  }
  const lijst = (o) => Object.entries(o).map(([x, n]) => `${x} (${n})`).join(', ');
  if (Object.keys(weg).length) log(`weggelaten: ${lijst(weg)}`);
  if (Object.keys(geenPas).length) log(`podiumpas false: ${lijst(geenPas)}`);
  if (Object.keys(onbekend).length) log(`onbekende genres: ${lijst(onbekend)}`);
  if (Object.keys(codes).length) log(`titelcode weggehaald: ${lijst(codes)}`);
  if (Object.keys(statussen).length) log(`onbekende Itix-statussen (als "onbekend"): ${lijst(statussen)}`);
  return shows;
}
