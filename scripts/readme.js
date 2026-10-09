// `node scripts/readme.js`: werkt de automatische blokken in README.md bij,
// tussen markers als <!-- AUTO:theaters:start --> … <!-- AUTO:theaters:end -->.
// Alleen de tekst tussen de markers verandert; de rest van de README blijft
// precies zoals hij is. Schrijft niets als er niets verandert.
// `--check`: niets schrijven, exitcode 1 als de README niet actueel is.
//
// Bronnen: src/lib/config.js (theaters, provincie, Podiumpas, gepauzeerd),
// public/data/scrape-status.json (status per theater, laatste refresh),
// public/data/shows.json (aantallen) en public/sw.js (versie). Het aantal
// tests per suite staat er bewust niet in: dat is alleen betrouwbaar te
// tellen door de suites te draaien (veel tests zitten in lussen).
//
// Gedraaid door .github/workflows/readme.yml na elke push naar main en na
// de nachtelijke refresh.

import { readFile, writeFile } from 'node:fs/promises';

/** Vervangt de inhoud van elk blok; gooit als een marker ontbreekt. */
export function vervangBlokken(tekst, blokken) {
  let uit = tekst;
  for (const [naam, inhoud] of Object.entries(blokken)) {
    const start = `<!-- AUTO:${naam}:start -->`;
    const eind = `<!-- AUTO:${naam}:end -->`;
    const a = uit.indexOf(start);
    const b = uit.indexOf(eind);
    if (a === -1 || b === -1 || b < a) throw new Error(`README: markers voor "${naam}" ontbreken of staan verkeerd om`);
    if (uit.indexOf(start, a + 1) !== -1) throw new Error(`README: blok "${naam}" staat er twee keer`);
    uit = `${uit.slice(0, a + start.length)}\n${inhoud.trim()}\n${uit.slice(b)}`;
  }
  return uit;
}

// Zelfde volgorde als het tabblad Theaters (PROVINCE_ORDER in public/js/app.js).
const PROVINCIES = ['Noord-Holland', 'Zuid-Holland', 'Utrecht', 'Flevoland', 'Limburg', 'Noord-Brabant'];

// Zelf opgemaakt (niet met de nl-NL-notatie van Intl, die per Node-versie
// verschilt): anders zou elke runner een andere README maken.
const AMSTERDAM = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Amsterdam',
  day: 'numeric',
  month: 'numeric',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});
const MAANDEN = ['januari', 'februari', 'maart', 'april', 'mei', 'juni', 'juli', 'augustus', 'september', 'oktober', 'november', 'december'];

/** "5 oktober 2026, 13:11" in Amsterdamse tijd. */
export function amsterdamTijd(iso) {
  const d = Object.fromEntries(AMSTERDAM.formatToParts(new Date(iso)).map((p) => [p.type, p.value]));
  return `${Number(d.day)} ${MAANDEN[Number(d.month) - 1]} ${d.year}, ${d.hour}:${d.minute}`;
}

const cel = (t) => String(t ?? '').replace(/\|/g, '\\|');

// Podiumpas: dezelfde bron als het tabblad Theaters in de app, namelijk
// `podiumpas` per voorstelling in shows.json (niet het veld in config.js,
// dat bij gemengde theaters niet per voorstelling klopt). ja = alle
// voorstellingen, deels = een deel, nee = geen, onbekend = bij geen enkele
// zeker, bij een deel nog niet bekend (podiumpas: null, okt 2026). Zonder
// voorstellingen in de data toont de app geen Podiumpas-label; hier dan "–".
// (De app zelf toont "Podiumpas" bij ja of deels, "Podiumpas?" bij onbekend
// en "Geen Podiumpas" bij nee.)
export function podiumpasVan(theaterId, shows) {
  const eigen = shows.filter((s) => s.theaterId === theaterId);
  if (eigen.length === 0) return '–';
  const ja = eigen.filter((s) => s.podiumpas === true).length;
  if (ja === eigen.length) return 'ja';
  if (ja > 0) return 'deels';
  return eigen.some((s) => s.podiumpas === null) ? 'onbekend' : 'nee';
}

function statusVan(theater, status) {
  if (theater.gepauzeerd) return `gepauzeerd sinds ${theater.gepauzeerd.sinds}`;
  return status?.status ?? 'onbekend';
}

/** De blokken als tekst, uit de bronnen (geen klok: dezelfde invoer geeft dezelfde uitvoer). */
export function maakBlokken({ theaters, scrapeStatus, shows, swBron }) {
  const perProvincie = new Map();
  for (const t of theaters) {
    if (!perProvincie.has(t.provincie)) perProvincie.set(t.provincie, []);
    perProvincie.get(t.provincie).push(t);
  }
  const volgorde = [...PROVINCIES.filter((p) => perProvincie.has(p)), ...[...perProvincie.keys()].filter((p) => !PROVINCIES.includes(p)).sort()];
  const delen = [];
  for (const p of volgorde) {
    const rijen = [...perProvincie.get(p)].sort((a, b) => a.stad.localeCompare(b.stad, 'nl') || a.naam.localeCompare(b.naam, 'nl'));
    delen.push(
      `**${p}** (${rijen.length})\n\n| Theater | Stad | Podiumpas | Status |\n|---|---|---|---|\n` +
        rijen.map((t) => `| ${cel(t.naam)} | ${cel(t.stad)} | ${podiumpasVan(t.id, shows)} | ${cel(statusVan(t, scrapeStatus.theaters?.[t.id]))} |`).join('\n')
    );
  }

  const telling = {};
  for (const t of theaters) {
    const s = statusVan(t, scrapeStatus.theaters?.[t.id]).split(' ')[0];
    telling[s] = (telling[s] ?? 0) + 1;
  }
  const voorstellingen = new Set(shows.map((s) => `${s.theaterId}|${s.titel}`)).size;
  const refresh = scrapeStatus.bijgewerktOp ? amsterdamTijd(scrapeStatus.bijgewerktOp) : 'onbekend';
  const aantallen = [
    `- Theaters: **${theaters.length}** (${Object.entries(telling).map(([s, n]) => `${n} ${s}`).join(', ')})`,
    `- Voorstellingen (titel per theater): **${voorstellingen}**`,
    `- Speeldata: **${shows.length}**`,
    `- Laatste refresh: **${refresh}** (Amsterdamse tijd)`,
  ].join('\n');

  const sw = swBron.match(/CACHE_NAME\s*=\s*'([^']+)'/)?.[1] ?? 'onbekend';
  return { theaters: delen.join('\n\n'), aantallen, sw: `Service worker: \`${sw}\`` };
}

async function main() {
  const root = new URL('../', import.meta.url);
  const lees = (pad) => readFile(new URL(pad, root), 'utf-8');
  const { THEATERS } = await import('../src/lib/config.js');
  const blokken = maakBlokken({
    theaters: THEATERS,
    scrapeStatus: JSON.parse(await lees('public/data/scrape-status.json')),
    shows: JSON.parse(await lees('public/data/shows.json')),
    swBron: await lees('public/sw.js'),
  });
  const oud = await lees('README.md');
  const nieuw = vervangBlokken(oud, blokken);
  if (nieuw === oud) {
    console.log('README.md is actueel.');
    return;
  }
  if (process.argv.includes('--check')) {
    console.error('README.md is niet actueel: draai `node scripts/readme.js`.');
    process.exit(1);
  }
  await writeFile(new URL('README.md', root), nieuw);
  console.log('README.md bijgewerkt.');
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
