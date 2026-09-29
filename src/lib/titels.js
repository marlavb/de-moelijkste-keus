// Titelconventie voor cabaretiers (sep 2026): titel = "Artiest – Voorstelling"
// als de bron beide geeft, zodat dezelfde voorstelling bij elk theater
// dezelfde titel (en dus dezelfde watchlist-sleutel) krijgt. Voorbeeld: Carré
// had "Sara Kroos - Prikkelarme kermis", DeLaMar alleen "Sara Kroos" (met de
// voorstelling in de beschrijving), De Stoep "Sara Kroos" met de voorstelling
// in het makerveld.
//
// Alleen voor cabaret, kleinkunst en comedy: bij toneel en dans is de tweede
// regel meestal het gezelschap, niet de voorstelling. Elk theater geeft aan
// waar artiest en voorstelling in zijn bron staan; deze helper voegt ze samen.

export const SCHEIDER = ' – ';

const CABARET = /cabaret|kleinkunst|comedy|stand-?up|humor/i;

export function isCabaret(show) {
  return CABARET.test(`${show.genre ?? ''} ${show.genreRuw ?? ''}`);
}

/**
 * Een wervende zin in plaats van een naam ("met o.a. Yora Rienstra", "De blik
 * op 2026 door de ogen van vrouwen!"): die hoort niet in de titel.
 */
export function isWervend(tekst) {
  const t = String(tekst ?? '').trim();
  if (t.length > 60) return true;
  if (/^met\s/i.test(t) || /\bo\.a\./i.test(t)) return true;
  if (/\b(door de ogen|gepresenteerd door|presenteert)\b/i.test(t)) return true;
  // Een hele zin: eindigt op een leesteken en is lang.
  if (/[.!?]$/.test(t) && t.split(/\s+/).length >= 6) return true;
  return false;
}

const kaal = (t) =>
  String(t ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

/**
 * Past de conventie toe op één voorstelling. `artiest` en `voorstelling`
 * komen uit de velden die het theater daarvoor gebruikt; `makerWordtLeeg`:
 * het makerveld bevatte een van beide en zou anders dubbel staan.
 * Geeft een (eventueel) aangepaste kopie terug; verder niets veranderd.
 */
export function pasTitelConventieToe(show, { artiest, voorstelling, makerWordtLeeg = false }) {
  if (!isCabaret(show)) return show;
  const a = String(artiest ?? '').trim();
  const ruw = String(voorstelling ?? '').trim();
  if (!a || !ruw) return show;
  // De wervende-zin-regel kijkt naar de oorspronkelijke tekst (ook naar een
  // slotpunt); pas daarna een losse punt aan het eind weghalen ("Kintsugi." →
  // "Kintsugi"). "…", "?" en "!" blijven staan.
  if (isWervend(a) || isWervend(ruw)) return show;
  const v = ruw.replace(/(?<!\.)\.$/, '');
  if (!v) return show;
  const ka = kaal(a);
  const kv = kaal(v);
  if (ka === kv) return { ...show, titel: a, maker: makerWordtLeeg ? null : show.maker };
  // Staat de artiest al vooraan in de voorstellingsnaam, dan niet dubbel.
  const titel = kv.startsWith(`${ka} `) ? v : `${a}${SCHEIDER}${v}`;
  return { ...show, titel, maker: makerWordtLeeg ? null : show.maker };
}
