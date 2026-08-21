const DUTCH_MONTHS = {
  januari: 1,
  februari: 2,
  maart: 3,
  april: 4,
  mei: 5,
  juni: 6,
  juli: 7,
  augustus: 8,
  september: 9,
  oktober: 10,
  november: 11,
  december: 12,
};

const DUTCH_MONTHS_ABBREV = {
  jan: 1,
  feb: 2,
  mrt: 3,
  apr: 4,
  mei: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  okt: 10,
  nov: 11,
  dec: 12,
};

function pad2(n) {
  return String(n).padStart(2, '0');
}

function toIsoDate(year, month, day) {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

/**
 * Parseert Nederlandse datum-labels zoals gebruikt in theateragenda's:
 * "Vandaag", "Morgen" of "Zondag 23 augustus" (zonder jaartal).
 * Omdat het jaar ontbreekt, houdt de caller een DateContext bij die het
 * jaar ophoogt zodra de maand terugspringt (agenda's lopen chronologisch).
 */
export function createDutchDayParser(referenceDate = new Date()) {
  let year = referenceDate.getFullYear();
  let lastMonth = referenceDate.getMonth() + 1;

  return function parseDayLabel(label) {
    const clean = label.trim().toLowerCase();

    if (clean === 'vandaag') {
      return toIsoDate(referenceDate.getFullYear(), referenceDate.getMonth() + 1, referenceDate.getDate());
    }
    if (clean === 'morgen') {
      const d = new Date(referenceDate);
      d.setDate(d.getDate() + 1);
      return toIsoDate(d.getFullYear(), d.getMonth() + 1, d.getDate());
    }

    const match = clean.match(/(\d{1,2})\s+([a-zé]+)(?:\s+(\d{4}))?/i);
    if (!match) return null;
    const day = parseInt(match[1], 10);
    const monthName = match[2];
    const explicitYear = match[3];
    const month = DUTCH_MONTHS[monthName];
    if (!month) return null;

    if (explicitYear) {
      year = parseInt(explicitYear, 10);
    } else if (month < lastMonth) {
      year += 1;
    }
    lastMonth = month;

    return toIsoDate(year, month, day);
  };
}

/**
 * Parseert datum-labels met afgekorte Nederlandse maandnamen zoals gebruikt
 * op Theater Bellevue: "wo 9 sep" (weekdag-afkorting, dag, maand-afkorting,
 * zonder jaartal). Zelfde jaar-rollover-aanpak als createDutchDayParser.
 */
export function createDutchAbbrevDayParser(referenceDate = new Date()) {
  let year = referenceDate.getFullYear();
  let lastMonth = referenceDate.getMonth() + 1;

  return function parseDayLabel(label) {
    const clean = label.trim().toLowerCase();
    const match = clean.match(/(\d{1,2})\s+([a-zé]+)/i);
    if (!match) return null;
    const day = parseInt(match[1], 10);
    const month = DUTCH_MONTHS_ABBREV[match[2]];
    if (!month) return null;

    if (month < lastMonth) {
      year += 1;
    }
    lastMonth = month;

    return toIsoDate(year, month, day);
  };
}

export function extractTime(text) {
  if (!text) return null;
  const match = text.match(/(\d{1,2})[:.](\d{2})/);
  if (!match) return null;
  return `${pad2(parseInt(match[1], 10))}:${match[2]}`;
}

export function slugify(text) {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Zorgt dat ids uniek zijn binnen een run, ook als twee voorstellingen
 * toevallig dezelfde titel/datum/tijd combinatie hebben.
 */
export function createIdBuilder() {
  const seen = new Map();
  return function buildId(theaterId, titel, datum, tijd) {
    const tijdSlug = tijd ? tijd.replace(':', '') : 'tbd';
    const base = `${theaterId}-${slugify(titel)}-${datum}-${tijdSlug}`;
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return count === 0 ? base : `${base}-${count + 1}`;
  };
}
