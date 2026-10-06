// Tests voor scripts/readme.js: alleen de tekst tussen de AUTO-markers
// verandert, de rest blijft byte voor byte gelijk, en zonder wijziging is
// de uitkomst identiek (dan schrijft het script niets).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { vervangBlokken, maakBlokken, amsterdamTijd } from '../scripts/readme.js';

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
  assert.match(b.theaters, /\| A \| Amsterdam \| nee \| leeg \|\n\| B \\\| theater \| Haarlem \| deels \| ok \|/);
  assert.match(b.theaters, /\| Isala \| Capelle \| ja \| gepauzeerd sinds 2026-09-28 \|/);
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
