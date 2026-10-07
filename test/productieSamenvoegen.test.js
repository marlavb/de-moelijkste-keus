// Tests voor het samenvoegen van producties (src/lib/productieSamenvoegen.js):
// Greg Shapiro – KING ME, en de gevallen die niet samengevoegd mogen worden.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { pasProductieSamenvoegingToe, titelUitBeschrijving, samenvoegen } from '../src/lib/productieSamenvoegen.js';
import { pasMeerderheidToe } from '../src/lib/weergaveMeerderheid.js';
import { pasGenreMeerderheidToe } from '../src/lib/genreMeerderheid.js';
import { watchlistSleutel } from '../public/js/watchlist.js';

let n = 0;
const s = (theaterId, titel, extra = {}) => ({ id: `${theaterId}-${++n}`, theaterId, titel, datum: `2026-11-${String(n).padStart(2, '0')}`, tijd: '20:15', genre: 'Cabaret', maker: null, beschrijving: null, ...extra });
const kingMe = () => [
  s('stadsgehoorzaal', 'Greg Shapiro', { genre: 'Overig', beschrijving: 'KING ME | 250 years of Donald Trump' }),
  s('cpunt', 'KING ME – 250 years of Donald Trump – Greg Shapiro', { volgordeZeker: true }),
  s('kleinekomedie', 'King Me – 250 years of Donald Trump – Greg Shapiro', { volgordeZeker: true, beschrijving: '‘Scherpe satire.’' }),
  s('stoep', 'KING ME – Greg Shapiro', { volgordeZeker: true }),
  s('omval', 'King Me – Greg Shapiro', { volgordeZeker: true }),
];
const sleutel = (x) => watchlistSleutel(x.titel, x.theaterId);

test('KING ME: drie producties worden één, overal "KING ME – Greg Shapiro", genre Cabaret', () => {
  const r = pasProductieSamenvoegingToe(kingMe());
  assert.deepEqual(r.titelUitBeschrijving.map((x) => x.theaterId), ['stadsgehoorzaal']);
  assert.deepEqual(new Set(r.shows.map(sleutel)), new Set(['greg shapiro | king me']));
  // De weggelaten ondertitel naar de beschrijving als die leeg was; anders blijft de eigen.
  assert.equal(r.shows[0].beschrijving, '250 years of Donald Trump');
  assert.equal(r.shows[1].beschrijving, '250 years of Donald Trump');
  assert.equal(r.shows[2].beschrijving, '‘Scherpe satire.’');
  // Bron bewaard (voor teruggevallen data).
  assert.equal(r.shows[0].titelBron, 'Greg Shapiro');
  assert.equal(r.shows[0].beschrijvingBron, 'KING ME | 250 years of Donald Trump');
  assert.equal(r.shows[1].titelBron, 'KING ME – 250 years of Donald Trump – Greg Shapiro');
  assert.equal('titelBron' in r.shows[3], false);
  // Daarna de weergave en het genre op meerderheid: één schrijfwijze, Cabaret.
  const weergave = pasGenreMeerderheidToe(pasMeerderheidToe(r.shows).shows).shows;
  assert.deepEqual(new Set(weergave.map((x) => x.titel)), new Set(['KING ME – Greg Shapiro']));
  assert.equal(weergave[0].genre, 'Cabaret');
  assert.equal(weergave[0].titelBron, 'Greg Shapiro');
  assert.equal(r.samengevoegd.length, 1);
  // Idempotent.
  assert.deepEqual(pasProductieSamenvoegingToe(r.shows).shows.map((x) => x.titel), r.shows.map((x) => x.titel));
});

test('titel = artiest: alleen als de artiest elders maker is, NAAM daar een voorstelling, en de titel elders geen voorstelling', () => {
  // Artiest nergens anders: niets.
  assert.equal(titelUitBeschrijving([s('a', 'Greg Shapiro', { beschrijving: 'KING ME | 250 years' })]).gewijzigd.length, 0);
  // NAAM is geen voorstelling van die artiest: niets.
  assert.equal(titelUitBeschrijving([s('a', 'Greg Shapiro', { beschrijving: 'Iets anders | 250 years' }), s('b', 'KING ME – Greg Shapiro', { volgordeZeker: true })]).gewijzigd.length, 0);
  // "The Nether" (DeLaMar): elders zelf de voorstelling, ook al staat hij ergens als maker.
  const nether = [
    s('delamar', 'The Nether', { beschrijving: 'Theater Oostpool | Jeroen Spitzenberger e.a.' }),
    s('x', 'Theater Oostpool', { maker: 'The Nether' }),
    s('tr25', 'The Nether', { maker: 'Theater Oostpool' }),
  ];
  assert.equal(titelUitBeschrijving(nether).gewijzigd.length, 0);
  // Zonder " | " in de beschrijving: niets.
  assert.equal(titelUitBeschrijving([s('a', 'Greg Shapiro', { beschrijving: 'KING ME' }), s('b', 'KING ME – Greg Shapiro', { volgordeZeker: true })]).gewijzigd.length, 0);
});

test('niet samenvoegen: generiek begin, korter dan 4 tekens, ":" als scheiding, onzekere volgorde, andere maker', () => {
  const r = samenvoegen([
    s('a', 'Oudejaarsconference 2026 – Claudia de Breij', { volgordeZeker: true }),
    s('b', 'Oudejaarsconference 2026 – TV-opnames – Claudia de Breij', { volgordeZeker: true }),
    s('c', 'JUK – Jeroens Clan', { volgordeZeker: true }),
    s('d', 'Juk – reprise – live – Jeroens Clan', { volgordeZeker: true }),
    s('e', 'Stadsgasten', { maker: 'De ludieke Bossche talkshow' }),
    s('e', 'Stadsgasten: De Kruiskamp', { maker: 'De ludieke Bossche talkshow' }),
    s('f', 'Toneelgroep Maastricht', { maker: null }),
    s('g', 'Toneelgroep Maastricht – Stichting NOX', { maker: null }),
    s('h', 'Bonobo – Flip Noorman', { volgordeZeker: true }),
    s('i', 'Bonobo – première – Iemand Anders', { volgordeZeker: true }),
  ]);
  assert.equal(r.samengevoegd.length, 0);
  assert.deepEqual(r.overgeslagen.map((o) => o.begin).sort(), ['juk', 'oudejaarsconference 2026']);
});

test('wel samenvoegen: première/ondertitel binnen dezelfde maker, makerveld; maar niet als de speeldatum dan dubbel wordt', () => {
  const r = samenvoegen([
    s('a', 'Bonobo – Flip Noorman', { volgordeZeker: true }),
    s('b', 'Bonobo – première – Flip Noorman', { volgordeZeker: true }),
    s('c', 'Carmen', { maker: 'Opera Compact' }),
    s('d', 'Carmen – concertante uitvoering', { maker: 'Opera Compact' }),
  ]);
  assert.equal(r.shows[1].titel, 'Bonobo – Flip Noorman');
  assert.equal(r.shows[1].beschrijving, 'première');
  assert.equal(r.shows[3].titel, 'Carmen');
  assert.equal(r.shows[3].maker, 'Opera Compact');
  // Zelfde theater, datum en tijd: aparte kaarten (zaal en balkon), niet samen.
  const zaal = { theaterId: 'aandeslinger', datum: '2026-11-01', tijd: '15:00', maker: 'Recreantenorkest Caecilia' };
  const b = samenvoegen([{ ...zaal, id: '1', titel: 'Herfstklanken Concert' }, { ...zaal, id: '2', titel: 'Herfstklanken Concert – Balkon 2' }]);
  assert.equal(b.shows[1].titel, 'Herfstklanken Concert – Balkon 2');
  assert.match(b.overgeslagen[0].producties[0], /zelfde speeldatum/);
});

test('première: samengevoegd, "Première." vooraan in de bestaande beschrijving; "… Special" is een apart evenement', () => {
  const r = samenvoegen([
    s('kleinekomedie', 'Bonobo – première – Flip Noorman', { volgordeZeker: true, beschrijving: 'Flip Noorman zingt.' }),
    s('bellevue', 'Bonobo – Flip Noorman', { volgordeZeker: true }),
    s('muziekgebouw', 'SoundLAB workshop', { maker: 'Voor kinderen (7+) met volwassenen' }),
    s('muziekgebouw', 'SoundLAB workshop – Paas Special', { maker: 'Voor kinderen (7+) met volwassenen' }),
    s('muziekgebouw', 'SoundLAB workshop – Syntherklaas Special', { maker: 'Voor kinderen (7+) met volwassenen' }),
  ]);
  assert.equal(r.shows[0].titel, 'Bonobo – Flip Noorman');
  assert.equal(r.shows[0].beschrijving, 'Première. Flip Noorman zingt.');
  assert.equal(r.shows[0].beschrijvingBron, 'Flip Noorman zingt.');
  assert.equal(r.shows[3].titel, 'SoundLAB workshop – Paas Special');
  assert.equal(r.shows[4].titel, 'SoundLAB workshop – Syntherklaas Special');
  assert.ok(r.overgeslagen.some((o) => o.producties.some((p) => /Paas Special/.test(p))));
});
