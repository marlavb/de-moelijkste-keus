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

/** Past de voorstelling bij de zoekterm? Een lege zoekterm past altijd. */
export function matchtZoekterm(show, zoekterm, { aliassen = [] } = {}) {
  const q = zoekVorm(zoekterm);
  if (!q) return true;
  return zoekTeksten(show, aliassen).some((t) => zoekVorm(t).includes(q));
}
