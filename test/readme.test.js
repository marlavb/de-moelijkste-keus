// Tests voor scripts/readme.js: alleen de tekst tussen de AUTO-markers
// verandert, de rest blijft byte voor byte gelijk, en zonder wijziging is
// de uitkomst identiek (dan schrijft het script niets).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { vervangBlokken, maakBlokken, amsterdamTijd, podiumpasVan } from '../scripts/readme.js';

const LEESMIJ = `# Titel

Vaste tekst met <!-- een gewone opmerking -->.

<!-- AUTO:a:start -->
oud a
<!-- AUTO:a:end -->

Midden | met tekens $1 \`code\`

<!-- AUTO:b:start -->
<!-- AUTO:b:end -->
Slot zonder regeleinde`;

test('vervangt alleen de tekst tussen de markers', () => {
  const uit = vervangBlokken(LEESMIJ, { a: 'nieuw a\nregel 2', b: '$& $1 tabel | x' });
  assert.equal(
    uit,
    // (vervangen met een functie: anders zou $& hier zelf iets betekenen)
    LEESMIJ.replace('<!-- AUTO:a:start -->\noud a\n', () => '<!-- AUTO:a:start -->\nnieuw a\nregel 2\n').replace(
      '<!-- AUTO:b:start -->\n',
      () => '<!-- AUTO:b:start -->\n$& $1 tabel | x\n'
    )
  );
  // Alles buiten de blokken is gelijk.
  const buiten = (t) => t.replace(/<!-- AUTO:(\w+):start -->[\s\S]*?<!-- AUTO:\1:end -->/g, '');
  assert.equal(buiten(uit), buiten(LEESMIJ));
});

test('niets veranderd: precies dezelfde tekst (idempotent)', () => {
  const een = vervangBlokken(LEESMIJ, { a: 'x', b: 'y' });
  assert.equal(vervangBlokken(een, { a: 'x', b: 'y' }), een);
  assert.equal(vervangBlokken(een, { a: 'x\n', b: '  y  ' }), een); // witruimte rond de inhoud telt niet
  assert.equal(vervangBlokken(LEESMIJ, {}), LEESMIJ);
});

test('ontbrekende, omgedraaide of dubbele markers: een fout, geen stille wijziging', () => {
  assert.throws(() => vervangBlokken(LEESMIJ, { c: 'x' }), /markers voor "c"/);
  assert.throws(() => vervangBlokken('<!-- AUTO:a:end --> <!-- AUTO:a:start -->', { a: 'x' }), /verkeerd om/);
  assert.throws(() => vervangBlokken(`${LEESMIJ}\n<!-- AUTO:a:start -->`, { a: 'x' }), /twee keer/);
});

test('blokken: provincies in de volgorde van de app, Podiumpas ja/nee/deels, status en gepauzeerd', () => {
  const theaters = [
    { id: 'u1', naam: 'Stadsschouwburg Utrecht', stad: 'Utrecht', provincie: 'Utrecht', podiumpas: true },
    { id: 'n2', naam: 'B | theater', stad: 'Haarlem', provincie: 'Noord-Holland', podiumpas: true },
    { id: 'n1', naam: 'A', stad: 'Amsterdam', provincie: 'Noord-Holland', podiumpas: false },
    { id: 'z1', naam: 'Isala', stad: 'Capelle', provincie: 'Zuid-Holland', podiumpas: true, gepauzeerd: { sinds: '2026-09-28', reden: 'x' } },
  ];
  const shows = [
    { theaterId: 'n2', titel: 'X', podiumpas: true },
    { theaterId: 'n2', titel: 'X', podiumpas: false },
    { theaterId: 'u1', titel: 'Y', podiumpas: true },
  ];
  const scrapeStatus = { bijgewerktOp: '2026-10-05T03:42:00Z', theaters: { u1: { status: 'ok' }, n2: { status: 'ok' }, n1: { status: 'leeg' }, z1: { status: 'gepauzeerd' } } };
  const b = maakBlokken({ theaters, scrapeStatus, shows, swBron: "const CACHE_NAME = 'podiumagenda-v99';" });
  assert.deepEqual([...b.theaters.matchAll(/\*\*([^*]+)\*\* \(\d+\)/g)].map((m) => m[1]), ['Noord-Holland', 'Zuid-Holland', 'Utrecht']);
  assert.match(b.theaters, /\| A \| Amsterdam \| – \| leeg \|\n\| B \\\| theater \| Haarlem \| deels \| ok \|/);
  assert.match(b.theaters, /\| Isala \| Capelle \| – \| gepauzeerd sinds 2026-09-28 \|/);
  assert.match(b.aantallen, /Theaters: \*\*4\*\* \(2 ok, 1 leeg, 1 gepauzeerd\)/);
  assert.match(b.aantallen, /Voorstellingen \(titel per theater\): \*\*2\*\*/);
  assert.match(b.aantallen, /Speeldata: \*\*3\*\*/);
  assert.match(b.aantallen, /Laatste refresh: \*\*5 oktober 2026, 05:42\*\*/);
  assert.equal(b.sw, 'Service worker: `podiumagenda-v99`');
});

test('Amsterdamse tijd in zomer- en wintertijd, los van de tijdzone van de machine', () => {
  assert.equal(amsterdamTijd('2026-10-04T22:30:00Z'), '5 oktober 2026, 00:30');
  assert.equal(amsterdamTijd('2026-12-31T23:05:00Z'), '1 januari 2027, 00:05');
});

test('de README in de repo heeft alle markers', async () => {
  const leesmij = await readFile(new URL('../README.md', import.meta.url), 'utf-8');
  for (const naam of ['aantallen', 'sw', 'theaters']) assert.ok(leesmij.includes(`<!-- AUTO:${naam}:start -->`), naam);
});

test('Podiumpas per voorstelling, zoals het tabblad Theaters: gemengd = deels, config telt niet, zonder voorstellingen –', () => {
  const shows = [
    // Gemengd theater (zoals Bostheater: theater wel, concerten niet).
    { theaterId: 'bos', podiumpas: true },
    { theaterId: 'bos', podiumpas: false },
    { theaterId: 'bos' }, // ontbrekend veld = geen Podiumpas
    { theaterId: 'alles', podiumpas: true },
    { theaterId: 'niets', podiumpas: false },
  ];
  assert.equal(podiumpasVan('bos', shows), 'deels');
  assert.equal(podiumpasVan('alles', shows), 'ja');
  assert.equal(podiumpasVan('niets', shows), 'nee');
  // Geen voorstellingen (leeg of gepauzeerd): geen label, ook als config.js podiumpas: true heeft.
  assert.equal(podiumpasVan('isala', shows), '–');
  const b = maakBlokken({
    theaters: [
      { id: 'bos', naam: 'Bostheater', stad: 'Amstelveen', provincie: 'Noord-Holland', podiumpas: true },
      { id: 'niets', naam: 'Niets', stad: 'Utrecht', provincie: 'Utrecht', podiumpas: true },
      { id: 'isala', naam: 'Isala theater', stad: 'Capelle aan den IJssel', provincie: 'Zuid-Holland', podiumpas: true, gepauzeerd: { sinds: '2026-09-28' } },
    ],
    scrapeStatus: { theaters: { bos: { status: 'ok' }, niets: { status: 'ok' } } },
    shows,
    swBron: '',
  });
  assert.match(b.theaters, /\| Bostheater \| Amstelveen \| deels \| ok \|/);
  assert.match(b.theaters, /\| Niets \| Utrecht \| nee \| ok \|/);
  assert.match(b.theaters, /\| Isala theater \| Capelle aan den IJssel \| – \| gepauzeerd sinds 2026-09-28 \|/);
});

test('elk theater uit config.js staat in de README onder zijn eigen provincie', async () => {
  const { THEATERS } = await import('../src/lib/config.js');
  const leesmij = await readFile(new URL('../README.md', import.meta.url), 'utf-8');
  const blok = leesmij.split('<!-- AUTO:theaters:start -->')[1].split('<!-- AUTO:theaters:end -->')[0];
  const perProvincie = new Map();
  let p = null;
  for (const regel of blok.split('\n')) {
    const kop = regel.match(/^\*\*(.+)\*\* \(\d+\)$/);
    if (kop) p = kop[1];
    const rij = regel.match(/^\| (.+?) \| (.+?) \|/);
    if (rij && !['Theater', '---'].includes(rij[1])) perProvincie.set(rij[1].replace(/\\\|/g, '|'), p);
  }
  assert.equal(perProvincie.size, THEATERS.length);
  for (const t of THEATERS) assert.equal(perProvincie.get(t.naam), t.provincie, t.naam);
});
