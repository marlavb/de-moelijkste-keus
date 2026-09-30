// Titelconventie voor cabaretiers (sep 2026): titel = "Voorstelling – Artiest"
// als de bron beide geeft, zodat dezelfde voorstelling bij elk theater
// dezelfde titel (en dus dezelfde watchlist-sleutel) krijgt. Voorbeeld: Carré
// had "Sara Kroos - Prikkelarme kermis", DeLaMar alleen "Sara Kroos" (met de
// voorstelling in de beschrijving), De Stoep "Sara Kroos" met de voorstelling
// in het makerveld.
//
// Alleen voor cabaret, kleinkunst en comedy: bij toneel en dans is de tweede
// regel meestal het gezelschap, niet de voorstelling. Elk theater geeft aan
// waar artiest en voorstelling in zijn bron staan; deze helper voegt ze samen.
//
// Tot 30 sep 2026 was de volgorde "Artiest – Voorstelling". De watchlist-
// sleutel is volgorde-onafhankelijk (NORMALISATIE_VERSIE 3), dus sleutels,
// bladwijzers en plannen veranderden daardoor niet.

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
 * `alleGenres`: ook buiten cabaret, voor een theater waar de bron artiest en
 * voorstelling bij elk genre eenduidig scheidt (Griffioen, 30 sep 2026).
 * Geeft een (eventueel) aangepaste kopie terug; verder niets veranderd.
 */
export function pasTitelConventieToe(show, { artiest, voorstelling, makerWordtLeeg = false, alleGenres = false }) {
  if (!alleGenres && !isCabaret(show)) return show;
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
  if (kv.startsWith(`${ka} `)) return { ...show, titel: v, maker: makerWordtLeeg ? null : show.maker };
  // volgordeZeker: deze titel is hier samengesteld als "Voorstelling –
  // Artiest"; telt als stem bij de weergave op meerderheid (weergaveMeerderheid.js).
  return { ...show, titel: `${v}${SCHEIDER}${a}`, maker: makerWordtLeeg ? null : show.maker, volgordeZeker: true };
}

/**
 * Eén scheidingsteken overal: een streepje met spaties eromheen (" - ") wordt
 * een en-dash (" – "). Streepjes in een woord ("Try-(H)outen") blijven. De
 * watchlist-sleutel en de ontdubbeling zien beide als hetzelfde.
 */
export function metEnDash(tekst) {
  return typeof tekst === 'string' ? tekst.replace(/\s+-\s+/g, ' – ') : tekst;
}

const STATUSWOORD = '(?:geannuleerd|afgelast|verplaatst)';
// Scheidingstekens: streepje, en-dash of "|" (Koningshof: "Geannuleerd | O'DREAMS").
const STATUS_DEEL = new RegExp(`(?:\\s+[-–|]\\s+${STATUSWOORD}(?=\\s+[-–|]\\s+|$)|^${STATUSWOORD}\\s+[-–|]\\s+|\\s*\\(${STATUSWOORD}\\))`, 'gi');

/**
 * Een statuswoord als los titeldeel ("Gelukkig maar - geannuleerd",
 * "… (afgelast)") weghalen: dat staat voortaan in het label, en zo krijgt de
 * voorstelling dezelfde watchlist-sleutel als de gewone speeldata. Alleen
 * voor voorstellingen die het theater zelf als afgelast/verplaatst markeert
 * (zie scrapeRun.js). Woorden midden in een titel blijven staan.
 */
export function zonderStatusWoord(tekst) {
  if (typeof tekst !== 'string') return tekst;
  const kaal = tekst.replace(STATUS_DEEL, '').trim();
  return kaal || tekst;
}
