// Datumfilter "Wanneer" (okt 2026): snelkeuzes, een eigen van–tot en
// weekdagen. Alles op kale ISO-datums ('YYYY-MM-DD') met "vandaag" uit
// amsterdamDatum() (plannen.js), dus in Amsterdamse tijd, ook rond
// middernacht, in zomer- en wintertijd en op een toestel in een andere
// tijdzone. Rekenen met Date.UTC op die datums: geen toISOString van een
// lokaal tijdstip.
//
// Vorm (bewaard bij de andere filters in localStorage):
// { snel: null | 'vandaag' | 'morgen' | 'weekend' | 'week' | 'volgendeWeek' | 'maand',
//   van: '' | ISO, tot: '' | ISO, dagen: [1..7] (ISO-weekdag, 1 = ma) }.
// Snelkeuze en eigen datums sluiten elkaar uit; weekdagen combineren met
// beide. Niets gekozen = alles.

import { amsterdamDatum } from './plannen.js';

export const SNELKEUZES = [
  { id: 'vandaag', label: 'Vandaag' },
  { id: 'morgen', label: 'Morgen' },
  { id: 'weekend', label: 'Dit weekend' },
  { id: 'week', label: 'Deze week' },
  { id: 'volgendeWeek', label: 'Volgende week' },
  { id: 'maand', label: 'Deze maand' },
];

export const WEEKDAGEN = [
  { dag: 1, label: 'ma', naam: 'maandag' },
  { dag: 2, label: 'di', naam: 'dinsdag' },
  { dag: 3, label: 'wo', naam: 'woensdag' },
  { dag: 4, label: 'do', naam: 'donderdag' },
  { dag: 5, label: 'vr', naam: 'vrijdag' },
  { dag: 6, label: 'za', naam: 'zaterdag' },
  { dag: 7, label: 'zo', naam: 'zondag' },
];

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const SNEL_IDS = new Set(SNELKEUZES.map((s) => s.id));

export const legeWanneer = () => ({ snel: null, van: '', tot: '', dagen: [] });

/** Een opgeslagen (of onbekende) vorm → een geldige; onzin valt weg. */
export function normaliseerWanneer(w) {
  const dagen = Array.isArray(w?.dagen) ? [...new Set(w.dagen.filter((d) => Number.isInteger(d) && d >= 1 && d <= 7))].sort() : [];
  const van = ISO.test(w?.van ?? '') ? w.van : '';
  const tot = ISO.test(w?.tot ?? '') ? w.tot : '';
  const snel = SNEL_IDS.has(w?.snel) && !van && !tot ? w.snel : null;
  return { snel, van, tot, dagen };
}

const naarUtc = (iso) => {
  const [j, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(j, m - 1, d));
};
const naarIso = (d) => d.toISOString().slice(0, 10); // een UTC-middernacht, geen lokaal tijdstip

/** iso + n dagen. */
export function plusDagen(iso, n) {
  const d = naarUtc(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return naarIso(d);
}

/** ISO-weekdag van een datum: 1 = maandag … 7 = zondag. */
export function weekdagVan(iso) {
  return naarUtc(iso).getUTCDay() || 7;
}

/** Laatste dag van de maand van iso. */
function laatsteVanMaand(iso) {
  const [j, m] = iso.split('-').map(Number);
  return naarIso(new Date(Date.UTC(j, m, 0)));
}

/**
 * Het bereik { van, tot } van een snelkeuze vanaf vandaag (Amsterdam).
 * - weekend: vrijdag t/m zondag van deze week; op za/zo vanaf vandaag.
 * - week: vandaag t/m zondag.
 * - volgendeWeek: maandag t/m zondag van volgende week.
 * - maand: vandaag t/m de laatste dag van de maand.
 */
export function snelBereik(snel, vandaag) {
  const wd = weekdagVan(vandaag);
  const zondag = plusDagen(vandaag, 7 - wd);
  switch (snel) {
    case 'vandaag':
      return { van: vandaag, tot: vandaag };
    case 'morgen': {
      const m = plusDagen(vandaag, 1);
      return { van: m, tot: m };
    }
    case 'weekend':
      return { van: wd >= 5 ? vandaag : plusDagen(vandaag, 5 - wd), tot: zondag };
    case 'week':
      return { van: vandaag, tot: zondag };
    case 'volgendeWeek':
      return { van: plusDagen(zondag, 1), tot: plusDagen(zondag, 7) };
    case 'maand':
      return { van: vandaag, tot: laatsteVanMaand(vandaag) };
    default:
      return null;
  }
}

/**
 * Het datumbereik van een keuze: { van, tot } (tot null = open), of null
 * als er geen bereik gekozen is (alleen weekdagen of niets).
 * Eigen datums: alleen "van" = vanaf; alleen "tot" = t/m; omgedraaid wordt
 * rechtgezet.
 */
export function wanneerBereik(w, vandaag) {
  if (w.snel) return snelBereik(w.snel, vandaag);
  if (!w.van && !w.tot) return null;
  let van = w.van || null;
  let tot = w.tot || null;
  if (van && tot && van > tot) [van, tot] = [tot, van];
  return { van, tot };
}

export const isWanneerActief = (w) => Boolean(w.snel || w.van || w.tot || w.dagen.length);

/** Heeft de keuze een datumbereik (dan geldt het 30-dagenvenster niet)? */
export const heeftBereik = (w) => Boolean(w.snel || w.van || w.tot);

/** Past een speeldatum bij de keuze? `vandaag` in Amsterdam (standaard nu). */
export function matchtWanneer(datum, w, vandaag = amsterdamDatum()) {
  const b = wanneerBereik(w, vandaag);
  if (b && ((b.van && datum < b.van) || (b.tot && datum > b.tot))) return false;
  if (w.dagen.length && !w.dagen.includes(weekdagVan(datum))) return false;
  return true;
}

// Bewerkingen: geven een nieuwe keuze terug.

/** Snelkeuze aan/uit (één tegelijk); zet eigen datums uit. */
export function kiesSnel(w, snel) {
  return { ...w, snel: w.snel === snel ? null : snel, van: '', tot: '' };
}

/** Eigen datum zetten ('van' of 'tot'); zet de snelkeuze uit. */
export function kiesDatum(w, veld, waarde) {
  return { ...w, snel: null, [veld]: ISO.test(waarde ?? '') ? waarde : '' };
}

/** Weekdag aan/uit (meerdere tegelijk). */
export function wisselDag(w, dag) {
  const dagen = w.dagen.includes(dag) ? w.dagen.filter((d) => d !== dag) : [...w.dagen, dag].sort();
  return { ...w, dagen };
}
