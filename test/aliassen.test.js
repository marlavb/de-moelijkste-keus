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

test('latere export: nieuwe keuzes erbij, opnieuw beoordeelde groep vervangt de oude, keuze wint van R2/R3, niet samenvoegen haalt R2/R3 weg', () => {
  const bestaand = {
    aliassen: {
      'dekpunt | jan beuving en tom dicke': { titel: 'Dekpunt – Jan Beuving & Tom Dicke', maker: 'Jan Beuving & Tom Dicke', groep: 'dekpunt', regel: 'keuze' },
      'dekpunt': { titel: 'Dekpunt – Jan Beuving & Tom Dicke', maker: 'Jan Beuving & Tom Dicke', groep: 'dekpunt', regel: 'keuze' },
      'nienke plas': { titel: 'Appeltje Eitje – Nienke Plas', maker: null, groep: 'appeltje', regel: 'R2' },
      'theater oostpool | the drama': { titel: 'The Drama', maker: null, groep: 'the drama', regel: 'R3' },
      'katwijk': { titel: 'KATWIJK', maker: null, groep: 'k', regel: 'keuze' },
    },
    nietSamenvoegen: [],
  };
  const exp = {
    aliassen: [
      // Dekpunt opnieuw beoordeeld: alleen deze bron, ander doel.
      keuze('dekpunt', 'andere naam', 'dekpunt | jan beuving en tom dicke', { titel: 'Dekpunt', maker: 'Jan Beuving', weergave: 'Dekpunt – Jan Beuving' }),
      keuze('appeltje', 'samenvoegen', 'nienke plas', { titel: 'Appeltje Eitje', maker: 'Nienke Plas', weergave: 'Appeltje Eitje – Nienke Plas' }),
      keuze('nieuw', 'samenvoegen', 'x', { titel: 'Y', maker: null, weergave: 'Y' }),
    ],
    nietSamenvoegen: [{ groep: 'the drama', sleutels: ['theater oostpool | the drama', 'the drama'] }],
  };
  const { lijst, overzicht } = voegExportSamen(bestaand, exp);
  assert.equal(lijst.aliassen['dekpunt | jan beuving en tom dicke'].titel, 'Dekpunt – Jan Beuving');
  assert.equal(lijst.aliassen.dekpunt, undefined);
  assert.equal(lijst.aliassen['nienke plas'].regel, 'keuze');
  assert.equal(lijst.aliassen['theater oostpool | the drama'], undefined);
  assert.equal(lijst.aliassen.katwijk.titel, 'KATWIJK');
  assert.equal(lijst.aliassen.x.titel, 'Y');
  assert.deepEqual(lijst.nietSamenvoegen.map((g) => g.groep), ['the drama']);
  assert.deepEqual({ nieuw: overzicht.nieuw.length, gewijzigd: overzicht.gewijzigd.length, verwijderd: overzicht.verwijderd.length, gelijk: overzicht.gelijk }, { nieuw: 1, gewijzigd: 2, verwijderd: 2, gelijk: 1 });
  // Dezelfde export nog eens: niets verandert.
  const twee = voegExportSamen(lijst, exp);
  assert.deepEqual(twee.lijst, lijst);
  assert.equal(twee.overzicht.nieuw.length + twee.overzicht.gewijzigd.length + twee.overzicht.verwijderd.length, 0);
});

test('zelfde titel in twee groepen → één productie (met maker); twee verschillende makers → niet', () => {
  const exp = {
    aliassen: [
      keuze('populisme de musical', 'samenvoegen', 'populisme | sem konijn', { titel: 'Populisme de Musical', maker: 'Sem Konijn', weergave: 'Populisme de Musical' }),
      keuze('sem konijn', 'andere naam', 'populisme | sem konijn', { titel: 'Populisme de Musical', maker: 'Sem Konijn', weergave: 'Populisme de Musical – Sem Konijn' }),
      keuze('sem konijn', 'andere naam', 'populisme', { titel: 'Populisme de Musical', maker: 'Sem Konijn', weergave: 'Populisme de Musical – Sem Konijn' }),
      keuze('pn', 'andere naam', 'patrick nederkoorn', { titel: 'Nieuw programma', maker: 'Patrick Nederkoorn', weergave: 'Nieuw programma – Patrick Nederkoorn' }),
      keuze('sg', 'andere naam', 'sezgin gulec', { titel: 'Nieuw programma', maker: 'Sezgin Güleç', weergave: 'Nieuw programma – Sezgin Güleç' }),
    ],
    nietSamenvoegen: [],
  };
  const { lijst, overzicht } = voegExportSamen({ aliassen: {}, nietSamenvoegen: [] }, exp);
  assert.equal(lijst.aliassen['populisme | sem konijn'].titel, 'Populisme de Musical – Sem Konijn');
  assert.equal(lijst.aliassen.populisme.titel, 'Populisme de Musical – Sem Konijn');
  assert.deepEqual(overzicht.conflicten, []);
  assert.equal(overzicht.eenProductie.length, 1);
  assert.equal(lijst.aliassen['patrick nederkoorn'].titel, 'Nieuw programma – Patrick Nederkoorn');
  assert.equal(lijst.aliassen['sezgin gulec'].titel, 'Nieuw programma – Sezgin Güleç');
  // Eén productie: één watchlist-sleutel.
  assert.equal(watchlistSleutel(lijst.aliassen.populisme.titel), watchlistSleutel(lijst.aliassen['populisme | sem konijn'].titel));
});
