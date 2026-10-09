// Aliaslijst (titels-ronde-2, okt 2026): toepassen en een export van de
// afvinkpagina omzetten. Fixtures naar de echte keuzes van 9 okt 2026.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pasAliasToe, makerInTitel, controleer, leesAliassen } from '../src/lib/aliassen.js';
import { voegExportSamen } from '../src/lib/aliasImport.js';
import { watchlistSleutel } from '../public/js/watchlist.js';

const lijst = {
  aliassen: {
    'dekpunt | jan beuving en tom dicke': { titel: 'Dekpunt – Jan Beuving', maker: 'Jan Beuving', regel: 'keuze' },
    'janne schra en de vogels': { titel: 'Kleuren moeten ook slapen (6+)', maker: 'Janne Schra & De Vogels', regel: 'keuze' },
  },
};

test('pasAliasToe: titel, maker niet dubbel, voorstellingsnaam uit het makerveld, lege maker gevuld', () => {
  assert.deepEqual(pasAliasToe({ titel: 'Dekpunt – Jan Beuving & Tom Dicke', maker: 'Jan Beuving', theaterId: 'x' }, lijst).maker, null);
  assert.equal(pasAliasToe({ titel: 'Dekpunt – Jan Beuving & Tom Dicke', maker: null, theaterId: 'x' }, lijst).titel, 'Dekpunt – Jan Beuving');
  // De voorstellingsnaam (met label) als maker: staat al in de titel.
  assert.equal(pasAliasToe({ titel: 'Janne Schra & De Vogels', maker: 'Kleuren moeten ook slapen (reprise)', theaterId: 'x' }, lijst).maker, 'Janne Schra & De Vogels');
  assert.equal(pasAliasToe({ titel: 'Janne Schra & De Vogels', maker: null, theaterId: 'x' }, lijst).maker, 'Janne Schra & De Vogels');
  // Een andere maker blijft staan.
  assert.equal(pasAliasToe({ titel: 'Janne Schra & De Vogels', maker: 'regie: Iemand', theaterId: 'x' }, lijst).maker, 'regie: Iemand');
  assert.deepEqual(pasAliasToe({ titel: 'Iets anders', maker: 'M', theaterId: 'x' }, lijst), { titel: 'Iets anders', maker: 'M', alias: null });
  assert.equal(makerInTitel('Dekpunt – Jan Beuving', 'Jan Beuving'), true);
  assert.equal(makerInTitel('Wachtend op de dood – Maarten Heijmans & Xander Vrienten', 'Maarten Heijmans en Xander Vrienten'), true);
});

const keuze = (groep, keuze, bron, canoniek) => ({ groep, keuze, bron, bronTitels: [], theaters: [], canoniek });

test('export omzetten: andere naam met maker, samenvoegen zonder voorstelmaker, conflict eruit', () => {
  const exp = {
    aliassen: [
      keuze('dekpunt', 'andere naam', 'dekpunt | jan beuving en tom dicke', { titel: 'Dekpunt', maker: 'Jan Beuving', weergave: 'Dekpunt – Jan Beuving' }),
      keuze('compagnie', 'andere naam', 'katwijk', { titel: 'KATWIJK', maker: 'Compagnie Red Yellow & Blue', weergave: 'KATWIJK – Compagnie Red Yellow & Blue' }),
      // Maker uit het voorstel, buiten de titel: niet overnemen ("CATS" / "Het meesterwerk").
      keuze('cats', 'samenvoegen', 'het meesterwerk', { titel: 'CATS', maker: 'Het meesterwerk', weergave: 'CATS' }),
      keuze('snotje', 'samenvoegen', 'god is een snotje', { titel: 'God is een snotje', maker: 'Kim Karssen', weergave: 'God is een snotje – Kim Karssen' }),
      // "Theater Oostpool" als losse titel in twee groepen: niet eenduidig.
      keuze('the nether', 'samenvoegen', 'theater oostpool', { titel: 'The Nether', maker: null, weergave: 'The Nether' }),
      keuze('millennial', 'samenvoegen', 'theater oostpool', { titel: 'Millennial II', maker: null, weergave: 'Millennial II' }),
    ],
    nietSamenvoegen: [],
  };
  const { lijst: uit, overzicht } = voegExportSamen({ aliassen: {}, nietSamenvoegen: [] }, exp);
  assert.deepEqual(uit.aliassen['dekpunt | jan beuving en tom dicke'], { titel: 'Dekpunt – Jan Beuving', maker: 'Jan Beuving', groep: 'dekpunt', regel: 'keuze' });
  assert.equal(uit.aliassen.katwijk.titel, 'KATWIJK – Compagnie Red Yellow & Blue');
  assert.equal(uit.aliassen['het meesterwerk'].maker, null);
  assert.equal(uit.aliassen['god is een snotje'].maker, 'Kim Karssen');
  assert.equal(uit.aliassen['theater oostpool'], undefined);
  assert.equal(overzicht.conflicten.length, 1);
  assert.equal(overzicht.nieuw.length, 4);
  assert.deepEqual(controleer(uit), []);
});

test('config/aliassen.json: geldig, geen ketens, elke bron een echte sleutel', () => {
  const echt = leesAliassen();
  assert.ok(Object.keys(echt.aliassen).length > 0);
  assert.deepEqual(controleer(echt), []);
  for (const [bron, a] of Object.entries(echt.aliassen)) {
    assert.ok(a.titel && ['keuze', 'R2', 'R3'].includes(a.regel), bron);
    // Het doel is zelf geen bron met een ander doel, en verandert bij een tweede keer niet.
    assert.equal(pasAliasToe({ titel: a.titel, maker: null, theaterId: 'x' }, echt).titel, a.titel, bron);
    assert.ok(!bron.includes('::') || bron.split('::')[1], bron);
  }
  assert.equal(watchlistSleutel('Dekpunt – Jan Beuving'), 'dekpunt | jan beuving');
});
