// Zoeken in de agenda (okt 2026): in alles wat de gebruiker van een
// voorstelling ziet. Tot 15 okt 2026 zocht de app alleen in de titel, de
// brontitel en het theater, niet in de maker: "NDT" vond "Blast a universe –
// NDT 2" (titel "Blast a universe", maker "NDT 2") niet, terwijl "Brandt" wel
// werkte omdat die in de titel stond ("Over de Liefde – Aaf Brandt Corstius
// & Lies Visschedijk"). Pure functies, gedeeld door de app en de tests.

import { weergaveTitel } from './weergave.js';

/** Kleine letters, zonder accenten ("Carré" → "carre"), witruimte samengevoegd. */
export function zoekVorm(tekst) {
  return String(tekst ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * De teksten waarin gezocht wordt: de getoonde titel ("Titel – Maker"), de
 * titel zoals het theater hem schrijft (titelBron), de maker, het theater, de
 * stad en de zoekaliassen van het theater (bv. "ita").
 */
export function zoekTeksten(show, aliassen = []) {
  return [weergaveTitel(show), show?.titelBron, show?.maker, show?.theaterNaam, show?.stad, ...aliassen].filter(Boolean);
}

// Een korte zoekterm (hooguit KORT tekens) is vaak een afkorting ("NDT",
// "ITA", "KSO"): die moet aan het begin van een woord staan, anders vindt
// "NDT" ook "Brandt", "Grondtonen" en "Soundtrack", en "ITA" ook "Evita".
// Langere zoektermen mogen midden in een woord staan, voor Nederlandse
// samenstellingen ("dans" in "Introdans", "kerst" in "Babykerstconcert").
export const KORT = 3;
const opWoordbegin = (q) => new RegExp(`(^|[^\\p{L}\\p{N}])${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'u');

/** Past de voorstelling bij de zoekterm? Een lege zoekterm past altijd. */
export function matchtZoekterm(show, zoekterm, { aliassen = [] } = {}) {
  const q = zoekVorm(zoekterm);
  if (!q) return true;
  const teksten = zoekTeksten(show, aliassen).map(zoekVorm);
  if (q.length <= KORT) {
    const re = opWoordbegin(q);
    return teksten.some((t) => re.test(t));
  }
  return teksten.some((t) => t.includes(q));
}
