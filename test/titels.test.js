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

test('omgedraaide titel en maker per theater (OMGEDRAAID); jubileum-ondertitel is nooit maker', async () => {
  const { draaiTitelEnMakerOm, isGeenMaker } = await import('../src/lib/titels.js');
  const nhung = { theaterId: 'flint', titel: 'Nhung Dam', maker: 'Legende van de witte slang' };
  assert.deepEqual(draaiTitelEnMakerOm(nhung), { theaterId: 'flint', titel: 'Legende van de witte slang', maker: 'Nhung Dam' });
  // Idempotent: na het omdraaien niet nog eens.
  assert.deepEqual(draaiTitelEnMakerOm(draaiTitelEnMakerOm(nhung)), draaiTitelEnMakerOm(nhung));
  assert.equal(draaiTitelEnMakerOm({ theaterId: 'stoep', titel: 'Alain Clark', maker: 'Date Night' }).titel, 'Date Night');
  // Ander theater, andere titel of geen maker: niets.
  assert.equal(draaiTitelEnMakerOm({ ...nhung, theaterId: 'kunstlinie' }).titel, 'Nhung Dam');
  assert.equal(draaiTitelEnMakerOm({ theaterId: 'flint', titel: 'Sherlock Holmes', maker: 'Mark Rietman' }).titel, 'Sherlock Holmes');
  assert.equal(draaiTitelEnMakerOm({ theaterId: 'flint', titel: 'Nhung Dam', maker: null }).titel, 'Nhung Dam');
  assert.equal(isGeenMaker('20 jaar 3JS'), true);
  assert.equal(isGeenMaker('20 jaar onmeunig druk'), true);
  assert.equal(isGeenMaker('Theater 155'), false);
});

test('"Met: …" (filmcast) is nooit maker', async () => {
  const { isGeenMaker } = await import('../src/lib/titels.js');
  assert.equal(isGeenMaker('Met: Daisy Edgar-Jones, Caitríona Balfe, Fiona Shaw e.a.'), true);
  assert.equal(isGeenMaker('Metropole Orkest'), false);
});

test('voorstelling bij de artiest (VOORSTELLING_BIJ_ARTIEST): Alain Clark → Date Night, alleen t/m de einddatum', async () => {
  const { draaiTitelEnMakerOm } = await import('../src/lib/titels.js');
  const kl = { theaterId: 'kunstlinie', titel: 'Alain Clark', maker: null, datum: '2026-10-28' };
  assert.deepEqual(draaiTitelEnMakerOm(kl), { ...kl, titel: 'Date Night', maker: 'Alain Clark' });
  assert.deepEqual(draaiTitelEnMakerOm(draaiTitelEnMakerOm(kl)), draaiTitelEnMakerOm(kl));
  assert.equal(draaiTitelEnMakerOm({ ...kl, theaterId: 'stadsgehoorzaal' }).titel, 'Date Night');
  assert.equal(draaiTitelEnMakerOm({ ...kl, datum: '2027-03-01' }).titel, 'Alain Clark');
  assert.equal(draaiTitelEnMakerOm({ ...kl, theaterId: 'flint' }).titel, 'Alain Clark');
});

test('algemene ondertitels ("In Concert", "Theatertour") zijn nooit maker', async () => {
  const { isGeenMaker } = await import('../src/lib/titels.js');
  for (const t of ['In Concert', 'Theaterconcert', 'Theatertour', 'Live']) assert.equal(isGeenMaker(t), true, t);
  for (const t of ['Concertgebouworkest', 'Live Rock Band', 'Tourist LeMC']) assert.equal(isGeenMaker(t), false, t);
});

test('ICE: "Live in Theater" is daar de voorstellingsnaam (gerichte uitzondering, zoals vóór 10581df)', async () => {
  const { pasTitelConventieToe, isGeenMaker, isVoorstellingsnaam } = await import('../src/lib/titels.js');
  const { watchlistSleutel } = await import('../public/js/watchlist.js');
  // Schouwburg Concertzaal: kop "ICE", ondertitel "Live in Theater", genre cabaret.
  const show = { titel: 'Live in Theater', maker: 'ICE', genre: 'Overig', genreRuw: 'special, cabaret & comedy', theaterId: 'schouwburgconcertzaal' };
  const na = pasTitelConventieToe(show, { artiest: 'ICE', voorstelling: 'Live in Theater', makerWordtLeeg: true });
  assert.equal(na.titel, 'Live in Theater – ICE');
  assert.equal(na.maker, null);
  // Zelfde productie als Markant en PLT ("Live in Theater (reprise) – ICE").
  assert.equal(watchlistSleutel(na.titel, 'schouwburgconcertzaal'), watchlistSleutel('Live in Theater (reprise) – ICE', 'markant'));
  // Alleen bij ICE: bij een andere artiest blijft "Live in het theater" een ondertitel.
  assert.equal(isVoorstellingsnaam('ICE', 'Live in het theater'), true);
  assert.equal(isVoorstellingsnaam('Ice', 'Live in Theater'), true);
  assert.equal(isVoorstellingsnaam('Jan Jansen', 'Live in Theater'), false);
  const ander = pasTitelConventieToe({ ...show, maker: 'Jan Jansen' }, { artiest: 'Jan Jansen', voorstelling: 'Live in Theater', makerWordtLeeg: true });
  assert.equal(ander.titel, 'Live in Theater');
  assert.equal(isGeenMaker('Live in het theater'), true);
});

test('Markant (7 okt 2026): "Alain Clark" / "Date Night" omgedraaid, zelfde productie als de andere theaters', async () => {
  const { draaiTitelEnMakerOm } = await import('../src/lib/titels.js');
  const { watchlistSleutel } = await import('../public/js/watchlist.js');
  const r = draaiTitelEnMakerOm({ theaterId: 'markant', titel: 'Alain Clark', maker: 'Date Night', datum: '2026-10-21' });
  assert.equal(r.titel, 'Date Night');
  assert.equal(r.maker, 'Alain Clark');
  assert.equal(watchlistSleutel(r.titel, 'markant'), 'date night');
});

test('Toneelgroep Maastricht (Flint, Het Speelhuis): omgedraaid naar "Bijna een leven"', async () => {
  const { draaiTitelEnMakerOm } = await import('../src/lib/titels.js');
  const fl = draaiTitelEnMakerOm({ theaterId: 'flint', titel: 'Toneelgroep Maastricht – Stichting NOX', maker: 'Bijna een leven' });
  assert.equal(fl.titel, 'Bijna een leven');
  assert.equal(fl.maker, 'Toneelgroep Maastricht – Stichting NOX');
  const sp = draaiTitelEnMakerOm({ theaterId: 'speelhuis', titel: 'Toneelgroep Maastricht', maker: 'Bijna een leven' });
  assert.equal(sp.titel, 'Bijna een leven');
  assert.equal(sp.maker, 'Toneelgroep Maastricht');
  // Flint geeft een gewoon streepje (nachtrun 8 okt 2026): telt ook.
  assert.equal(draaiTitelEnMakerOm({ theaterId: 'flint', titel: 'Toneelgroep Maastricht - Stichting NOX', maker: 'Bijna een leven' }).titel, 'Bijna een leven');
  assert.equal(draaiTitelEnMakerOm({ theaterId: 'flint', titel: 'Toneelgroep Maastricht | Stichting NOX', maker: 'Bijna een leven' }).titel, 'Bijna een leven');
  // Nhung Dam bij Flint blijft werken.
  assert.equal(draaiTitelEnMakerOm({ theaterId: 'flint', titel: 'Nhung Dam', maker: 'Legende van de witte slang' }).titel, 'Legende van de witte slang');
});

test('jubileum zonder naam is geen maker: "40 jaar", "40 jarig jubileum tour" (8 okt 2026)', async () => {
  const { isGeenMaker } = await import('../src/lib/titels.js');
  for (const t of ['40 jaar', '50 jaar', '40 jarig jubileum tour', '20 jaar 3JS']) assert.equal(isGeenMaker(t), true, t);
  for (const t of ['Pater Moeskroen', 'Jaarmarkt', 'Loïs Lane']) assert.equal(isGeenMaker(t), false, t);
});

test('VOORSTELLING_BIJ_ARTIEST Munttheater: "ICE" → voorstelling "Live in Theater"', async () => {
  const { draaiTitelEnMakerOm } = await import('../src/lib/titels.js');
  assert.deepEqual(draaiTitelEnMakerOm({ theaterId: 'munttheater', titel: 'ICE', maker: null, datum: '2026-10-30' }), { theaterId: 'munttheater', titel: 'Live in Theater', maker: 'ICE', datum: '2026-10-30' });
  assert.equal(draaiTitelEnMakerOm({ theaterId: 'munttheater', titel: 'ICE', maker: null, datum: '2027-09-01' }).titel, 'ICE', 'na de einddatum niet');
});

test('labelUitTitel: try-out, reprise en (voor)première achter de titel naar de beschrijving (okt 2026)', async () => {
  const { labelUitTitel } = await import('../src/lib/titels.js');
  assert.deepEqual(labelUitTitel('Imperfect (try-out)'), { tekst: 'Imperfect', label: 'try-out' });
  assert.deepEqual(labelUitTitel('Tot het uiterste gedreven (voorpremière)'), { tekst: 'Tot het uiterste gedreven', label: 'voorpremière' });
  assert.deepEqual(labelUitTitel('BEUK (4+) (reprise)'), { tekst: 'BEUK (4+)', label: 'reprise' });
  assert.deepEqual(labelUitTitel('(reprise)'), { tekst: '(reprise)', label: null }, 'niets over: blijft staan');
  assert.deepEqual(labelUitTitel('Space Academy (8+)'), { tekst: 'Space Academy (8+)', label: null });
  assert.deepEqual(labelUitTitel(null), { tekst: null, label: null });
});

test('labelsUitTitel: alle labels, ook vóór " – " en meer in één titel (okt 2026, alle theaters)', async () => {
  const { labelsUitTitel: alle } = await import('../src/lib/titels.js');
  assert.deepEqual(alle('Vanzelfsprekend (try-out) & Sint Juttemis (try-out) – Roué Verveer & Peter van Ewijk'), { tekst: 'Vanzelfsprekend & Sint Juttemis – Roué Verveer & Peter van Ewijk', labels: ['try-out'] });
  assert.deepEqual(alle('Wagyu (try out) – Rundfunk'), { tekst: 'Wagyu – Rundfunk', labels: ['try out'] });
  assert.deepEqual(alle('Raga & Rasa (voorpremière)'), { tekst: 'Raga & Rasa', labels: ['voorpremière'] });
  const { labelsUitTitel } = await import('../src/lib/titels.js');
  assert.deepEqual(labelsUitTitel('Rhobijn (reprise) – Rowwen Hèze'), { tekst: 'Rhobijn – Rowwen Hèze', labels: ['reprise'] });
  assert.deepEqual(labelsUitTitel('Draagkracht ( Premiere )'), { tekst: 'Draagkracht', labels: ['premiere'] });
  assert.deepEqual(labelsUitTitel('Scheepers op z\'n scherpst – Rob Scheepers (reprise)'), { tekst: 'Scheepers op z\'n scherpst – Rob Scheepers', labels: ['reprise'] });
  assert.deepEqual(labelsUitTitel('Grip – Rayen Panday'), { tekst: 'Grip – Rayen Panday', labels: [] });
  assert.deepEqual(labelsUitTitel('(reprise)'), { tekst: '(reprise)', labels: [] });
});

test('slogan of cast nooit als maker (R1, 9 okt 2026), met de valse treffers uit de echte data', async () => {
  const { isSloganOfCast, isGeenMaker } = await import('../src/lib/titels.js');
  for (const t of [
    'Slijm is terug!', 'Jij HOORT in het theater!', 'Goed dat jij bestaat! (try out)', 'GRRR... ik ben een boze dino! (4+)',
    'De enige echte officiële Queen musical!', 'Aladdin de Musical (4+)', 'de Frans Halsema-musical', 'Big Benny, de kienjermusical',
    'Een spannende musical voor de hele familie', 'Mark Rietman, Ferdi Stofmeel e.a.', 'Pieter Hulst, Willem Voogd, e.a.',
    'Soy Kroon als Frans Halsema', 'Hilke Bierman, Jeannine La Rose, Nicole Berendsen',
    'Ivan Karizna, Steven Isserlis, Irene Duval + Nederlands Kamerorkest',
    '’s Werelds beroemdste detective in een nieuw moordmysterie', 'Ik heb je lief, drie generaties lang',
  ]) assert.equal(isSloganOfCast(t), true, t);
  for (const t of [
    'Van Vleuten en Van Muiswinkel', 'Hanneke Drenth en Dianne Liesker', 'Ensemble Gamut!', 'LUDIQUE!', 'Romani!',
    'Bart Krieger (Kunst Toko BAM!)/Theater Bellevue', 'Theater Rotterdam, ZO! Gospel Choir, Glen Faria & Priscilla Vaudelle',
    'Nationaal Jeugd Musical Theater', 'Stichting Musical Stella Duce', 'Scherzi Musicali', 'Theater Als Het Ware',
    'Chapter 58 (Antti Uimonen, Flore Muuse, and Sofia Garcia Miramon)', 'Holland Opera, Duda Paiva Company, New European Ensemble',
    'Iduna Paalman, Zephyr Brüggen / Bellevue Producties, Het Nationale Theater', 'NITE, Club Guy & Roni, Het Muziek, HIIIT',
    'Anke van \'t Hof in coproductie met Het NUT', 'Maas theater en dans', 'Pieter Hulst en Willem de Voogd',
    'Mannen komen van Mars, vrouwen van Venus', 'Toneelgroep Maastricht', 'Kor Hoebe',
  ]) assert.equal(isSloganOfCast(t), false, t);
  // Een ondertitel met "!" blijft voor de titelconventie gewoon bruikbaar.
  assert.equal(isGeenMaker('Hoe dan!'), false);
});

test('reeksUitTitel: reeksnaam met dubbele punt vooraan weg (R4, 9 okt 2026)', async () => {
  const { reeksUitTitel } = await import('../src/lib/titels.js');
  const v = ['Herfststukjes', 'Voorjaarsvakantie', 'Opera & Brunch', 'CELLOFEST', 'Lunchconcert'];
  assert.deepEqual(reeksUitTitel('Herfststukjes: Het Koffertje 4+', v), { tekst: 'Het Koffertje 4+', reeks: 'Herfststukjes' });
  assert.deepEqual(reeksUitTitel('Voorjaarsvakantie:Het Grooote genieten (4+)', v), { tekst: 'Het Grooote genieten (4+)', reeks: 'Voorjaarsvakantie' });
  assert.deepEqual(reeksUitTitel('Opera & Brunch: Heroines', v), { tekst: 'Heroines', reeks: 'Opera & Brunch' });
  // Zonder titel erachter, zonder dubbele punt of niet vooraan: blijft.
  for (const t of ['CELLOFEST', 'Lunchconcert', 'lunchconcert', 'CELLOFEST: ', 'Herfststukjes voor peuters', 'Het Koffertje – Herfststukjes: x']) {
    assert.deepEqual(reeksUitTitel(t, v), { tekst: t, reeks: null }, t);
  }
  // Andere theaters (zonder lijst): niets.
  assert.deepEqual(reeksUitTitel('Herfststukjes: Het Koffertje 4+'), { tekst: 'Herfststukjes: Het Koffertje 4+', reeks: null });
});
