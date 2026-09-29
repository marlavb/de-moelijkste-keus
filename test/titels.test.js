// Tests voor de titelconventie van cabaretiers (src/lib/titels.js).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { pasTitelConventieToe, isWervend, isCabaret } from '../src/lib/titels.js';

const cab = (extra) => ({ titel: 'Sara Kroos', maker: 'Prikkelarme kermis', genre: 'Cabaret', genreRuw: 'Cabaret', ...extra });

test('artiest in de titel, voorstelling in het makerveld (De Stoep, Flint, HNT …)', () => {
  const s = pasTitelConventieToe(cab(), { artiest: 'Sara Kroos', voorstelling: 'Prikkelarme kermis', makerWordtLeeg: true });
  assert.equal(s.titel, 'Sara Kroos – Prikkelarme kermis');
  assert.equal(s.maker, null);
});

test('voorstelling in de titel, artiest in het makerveld (Bellevue, Omval …)', () => {
  const s = pasTitelConventieToe(cab({ titel: 'Satan is moe', maker: 'Lebbis' }), { artiest: 'Lebbis', voorstelling: 'Satan is moe', makerWordtLeeg: true });
  assert.equal(s.titel, 'Lebbis – Satan is moe');
  assert.equal(s.maker, null);
});

test('voorstelling uit de beschrijving (DeLaMar): maker blijft zoals hij was', () => {
  const s = pasTitelConventieToe(cab({ maker: null, beschrijving: 'Prikkelarme Kermis' }), { artiest: 'Sara Kroos', voorstelling: 'Prikkelarme Kermis' });
  assert.equal(s.titel, 'Sara Kroos – Prikkelarme Kermis');
  assert.equal(s.beschrijving, 'Prikkelarme Kermis');
});

test('niet bij toneel of dans, niet zonder tweede deel, niet met een wervende zin', () => {
  const toneel = { titel: 'God is een snotje', maker: 'Kim Karssen', genre: 'Toneel', genreRuw: 'Toneel' };
  assert.equal(pasTitelConventieToe(toneel, { artiest: 'Kim Karssen', voorstelling: 'God is een snotje' }), toneel);
  assert.equal(pasTitelConventieToe(cab(), { artiest: 'Sara Kroos', voorstelling: '' }).titel, 'Sara Kroos');
  for (const zin of ['met o.a. Yora Rienstra', 'De blik op 2026 door de ogen van vrouwen!', 'Een voorstelling over moederschap, keuzes en de chaos van het dagelijks leven, met liedjes']) {
    assert.ok(isWervend(zin), zin);
    assert.equal(pasTitelConventieToe(cab(), { artiest: 'Sara Kroos', voorstelling: zin }).titel, 'Sara Kroos', zin);
  }
  for (const naam of ['Wat een gezeik!', '60-PLUS... JA, DUS?!', 'Zei ik dat hardop?', 'Ik zit hier heel alleen kerstfeest te vieren 2', 'begrijpt steeds minder']) {
    assert.equal(isWervend(naam), false, naam);
  }
});

test('geen dubbele artiest', () => {
  assert.equal(pasTitelConventieToe(cab(), { artiest: 'Sara Kroos', voorstelling: 'Sara Kroos' }).titel, 'Sara Kroos');
  assert.equal(
    pasTitelConventieToe(cab(), { artiest: 'Jenny Arean', voorstelling: 'Jenny Arean zingt' }).titel,
    'Jenny Arean zingt'
  );
});

test('isCabaret kijkt naar genre en ruw genre', () => {
  assert.ok(isCabaret({ genre: null, genreRuw: 'Stand-up comedy' }));
  assert.ok(isCabaret({ genre: 'Overig', genreRuw: 'KLEINKUNST, Matinee' }));
  assert.equal(isCabaret({ genre: null, genreRuw: null }), false);
});

test('losse punt aan het eind van de voorstellingsnaam weg, verder niets', () => {
  const t = (v) => pasTitelConventieToe(cab(), { artiest: 'Patrick Laureij', voorstelling: v }).titel;
  assert.equal(t('Kintsugi.'), 'Patrick Laureij – Kintsugi');
  assert.equal(t('60-PLUS... JA, DUS?!'), 'Patrick Laureij – 60-PLUS... JA, DUS?!');
  assert.equal(t('Wacht even...'), 'Patrick Laureij – Wacht even...');
  assert.equal(t('Wat een gezeik!'), 'Patrick Laureij – Wat een gezeik!');
  assert.equal(t('Zei ik dat hardop?'), 'Patrick Laureij – Zei ik dat hardop?');
});
