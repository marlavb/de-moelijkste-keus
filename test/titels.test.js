// Tests voor de titelconventie van cabaretiers (src/lib/titels.js).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { pasTitelConventieToe, isWervend, isCabaret, metEnDash } from '../src/lib/titels.js';
import { watchlistSleutel } from '../public/js/watchlist.js';
import { weergaveTitel } from '../public/js/weergave.js';

const cab = (extra) => ({ titel: 'Sara Kroos', maker: 'Prikkelarme kermis', genre: 'Cabaret', genreRuw: 'Cabaret', ...extra });

test('artiest in de titel, voorstelling in het makerveld (De Stoep, Flint, HNT …) → "Voorstelling – Artiest"', () => {
  const s = pasTitelConventieToe(cab(), { artiest: 'Sara Kroos', voorstelling: 'Prikkelarme kermis', makerWordtLeeg: true });
  assert.equal(s.titel, 'Prikkelarme kermis – Sara Kroos');
  assert.equal(s.maker, null);
});

test('voorstelling in de titel, artiest in het makerveld (Bellevue, Omval …)', () => {
  const s = pasTitelConventieToe(cab({ titel: 'Satan is moe', maker: 'Lebbis' }), { artiest: 'Lebbis', voorstelling: 'Satan is moe', makerWordtLeeg: true });
  assert.equal(s.titel, 'Satan is moe – Lebbis');
  assert.equal(s.maker, null);
});

test('voorstelling uit de beschrijving (DeLaMar): maker blijft zoals hij was', () => {
  const s = pasTitelConventieToe(cab({ maker: null, beschrijving: 'Prikkelarme Kermis' }), { artiest: 'Sara Kroos', voorstelling: 'Prikkelarme Kermis' });
  assert.equal(s.titel, 'Prikkelarme Kermis – Sara Kroos');
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
  assert.equal(t('Kintsugi.'), 'Kintsugi – Patrick Laureij');
  assert.equal(t('60-PLUS... JA, DUS?!'), '60-PLUS... JA, DUS?! – Patrick Laureij');
  assert.equal(t('Wacht even...'), 'Wacht even... – Patrick Laureij');
  assert.equal(t('Wat een gezeik!'), 'Wat een gezeik! – Patrick Laureij');
  assert.equal(t('Zei ik dat hardop?'), 'Zei ik dat hardop? – Patrick Laureij');
});

test('volgorde omgedraaid (30 sep 2026): watchlist-sleutel verandert niet', () => {
  for (const [oud, nieuw] of [
    ['Sara Kroos – Prikkelarme kermis', 'Prikkelarme kermis – Sara Kroos'],
    ['Ruud Smulders – Rüdsichtlos', 'Rüdsichtlos – Ruud Smulders'],
    ['Merijn Scholten – Lemming - reprise', 'Lemming - reprise – Merijn Scholten'],
    ['Dolf Jansen – Schaamteloos – Oudejaars 2026', 'Schaamteloos – Oudejaars 2026 – Dolf Jansen'],
  ]) {
    assert.equal(watchlistSleutel(nieuw, 'x'), watchlistSleutel(oud, 'x'), nieuw);
  }
});

test('één scheidingsteken: " - " wordt " – ", streepjes in een woord blijven', () => {
  assert.equal(metEnDash('Huub Stapel - Mannen komen van Mars - Het vervolg'), 'Huub Stapel – Mannen komen van Mars – Het vervolg');
  assert.equal(metEnDash('Try-(H)outen'), 'Try-(H)outen');
  assert.equal(metEnDash(null), null);
  assert.equal(watchlistSleutel(metEnDash('EEJIT - Een Ierse Idioot'), 'x'), watchlistSleutel('EEJIT - Een Ierse Idioot', 'x'));
});

test('weergave: "titel – maker", maker niet dubbel', () => {
  assert.equal(weergaveTitel({ titel: 'Geschiedenis van een ongeluk', maker: 'PATROON/Orkater/De Nieuwkomers' }), 'Geschiedenis van een ongeluk – PATROON/Orkater/De Nieuwkomers');
  assert.equal(weergaveTitel({ titel: 'Jenny Arean Zingt', maker: 'Jenny Arean' }), 'Jenny Arean Zingt');
  assert.equal(weergaveTitel({ titel: 'Prikkelarme kermis – Sara Kroos', maker: null }), 'Prikkelarme kermis – Sara Kroos');
  // Alleen hele woorden tellen: "ITA" staat niet in "La Vita".
  assert.equal(weergaveTitel({ titel: 'La Vita', maker: 'ITA' }), 'La Vita – ITA');
});
