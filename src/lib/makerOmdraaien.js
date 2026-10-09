// R1 en omgedraaide titels (titels-ronde-1, 9 okt 2026). Een "maker" die R1
// weghaalt (isSloganOfCast) is soms de voorstellingsnaam bij een omgedraaide
// titel: De Stoep "Johnny de Mol" / "Goed dat jij bestaat!", terwijl Vrijthof
// titel "Goed dat jij bestaat!" en maker "Johnny de Mol" heeft. Die naam mag
// niet verdwijnen. Per voorstelling, met bewijs uit de andere theaters:
// - een cast ("… e.a.", namenrij, "X als Y") is nooit de voorstelling: naar
//   de beschrijving (R1), ook als hij elders (omgedraaid) als titel staat;
// - anders omdraaien naar "Voorstelling – Maker" als de titel elders maker
//   is én de "maker" (of het eerste deel ervan) elders titel is;
// - anders blijven titel en maker zoals vóór R1. Of een "!"-tekst of zin een
//   slogan of de voorstellingsnaam is, valt niet betrouwbaar uit de data te
//   halen ("Steven Kazàn" / "Hoe dan!" naast "Vlieg Met Me Mee" / "Ik heb je
//   lief, drie generaties lang"); liever een slogan als maker dan een
//   verdwenen voorstellingsnaam. Zo'n maker stemt niet mee in de
//   makermeerderheid (makerMeerderheid.js). "Elders maker" telt niet
// bij een voorstelling waarvan de titel zelf een cast of zin is (Concertzaal
// "Mark Rietman, Ferdi Stofmeel e.a." / "Sherlock Holmes"): dat is juist zo'n
// omgedraaide voorstelling, geen bewijs dat "Sherlock Holmes" een maker is.

import { isGeenMaker, isSloganOfCast, sloganSoort, metEnDash, SCHEIDER } from './titels.js';
import { ruimeTitel } from '../../public/js/watchlist.js';

const norm = (t) => ruimeTitel(String(t ?? '').replace(/\s*\(\d[^)]*\)\s*$/, ''));

function voeg(map, sleutel, theaterId) {
  if (!sleutel) return;
  if (!map.has(sleutel)) map.set(sleutel, new Set());
  map.get(sleutel).add(theaterId);
}

/**
 * Makers en titels (heel, en het eerste deel) per theater, uit de
 * brongegevens van de voorstellingen ({ theaterId, titel, maker }).
 */
export function bronIndex(shows) {
  const makers = new Map();
  const titels = new Map();
  for (const s of shows) {
    const titel = metEnDash(String(s.titel ?? ''));
    if (s.maker && !isGeenMaker(s.maker) && !isSloganOfCast(s.maker) && !['cast', 'zin'].includes(sloganSoort(titel))) voeg(makers, norm(s.maker), s.theaterId);
    voeg(titels, norm(titel), s.theaterId);
    voeg(titels, norm(titel.split(SCHEIDER)[0]), s.theaterId);
  }
  return { makers, titels };
}

/**
 * Wat te doen met een maker die R1 raakt. Geeft { keuze: 'omdraaien', titel,
 * rest } (rest: wat na het eerste deel van de maker kwam, voor de
 * beschrijving), { keuze: 'laten' } of { keuze: 'beschrijving' }.
 */
export function r1Keuze({ titel, maker, theaterId }, { makers, titels }) {
  if (sloganSoort(maker) === 'cast') return { keuze: 'beschrijving' };
  const elders = (map, sleutel) => [...(map.get(sleutel) ?? [])].some((t) => t !== theaterId);
  const delen = String(maker).split(SCHEIDER);
  const naam = elders(titels, norm(maker)) ? maker : delen.length > 1 && elders(titels, norm(delen[0])) ? delen[0] : null;
  if (naam && elders(makers, norm(titel))) {
    // "Motel Westcoast" / "Motel Westcoast 20 Years!": de maker niet dubbel.
    const nieuw = norm(naam).includes(norm(titel)) ? naam : `${naam}${SCHEIDER}${titel}`;
    return { keuze: 'omdraaien', titel: nieuw, rest: naam === maker ? null : delen.slice(1).join(SCHEIDER) };
  }
  return { keuze: 'laten' };
}
