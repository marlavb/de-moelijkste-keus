// Gedeelde stukken voor sites met de WordPress-plugin "Theater for WordPress"
// (DOK6, Kattendans, Paradox). DOK6 en Kattendans gebruiken de standaardopmaak
// van de plugin (div.wp_theatre_event met .wp_theatre_event_title enz.);
// Paradox heeft een eigen thema op dezelfde plugin en leest zelf, maar deelt
// de statusklassificatie en de prijs.

import { vervallenStatus } from './beschikbaarheid.js';

/**
 * Leest alle speeldata uit de standaardopmaak (draait in de browser). Elk
 * item: klassen van het blok (genre-…, tag-…), titel, ondertitel, link,
 * categorieën, datum- en tijdtekst, ticketknop (tekst, class, url) en prijs.
 */
export async function leesStandaardEvents(page) {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('div.wp_theatre_event')).map((el) => {
      const tekst = (sel) => el.querySelector(sel)?.textContent.replace(/\s+/g, ' ').trim() || null;
      const knop = el.querySelector('.wp_theatre_event_tickets_url');
      return {
        klassen: el.className,
        titel: tekst('.wp_theatre_event_title'),
        ondertitel: tekst('.wp_theatre_event_subtitle'),
        href: el.querySelector('.wp_theatre_event_title a')?.getAttribute('href') ?? null,
        categorieen: Array.from(el.querySelectorAll('.wpt_production_category')).map((li) => li.textContent.trim()),
        datum: tekst('.startdate_date'),
        tijd: tekst('.wp_theatre_event_starttime') ?? tekst('.startdate_time'),
        knopTekst: knop?.textContent.trim() ?? tekst('.wp_theatre_event_tickets'),
        knopKlasse: knop?.className ?? null,
        ticketUrl: knop?.getAttribute('href') ?? null,
        prijs: tekst('.wp_theatre_event_prices'),
      };
    })
  );
}

/**
 * Tekst en class van de ticketknop: "TICKETS", "laatste tickets"
 * (laatstekaarten) = beschikbaar, "Wachtlijst" (waitinglist), "Uitverkocht"
 * (soldout). Afgelast/verplaatst uit hetzelfde signaal.
 */
export function classifyWpBeschikbaarheid(tekst, klasse) {
  const vervallen = vervallenStatus(tekst);
  if (vervallen) return vervallen;
  const t = `${tekst ?? ''} ${klasse ?? ''}`.toLowerCase();
  if (t.includes('uitverkocht') || t.includes('soldout') || t.includes('sold-out')) return 'uitverkocht';
  if (t.includes('wachtlijst') || t.includes('waitinglist')) return 'wachtlijst';
  if (t.includes('ticket') || t.includes('laatstekaarten') || t.includes('bestel')) return 'beschikbaar';
  return 'onbekend';
}

/** "€ 27,50" / "€20,00" → 27.5; geen bedrag → null. */
export function prijsUitTekst(tekst) {
  const m = String(tekst ?? '').match(/(\d+)(?:[,.](\d{2}))?/);
  return m ? Number(`${m[1]}.${m[2] ?? '00'}`) : null;
}
