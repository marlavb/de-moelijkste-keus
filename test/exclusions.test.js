import { test } from 'node:test';
import assert from 'node:assert/strict';

import { lowestPrice, matchesAnyName, checkExclusionText } from '../src/lib/exclusions.js';

test('lowestPrice: formats, gratis, extra kosten, geen prijs', () => {
  assert.equal(lowestPrice('Rang 1 normaal € 22,50 De prijs is inclusief consumptie. € 22,50'), 22.5);
  assert.equal(lowestPrice('€ 15–€ 32'), 15);
  assert.equal(lowestPrice('Prijzen vanaf € 12,50'), 12.5);
  assert.equal(lowestPrice('Combinatieticket vanaf € 20,-'), 20);
  assert.equal(lowestPrice('€ 1.250,00'), 1250);
  assert.equal(lowestPrice('Toegang gratis'), 0);
  assert.equal(lowestPrice('€ 75,00 Extra kosten: € 1,- per ticket'), 75);
  assert.equal(lowestPrice('Op uitnodiging'), null);
  assert.equal(lowestPrice(null), null);
});

test('matchesAnyName: hoofdletters en accenten maken niet uit', () => {
  assert.equal(matchesAnyName(['Cézanne Tegelberg Company'], 'Dans', 'CEZANNE TEGELBERG COMPANY - Nieuw'), 'Cézanne Tegelberg Company');
  assert.equal(matchesAnyName(['Moordmysterie'], 'Moordmysterie', 'Once Upon A Time'), 'Moordmysterie');
  assert.equal(matchesAnyName(['Jay Francis'], 'Herman van Veen', 'Vandaag'), null);
});

function fakePage(bodyText, { fail = false } = {}) {
  return {
    goto: async () => {
      if (fail) throw new Error('net::ERR_TIMED_OUT');
    },
    evaluate: async () => bodyText,
  };
}

async function check(bodyText, opts) {
  const warnings = [];
  await checkExclusionText({
    page: fakePage(bodyText, opts),
    robots: { isAllowed: () => true },
    waitForTurn: async () => {},
    warn: (m) => warnings.push(m),
    log: () => {},
    url: 'https://theater.test/podiumpas',
    startsWith: 'Uitgesloten zijn',
    expected: 'Uitgesloten zijn: films en   verhuur.',
  });
  return warnings;
}

test('uitsluitingstekst: ongewijzigd → geen waarschuwing (witruimte maakt niet uit)', async () => {
  assert.deepEqual(await check('Intro. Uitgesloten zijn: films en verhuur. Meer tekst.'), []);
});

test('uitsluitingstekst: gewijzigd → waarschuwing met de nieuwe tekst', async () => {
  const w = await check('Intro. Uitgesloten zijn: films, verhuur en Moord in Isala. Meer.');
  assert.equal(w.length, 1);
  assert.match(w[0], /gewijzigd.*Moord in Isala/);
});

test('uitsluitingstekst: verdwenen of pagina onbereikbaar → waarschuwing, geen exception', async () => {
  assert.match((await check('Een heel andere pagina.'))[0], /niet meer gevonden/);
  assert.match((await check('', { fail: true }))[0], /niet laden/);
});
