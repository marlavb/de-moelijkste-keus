// De mogelijke waarden voor het `beschikbaarheid`-veld in het gedeelde
// schema. Elke theatersite gebruikt eigen knop-teksten/CSS-classes om dit te
// tonen, dus er is geen gedeelde "normalize"-functie zoals bij genre — elke
// scraper classificeert zelf wat de site laat zien, met deze waarden als vast
// contract. "onbekend" is de eerlijke fallback wanneer een site geen duidelijk
// signaal geeft (of iets toont dat niet over voorraad gaat, zoals
// "binnenkort" of "voorstelling afgelopen").
//
// "afgelast" en "verplaatst" (sinds 30 sep 2026): de voorstelling gaat op
// deze datum niet door. Ze blijven in de data (met label, niet boekbaar),
// zodat een plan erop "Afgelast" kan tonen in plaats van "Niet meer in de
// agenda". Alleen op het eigen signaal van het theater (knop, label, class,
// JSON-LD), nooit op tekst in een beschrijving: daar staan ook zinnen als
// "de gecancelde voorstelling van vorig jaar".
import { VERVALLEN } from '../../public/js/weergave.js';

export const BESCHIKBAARHEID_WAARDEN = ['beschikbaar', 'uitverkocht', 'wachtlijst', 'onbekend', ...VERVALLEN];

export { isVervallen } from '../../public/js/weergave.js';

/**
 * Knop- of labeltekst → "afgelast", "verplaatst" of null (geen van beide).
 * Alleen aanroepen op een status-element (knop, label, statusveld).
 */
export function vervallenStatus(tekst) {
  const t = String(tekst ?? '').trim().toLowerCase();
  if (!t) return null;
  if (/verplaatst|postponed|rescheduled/.test(t)) return 'verplaatst';
  if (/geannuleerd|afgelast|gecancel?d|cancel?led|gaat niet door/.test(t)) return 'afgelast';
  return null;
}
