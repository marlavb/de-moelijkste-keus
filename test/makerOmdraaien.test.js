// R1 en omgedraaide titels (titels-ronde-1, 9 okt 2026): fixtures naar de
// echte gevallen uit de data van 9 okt.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bronIndex, r1Keuze } from '../src/lib/makerOmdraaien.js';
import { pasMakerMeerderheidToe } from '../src/lib/makerMeerderheid.js';

const data = [
  { theaterId: 'stoep', titel: 'Johnny de Mol', maker: 'Goed dat jij bestaat!' },
  { theaterId: 'vrijthof', titel: 'Goed dat jij bestaat!', maker: 'Johnny de Mol' },
  { theaterId: 'stoep', titel: 'De Verleiders', maker: 'Zoek Dekking!' },
  { theaterId: 'maaspoort', titel: 'Zoek Dekking!', maker: 'De Verleiders' },
  { theaterId: 'orpheus', titel: 'De Verleiders', maker: 'Zoek Dekking! – over pensioenen en verzekeringen' },
  { theaterId: 'cpunt', titel: 'Motel Westcoast', maker: 'Motel Westcoast 20 Years!' },
  { theaterId: 'hengelo', titel: '20 years', maker: 'Motel Westcoast' },
  { theaterId: 'schaffelaar', titel: 'Motel Westcoast 20 Years!', maker: null },
  // Omgedraaid bij Concertzaal met een cast als titel: geen bewijs dat "Sherlock Holmes" een maker is.
  { theaterId: 'schouwburgconcertzaal', titel: 'Mark Rietman, Ferdi Stofmeel e.a.', maker: 'Sherlock Holmes' },
  { theaterId: 'oranjerie', titel: 'Sherlock Holmes', maker: '’s Werelds beroemdste detective in een nieuw moordmysterie' },
  { theaterId: 'stoep', titel: 'Steven Kazàn', maker: 'Hoe dan!' },
  { theaterId: 'cpunt', titel: 'Steven Kazàn', maker: 'Hoe dan!' },
  { theaterId: 'flint', titel: 'Best of Ireland', maker: 'De grootste hits uit Ierland!' },
  { theaterId: 'munttheater', titel: 'De grootste hits uit Ierland! – Best of Ireland', maker: null },
  { theaterId: 'delamar', titel: 'Girls on Fire 3', maker: 'Hilke Bierman, Jeannine La Rose, Nicole Berendsen' },
];
const index = bronIndex(data);
const keuze = (theaterId, titel, maker) => r1Keuze({ theaterId, titel, maker }, index);

test('omdraaien als de titel elders maker is én de "maker" elders titel', () => {
  assert.deepEqual(keuze('stoep', 'Johnny de Mol', 'Goed dat jij bestaat!'), { keuze: 'omdraaien', titel: 'Goed dat jij bestaat! – Johnny de Mol', rest: null });
  assert.deepEqual(keuze('stoep', 'De Verleiders', 'Zoek Dekking!'), { keuze: 'omdraaien', titel: 'Zoek Dekking! – De Verleiders', rest: null });
  // Alleen het eerste deel van de maker is de voorstelling; de rest gaat naar de beschrijving.
  assert.deepEqual(keuze('orpheus', 'De Verleiders', 'Zoek Dekking! – over pensioenen en verzekeringen'), { keuze: 'omdraaien', titel: 'Zoek Dekking! – De Verleiders', rest: 'over pensioenen en verzekeringen' });
  // De maker staat al in de voorstellingsnaam: niet dubbel.
  assert.deepEqual(keuze('cpunt', 'Motel Westcoast', 'Motel Westcoast 20 Years!'), { keuze: 'omdraaien', titel: 'Motel Westcoast 20 Years!', rest: null });
});

test('laten zoals vóór R1 zonder bewijs, of als de "maker" elders titel is', () => {
  // Titel alleen "elders maker" via een omgedraaide cast-titel: telt niet.
  assert.deepEqual(keuze('oranjerie', 'Sherlock Holmes', '’s Werelds beroemdste detective in een nieuw moordmysterie'), { keuze: 'laten' });
  // Overal dezelfde volgorde: niet uit te maken of "Hoe dan!" de voorstelling is.
  assert.deepEqual(keuze('stoep', 'Steven Kazàn', 'Hoe dan!'), { keuze: 'laten' });
  // "De grootste hits uit Ierland!" is bij het Munttheater (deel van de) titel.
  assert.deepEqual(keuze('flint', 'Best of Ireland', 'De grootste hits uit Ierland!'), { keuze: 'laten' });
});

test('een cast gaat naar de beschrijving', () => {
  assert.deepEqual(keuze('delamar', 'Girls on Fire 3', 'Hilke Bierman, Jeannine La Rose, Nicole Berendsen'), { keuze: 'beschrijving' });
  assert.deepEqual(keuze('cpunt', 'Sherlock Holmes', 'Mark Rietman, Ferdi Stofmeel e.a.'), { keuze: 'beschrijving' });
});

test('makermeerderheid: een slogan die maker bleef stemt niet mee en verspreidt zich niet', () => {
  const shows = [
    { titel: 'Sherlock Holmes', theaterId: 'oranjerie', maker: '’s Werelds beroemdste detective in een nieuw moordmysterie' },
    { titel: 'Sherlock Holmes', theaterId: 'despiegel', maker: '’s Werelds beroemdste detective in een nieuw moordmysterie' },
    { titel: 'Sherlock Holmes', theaterId: 'delamar', maker: null },
    { titel: 'Sherlock Holmes', theaterId: 'cpunt', maker: null },
  ];
  const { shows: uit, gewijzigd } = pasMakerMeerderheidToe(shows);
  assert.equal(gewijzigd, 0);
  assert.deepEqual(uit.map((s) => s.maker), shows.map((s) => s.maker));
});
