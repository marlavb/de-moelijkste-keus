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

// Nooit maker (okt 2026, bij alle theaters): een content warning, "Met o.a.
// …", een leeftijdsaanduiding of een duidelijke ondertitel ("Grand Finale",
// "Live in het theater", "reprise", "try-out", "première"). Die horen in de
// beschrijving. Alleen als de hele tekst zo is: "Live in Theater (reprise)"
// (ICE) is een voorstellingsnaam.
const GEEN_MAKER = [
  /^(content warning|⚠)/i,
  // Ook "Met: Daisy Edgar-Jones, …" (filmcast, Aan de Slinger).
  /^met[\s:]/i,
  /^\(?\s*\d{1,2}(?:[,.]\d)?\s*\+\s*\)?$/,
  /^\(?\s*\d{1,2}(?:[,.]\d)?\s*(?:tot|t\/m|-|–)\s*\d{1,2}(?:[,.]\d)?(?:\s*jaar)?\s*\)?$/i,
  /^vanaf \d{1,2} jaar$/i,
  /^\(?\s*(?:reprise|try[- ]?out|premi[eè]re|grand finale|live in (?:het )?theater)\s*\)?$/i,
  // Een jubileum-ondertitel ("20 jaar 3JS", Flint; "20 jaar onmeunig druk",
  // Miss Montreal), okt 2026. Ook alleen "40 jaar" (Munttheater geeft dat als
  // performer bij "Loïs Lane in concert"; DOK6, Markant e.a. bij Pater
  // Moeskroen) en "40 jarig jubileum tour" (Parade), 8 okt 2026.
  /^\d+\s+(?:jaar|jarig)(?:\s|$)/i,
  // Algemene ondertitels zonder naam: "In Concert" (Flint, Meervaart),
  // "Theaterconcert", "Theatertour" (okt 2026).
  /^(?:in concert|(?:theater)?concert|(?:theater)?tour|live)$/i,
];

// Uitzonderingen op de nooit-maker-lijst: bij deze artiest is de tekst de
// naam van de voorstelling, geen ondertitel. ICE: "Live in Theater"
// (Schouwburg Concertzaal: kop "ICE", ondertitel "Live in Theater"; elders
// "Live in Theater (reprise) – ICE"). Was vóór 10581df "Live in Theater –
// ICE", daarna titel "Live in Theater" met maker "ICE" (7 okt 2026).
export const VOORSTELLINGSNAAM_BIJ_ARTIEST = {
  ice: [/^live in (?:het )?theater$/i],
};

/** Is `tekst` bij deze artiest de voorstellingsnaam (uitzondering op isGeenMaker)? */
export function isVoorstellingsnaam(artiest, tekst) {
  const regels = VOORSTELLINGSNAAM_BIJ_ARTIEST[kaal(artiest)] ?? [];
  return regels.some((re) => re.test(String(tekst ?? '').trim()));
}

export function isGeenMaker(tekst) {
  const t = String(tekst ?? '').trim();
  return Boolean(t) && GEEN_MAKER.some((re) => re.test(t));
}

// Slogan of cast in het makerveld (titels-ronde-1, R1, 9 okt 2026): "Slijm is
// terug!", "De enige echte officiële Queen musical!", "Aladdin de Musical",
// "Mark Rietman e.a.", "Soy Kroon als Frans Halsema", "Hilke Bierman, Jeannine
// La Rose, Nicole Berendsen", "’s Werelds beroemdste detective in een nieuw
// moordmysterie". Alleen voor het makerveld (scrapeRun): niet in
// GEEN_MAKER, want een ondertitel met "!" is in een cabarettitel vaak de
// voorstellingsnaam ("Hoe dan! – Steven Kazàn", pasTitelConventieToe).
// Bewust níet (gecontroleerd op alle makers van 9 okt 2026):
// - "!" in één woord ("LUDIQUE!", "Romani!", "DJANGAN!") of na een
//   gezelschapswoord ("Ensemble Gamut!"), en "!" tussen haakjes ("Bart
//   Krieger (Kunst Toko BAM!)");
// - "Musical" in een naam ("Nationaal Jeugd Musical Theater", "Stichting
//   Musical Stella Duce", "Scherzi Musicali");
// - "als" met hoofdletter ("Theater Als Het Ware"); "en" zonder komma's
//   ("Van Vleuten en Van Muiswinkel");
// - komma's tussen haakjes ("Chapter 58 (Antti Uimonen, Flore Muuse, …)"),
//   met "/" ("Iduna Paalman, Zephyr Brüggen / Bellevue Producties, Het
//   Nationale Theater") of tussen gezelschappen ("Holland Opera, Duda Paiva
//   Company, New European Ensemble"; "NITE, Club Guy & Roni, Het Muziek,
//   HIIIT"); "!" naast een gezelschapsnaam ("Theater Rotterdam, ZO! Gospel
//   Choir, Glen Faria & Priscilla Vaudelle").
const GEZELSCHAP = /\b(ensemble|trio|kwartet|quartet|kwintet|quintet|band|orkest|orchestra|koor|choir|collectief|company|compagnie|opera|theater|producties|gezelschap|toneelgroep)\b/i;
// Met hoofdletter, als naam: "Theater Rotterdam, ZO! Gospel Choir" blijft,
// "Jij HOORT in het theater!" niet.
const GEZELSCHAP_NAAM = /\b(Ensemble|Trio|Kwartet|Quartet|Kwintet|Quintet|Band|Orkest|Orchestra|Koor|Choir|Collectief|Company|Compagnie|Opera|Theater|Producties|Gezelschap|Toneelgroep|Chœur|Choeur)\b/;
// Een deel dat een gezelschap is: met gezelschapswoord of een afkorting
// ("NITE, Club Guy & Roni, Het Muziek, HIIIT").
const isGezelschapsdeel = (d) => GEZELSCHAP.test(d) || /^[A-Z]{3,}$/.test(d.trim());
// Woorden die in een naam met een kleine letter mogen ("Pieter Hulst en
// Willem de Voogd", "Anke van 't Hof").
const NAAMWOORD = new Set(['van', 'de', 'der', 'den', 'het', 'ten', 'ter', 'te', 'du', 'la', 'le', 'da', 'di', 'von', 'el', 'en', 'y', 'dos', 'das', 'do', 'e', 'des', 'del', 'of', 'and', 'the', 'und', 'met', 'o.l.v.', 'i.s.m.', 'feat.', 'ft.', 'x', 'vs', 'vs.', 'by', 'door', 'with', 'plus', 'zu', 'al', 'bin', 'ibn', "'t", '’t']);

/** Welke R1-regel raakt: 'officieel', 'musical', 'cast', 'uitroep', 'zin' of null. */
export function sloganSoort(tekst) {
  const t = String(tekst ?? '').trim();
  if (!t) return null;
  const buitenHaakjes = t.replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
  if (/\boffici[eë]le\b/i.test(t)) return 'officieel';
  if (/\p{L}-?musical(?!\p{L})/iu.test(t) || /\bmusical\s*!?$/i.test(buitenHaakjes) || /^(?:een|de|het)\s.*\bmusical\b/i.test(t)) return 'musical';
  if (/(?:^|\s)e\.\s?a\.?(?:\s|$)/i.test(t)) return 'cast';
  if (/\sals\s+\p{Lu}/u.test(t)) return 'cast';
  if (/!/.test(buitenHaakjes) && buitenHaakjes.split(' ').length >= 2 && !GEZELSCHAP_NAAM.test(buitenHaakjes)) return 'uitroep';
  const delen = buitenHaakjes.split(',');
  if (delen.length >= 3 && !t.includes('/') && delen.filter(isGezelschapsdeel).length < 2) return 'cast';
  // Een zin: vijf woorden of meer, waarvan drie met een kleine letter die in
  // een naam niet voorkomen ("’s Werelds beroemdste detective in een nieuw
  // moordmysterie", "Ik heb je lief, drie generaties lang"). Zonder deze
  // regel won zo'n slogan na het weghalen van de cast de makermeerderheid.
  const woorden = buitenHaakjes.split(' ');
  const klein = woorden.filter((w) => /^\p{Ll}/u.test(w) && !NAAMWOORD.has(w.toLowerCase()));
  if (woorden.length >= 5 && klein.length >= 3 && !GEZELSCHAP_NAAM.test(buitenHaakjes)) return 'zin';
  return null;
}

export function isSloganOfCast(tekst) {
  return sloganSoort(tekst) !== null;
}

// Titel en maker omgedraaid bij de bron (okt 2026): de artiest staat als
// titel en de voorstelling als ondertitel/maker, buiten cabaret (waar
// pasTitelConventieToe dat al oplost). Per theater, per letterlijke
// brontitel: bij deze theaters is de volgorde per genre niet vast (Flint:
// "Sherlock Holmes" / "Mark Rietman" naast "Nhung Dam" / "Legende van de
// witte slang"), dus een genreregel zou goede titels omdraaien. Gecontroleerd
// tegen de theaters met de goede volgorde (6 okt 2026):
// - "Nhung Dam" / "Legende van de witte slang": Aan de Slinger, Koningshof
//   en De Maaspoort hebben titel "Legende van de witte slang", maker "Nhung Dam".
// - "Alain Clark" / "Date Night": Omval heeft titel "Date Night", maker
//   "Alain Clark"; Griffioen "Date Night – Alain Clark".
export const OMGEDRAAID = {
  cpunt: ['Nhung Dam'],
  stoep: ['Alain Clark'],
  maaspoort: ['Alain Clark'],
  // Markant (nieuw in de nachtrun van 7 okt 2026): zelfde fout.
  markant: ['Alain Clark'],
  // "Bijna een leven" van Toneelgroep Maastricht (en Stichting NOX): Flint en
  // Het Speelhuis zetten het gezelschap als titel en de voorstelling als
  // ondertitel; Bellevue, De Meervaart, Aan de Slinger, Theater aan het Spui
  // en De Maaspoort hebben titel "Bijna een leven" (7 okt 2026).
  flint: ['Nhung Dam', 'Toneelgroep Maastricht – Stichting NOX'],
  speelhuis: ['Toneelgroep Maastricht'],
};

// Alleen de artiest als titel, de voorstelling niet in titel of makerveld
// (wel op de detailpagina of als ondertitel in de agenda): titel wordt de
// voorstelling, maker de artiest. Per theater, letterlijke brontitel, alleen
// speeldata t/m `tot` (een latere tournee kan anders heten).
// - Alain Clark, "Date Night" (tournee okt 2026): Kunstlinie (detailpagina
//   kunstlinie.nl/programma/alain-clark/: "Alain Clark – Date Night",
//   bekeken 6 okt 2026) en Stadsgehoorzaal (agenda: "Alain Clark" met
//   ondertitel "Date Night", 30 sep 2026).
// - ICE, "Live in Theater" (okt 2026): het Munttheater geeft alleen "ICE"
//   (genre Show, beschrijving "Live in theater"); vijf andere theaters
//   "Live in Theater – ICE" (Schouwburg Concertzaal, Markant, PLT, …;
//   nachtrun 8 okt 2026). De Munttheater-scraper zet daarna "Voorstelling –
//   Artiest", zodat het één productie wordt.
export const VOORSTELLING_BIJ_ARTIEST = {
  munttheater: { ICE: { voorstelling: 'Live in Theater', tot: '2027-07-31' } },
  kunstlinie: { 'Alain Clark': { voorstelling: 'Date Night', tot: '2026-12-31' } },
  stadsgehoorzaal: { 'Alain Clark': { voorstelling: 'Date Night', tot: '2026-12-31' } },
};

/**
 * Zet titel en maker recht: omdraaien als dit theater de titel op
 * OMGEDRAAID heeft (en er een maker is), of de voorstelling erbij uit
 * VOORSTELLING_BIJ_ARTIEST. Idempotent.
 */
export function draaiTitelEnMakerOm(show, lijst = OMGEDRAAID, bijArtiest = VOORSTELLING_BIJ_ARTIEST) {
  const titel = String(show?.titel ?? '').trim();
  const extra = bijArtiest[show?.theaterId]?.[titel];
  if (extra && (!show.datum || show.datum <= extra.tot)) return { ...show, titel: extra.voorstelling, maker: titel };
  const titels = lijst[show?.theaterId];
  const maker = typeof show?.maker === 'string' ? show.maker.trim() : '';
  // Streepje, en-dash of "|" maken niet uit: Flint geeft "Toneelgroep
  // Maastricht - Stichting NOX", de lijst heeft de en-dash (8 okt 2026: de
  // regel werkte daardoor niet in de nachtrun).
  if (!titels || !maker || !titels.some((t) => metEnDash(t) === metEnDash(titel))) return show;
  return { ...show, titel: maker, maker: titel };
}

/** "door Oortwolk" → "Oortwolk", "o.l.v. Tijn Trommelen" → "Tijn Trommelen". */
export function makerZonderVoorvoegsel(tekst) {
  if (typeof tekst !== 'string') return tekst;
  return tekst.replace(/^(?:door|o\.l\.v\.)\s+/i, '').trim() || tekst;
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
  if (isWervend(a) || isWervend(ruw) || isGeenMaker(a) || (isGeenMaker(ruw) && !isVoorstellingsnaam(a, ruw))) return show;
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

const LABEL_ACHTERAAN = /\s*\(\s*((?:voor)?premi[eè]re|try[- ]?out|reprise)\s*\)\s*$/i;

/**
 * Een label tussen haakjes achter de titel ("Imperfect (try-out)",
 * "Tot het uiterste gedreven (voorpremière)", "Muiters (reprise)") hoort in
 * de beschrijving, niet in de titel: anders matcht de voorstelling niet met
 * andere theaters en speeldata (okt 2026, Overijssel). Geeft { tekst, label }.
 */
export function labelUitTitel(tekst) {
  if (typeof tekst !== 'string') return { tekst, label: null };
  const m = LABEL_ACHTERAAN.exec(tekst);
  if (!m) return { tekst, label: null };
  const kaal = tekst.slice(0, m.index).trim();
  return kaal ? { tekst: kaal, label: m[1] } : { tekst, label: null };
}

const LABEL_OVERAL = /\s*\(\s*((?:voor)?premi[eè]re|try[- ]?out|reprise)\s*\)/gi;

/**
 * Reeksnaam vooraan de titel ("Herfststukjes: Het Koffertje 4+" → titel "Het
 * Koffertje 4+", reeks "Herfststukjes"), voor de reeksen die een theater in
 * config.js als `reeksVoorvoegsels` heeft (titels-ronde-1, R4, 9 okt 2026).
 * Alleen met dubbele punt en als er daarna nog iets staat. Geeft { tekst,
 * reeks } (reeks null als er niets weg is).
 */
export function reeksUitTitel(tekst, voorvoegsels = []) {
  const t = String(tekst ?? '');
  for (const v of voorvoegsels ?? []) {
    const re = new RegExp(`^\\s*(${v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})\\s*:\\s*(\\S.*)$`, 'i');
    const m = t.match(re);
    if (m) return { tekst: m[2].trim(), reeks: m[1] };
  }
  return { tekst: t, reeks: null };
}

/**
 * Alle labels "(try-out)", "(try out)", "(reprise)", "(première)",
 * "(voorpremière)" uit een titel, waar ze ook staan ("Rhobijn (reprise) –
 * Rowwen Hèze" → "Rhobijn – Rowwen Hèze"; "Vanzelfsprekend (try-out) & Sint
 * Juttemis (try-out) – …" → beide weg). Centraal in de run toegepast op alle
 * theaters (okt 2026). Blijft er niets over, dan de oorspronkelijke tekst.
 * Geeft { tekst, labels } (kleine letters, in volgorde, zonder dubbele).
 */
export function labelsUitTitel(tekst) {
  if (typeof tekst !== 'string') return { tekst, labels: [] };
  const labels = [];
  const kaal = tekst
    .replace(LABEL_OVERAL, (_, label) => {
      const l = label.toLowerCase();
      if (!labels.includes(l)) labels.push(l);
      return '';
    })
    .replace(/\s{2,}/g, ' ')
    .trim();
  return kaal ? { tekst: kaal, labels } : { tekst, labels: [] };
}

/**
 * Eén scheidingsteken overal: een streepje of een verticale streep met
 * spaties eromheen (" - ", " | ") wordt een en-dash (" – "), bv.
 * "Oudejaarsconference 2026 | Try-out" (De Maaspoort) → "… – Try-out".
 * Streepjes in een woord ("Try-(H)outen") en "|" zonder spaties blijven. De
 * watchlist-sleutel, de planning en de ontdubbeling zien beide als hetzelfde.
 */
export function metEnDash(tekst) {
  return typeof tekst === 'string' ? tekst.replace(/\s+[-|]\s+/g, ' – ') : tekst;
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

// Statuswoorden over de kaartverkoop als los titeldeel (titels-ronde-1, R5,
// 9 okt 2026): "Gelukkig heb je mij nog – Richard Groenendijk – UITVERKOCHT"
// (Stadsgehoorzaal). Alleen als los deel naast een echte titel: "Laatste
// Kaarten" van Collectief BLAUWDRUK (KS, Concertzaal, Musis) is de naam van
// de voorstelling en blijft staan.
const VERKOOPSTATUS = [
  [/^(?:uitverkocht|sold[ -]?out)$/i, 'uitverkocht'],
  [/^(?:laatste (?:kaarten|plaatsen|tickets)|bijna uitverkocht|nog enkele kaarten)$/i, 'beschikbaar'],
  [/^wachtlijst$/i, 'wachtlijst'],
  [/^(?:geannuleerd|afgelast|gecancel?d|cancel?led)$/i, 'afgelast'],
  [/^verplaatst$/i, 'verplaatst'],
];
const verkoopstatus = (deel) => VERKOOPSTATUS.find(([re]) => re.test(deel.replace(/[.!…]+$/, '').trim()))?.[1] ?? null;

/**
 * Een statusdeel uit de titel: als laatste of eerste deel (" – ", " - ", " | ")
 * of tussen haakjes aan het eind. Geeft { tekst, status } (status null als er
 * niets weg is). Blijft er geen titel over, dan niets.
 */
export function statusUitTitel(tekst) {
  const t = String(tekst ?? '');
  const haakjes = t.match(/^(.*\S)\s*\(([^()]+)\)$/);
  if (haakjes && verkoopstatus(haakjes[2])) return { tekst: haakjes[1].trim(), status: verkoopstatus(haakjes[2]) };
  const delen = t.split(/\s+[-–|]\s+/);
  if (delen.length < 2) return { tekst: t, status: null };
  const laatste = verkoopstatus(delen.at(-1));
  if (laatste) return { tekst: delen.slice(0, -1).join(SCHEIDER), status: laatste };
  const eerste = verkoopstatus(delen[0]);
  if (eerste) return { tekst: delen.slice(1).join(SCHEIDER), status: eerste };
  return { tekst: t, status: null };
}

/**
 * Titel en maker uit twee regels van de bron ("kop" en "ondertitel"), als de
 * HTML-structuur van een theater (per genre) een vaste volgorde heeft:
 * - 'maker-titel': kop = maker, ondertitel = voorstelling → "Voorstelling –
 *   Maker" (ook buiten cabaret, zoals bij Griffioen);
 * - 'titel-maker': kop = voorstelling, ondertitel = maker;
 * - 'titel-beschrijving': ondertitel is een omschrijving of reeksnaam.
 * Altijd eerst: een ondertitel die nooit maker is (isGeenMaker) of een
 * wervende zin gaat naar de beschrijving; "door X", "by X" en "o.l.v. X"
 * wordt maker X. Geeft null zonder vaste volgorde (dan beslist de scraper
 * zoals voorheen).
 */
export function titelUitKopEnOndertitel(show, { kop, ondertitel, volgorde }) {
  const sub = String(ondertitel ?? '').trim() || null;
  const basis = { ...show, titel: kop, maker: null };
  const alsBeschrijving = () => ({ ...basis, beschrijving: show.beschrijving ?? sub });
  if (!sub) return volgorde ? basis : null;
  if (isGeenMaker(sub) || isWervend(sub)) return alsBeschrijving();
  if (/^(door|by|o\.l\.v\.)\s/i.test(sub)) return { ...basis, maker: makerZonderVoorvoegsel(sub.replace(/^by\s+/i, '')) };
  if (volgorde === 'maker-titel') {
    const r = pasTitelConventieToe(basis, { artiest: kop, voorstelling: sub, alleGenres: true });
    return r.titel !== kop || kaal(kop) === kaal(sub) ? { ...r, maker: null } : alsBeschrijving();
  }
  if (volgorde === 'titel-maker') return { ...basis, maker: sub };
  if (volgorde === 'titel-beschrijving') return alsBeschrijving();
  return null;
}
