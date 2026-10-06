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
  assert.equal(metEnDash('Oudejaarsconference 2026 | Try-out'), 'Oudejaarsconference 2026 – Try-out');
  assert.equal(metEnDash('JUK | reprise'), 'JUK – reprise');
  assert.equal(metEnDash('AC|DC'), 'AC|DC');
  for (const [a, b] of [['Joes | 3 t/m 8 jaar', 'Joes – 3 t/m 8 jaar'], ['Kelapa Muda | Try-out', 'Kelapa Muda – Try-out']]) {
    assert.equal(watchlistSleutel(metEnDash(a), 'x'), watchlistSleutel(a, 'x'));
    assert.equal(metEnDash(a), b);
  }
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

test('statuswoord als los titeldeel weg bij afgelast/verplaatst', async () => {
  const { zonderStatusWoord } = await import('../src/lib/titels.js');
  const { vervallenStatus } = await import('../src/lib/beschikbaarheid.js');
  assert.equal(zonderStatusWoord('Gelukkig maar – geannuleerd – Myrte Siebinga'), 'Gelukkig maar – Myrte Siebinga');
  assert.equal(zonderStatusWoord('Niek Barendsen, Michiel Nooter e.a. – GEANNULEERD'), 'Niek Barendsen, Michiel Nooter e.a.');
  assert.equal(zonderStatusWoord('Kiem (afgelast)'), 'Kiem');
  assert.equal(zonderStatusWoord('VERPLAATST – Kiem'), 'Kiem');
  assert.equal(zonderStatusWoord("Geannuleerd | O'DREAMS"), "O'DREAMS");
  // Een woord in een titel blijft staan.
  assert.equal(zonderStatusWoord('De verplaatste man'), 'De verplaatste man');
  assert.equal(zonderStatusWoord('Afgelast'), 'Afgelast');
  assert.equal(zonderStatusWoord(null), null);

  assert.equal(vervallenStatus('geannuleerd'), 'afgelast');
  assert.equal(vervallenStatus(' Afgelast '), 'afgelast');
  assert.equal(vervallenStatus('Gaat niet door'), 'afgelast');
  assert.equal(vervallenStatus('Verplaatst'), 'verplaatst');
  assert.equal(vervallenStatus('Bestel kaarten'), null);
  assert.equal(vervallenStatus(null), null);
});

test('alleGenres (Griffioen): conventie ook bij toneel, dans en muziek', () => {
  const toneel = { titel: 'Kompagnie Kistemaker', genre: 'Toneel', genreRuw: 'Toneel', beschrijving: 'Buikzwam' };
  assert.equal(pasTitelConventieToe(toneel, { artiest: toneel.titel, voorstelling: toneel.beschrijving }), toneel);
  assert.equal(
    pasTitelConventieToe(toneel, { artiest: toneel.titel, voorstelling: toneel.beschrijving, alleGenres: true }).titel,
    'Buikzwam – Kompagnie Kistemaker'
  );
  // Een wervende zin blijft ook dan buiten de titel.
  const zin = 'Een avond vol muziek, verhalen en verrassingen voor het hele gezin, met liedjes';
  assert.equal(pasTitelConventieToe(toneel, { artiest: toneel.titel, voorstelling: zin, alleGenres: true }).titel, 'Kompagnie Kistemaker');
});

test('volgordeZeker alleen als de conventie zelf "Voorstelling – Artiest" samenstelt', () => {
  assert.equal(pasTitelConventieToe(cab(), { artiest: 'Sara Kroos', voorstelling: 'Prikkelarme kermis' }).volgordeZeker, true);
  assert.equal(pasTitelConventieToe(cab(), { artiest: 'Jenny Arean', voorstelling: 'Jenny Arean zingt' }).volgordeZeker, undefined);
  assert.equal(pasTitelConventieToe(cab(), { artiest: 'Sara Kroos', voorstelling: '' }).volgordeZeker, undefined);
});

test('nooit maker: content warning, "Met o.a.", leeftijd, reprise, try-out, Grand Finale, Live in het theater', async () => {
  const { isGeenMaker, makerZonderVoorvoegsel } = await import('../src/lib/titels.js');
  for (const t of ['CONTENT WARNING: weinig prikkels', '⚠ stroboscoop', 'Met o.a. Suzan Seegers', 'met Soy Kroon', '4+', '(6+)', '0,5 tot 1,5', '4-7', 'vanaf 6 jaar', 'reprise', '(reprise)', 'try-out', 'Try out', 'Première', 'Grand Finale', 'Live in het theater', 'Live in theater']) {
    assert.equal(isGeenMaker(t), true, t);
  }
  // Wel een naam of voorstelling (ook als het woord er ín staat).
  for (const t of ['Live in Theater (reprise)', 'Grip (reprise)', 'Silbersee (met o.a. Ariane Schluter)', 'Dronken Mensen met o.a. Bram Suijker', 'Het Zakmes (4+)', 'Kor Hoebe', 'De Ballonnenfee']) {
    assert.equal(isGeenMaker(t), false, t);
  }
  assert.equal(makerZonderVoorvoegsel('door Oortwolk'), 'Oortwolk');
  assert.equal(makerZonderVoorvoegsel('o.l.v. Tijn Trommelen (vocals/gitaar)'), 'Tijn Trommelen (vocals/gitaar)');
  assert.equal(makerZonderVoorvoegsel('Doorbraak'), 'Doorbraak');
});

test('titel uit kop en ondertitel, met een vaste volgorde per theater/genre', async () => {
  const { titelUitKopEnOndertitel, pasTitelConventieToe } = await import('../src/lib/titels.js');
  const show = { titel: 'x', maker: 'y', beschrijving: null, genre: 'Dans', genreRuw: 'Dans' };
  const f = (kop, ondertitel, volgorde) => titelUitKopEnOndertitel(show, { kop, ondertitel, volgorde });
  assert.deepEqual([f('Conny Janssen Danst', 'Danslokaal 14', 'maker-titel').titel, f('Conny Janssen Danst', 'Danslokaal 14', 'maker-titel').maker], ['Danslokaal 14 – Conny Janssen Danst', null]);
  assert.equal(f('Joep en Rob', 'De Verbinders', 'maker-titel').titel, 'De Verbinders – Joep en Rob');
  // Nooit maker gaat altijd voor: geen "reprise – Artiest".
  const r = f('Rayen Panday', 'reprise', 'maker-titel');
  assert.deepEqual([r.titel, r.maker, r.beschrijving], ['Rayen Panday', null, 'reprise']);
  // "door X" wordt maker, ook zonder vaste volgorde.
  const d = f('BOINK! ◆ 4+', 'door Oortwolk', null);
  assert.deepEqual([d.titel, d.maker], ['BOINK! ◆ 4+', 'Oortwolk']);
  assert.equal(f('Pippi en de Piraten (6+)', 'Theater Terra', 'titel-maker').maker, 'Theater Terra');
  assert.equal(f('Trio Happy Village met Frank Montis', 'Yes Jazz', 'titel-beschrijving').beschrijving, 'Yes Jazz');
  assert.equal(f('Kop', 'Ondertitel', null), null, 'zonder vaste volgorde beslist de scraper');
  // De cabaret-helper weigert ook bij een nooit-maker-ondertitel.
  const cab = { titel: 'Rundfunk', genre: 'Cabaret', maker: null };
  assert.equal(pasTitelConventieToe(cab, { artiest: 'Rundfunk', voorstelling: 'try-out' }).titel, 'Rundfunk');
});
