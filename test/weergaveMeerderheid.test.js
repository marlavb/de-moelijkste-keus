// Tests voor de weergavetitel op meerderheid (src/lib/weergaveMeerderheid.js).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { pasMeerderheidToe, kiesWeergave, vormSleutel } from '../src/lib/weergaveMeerderheid.js';
import { watchlistSleutel } from '../public/js/watchlist.js';
import { geplandSleutel } from '../public/js/gepland.js';
import { dubbelSleutel } from '../src/lib/dedupe.js';

let n = 0;
const s = (theaterId, titel, extra = {}) => ({ id: `${theaterId}-${++n}`, theaterId, titel, datum: '2026-12-01', tijd: '20:00', ...extra });

test('vorm: zelfde delen, andere volgorde/hoofdletters/scheiding → zelfde vorm; toevoeging niet', () => {
  assert.equal(vormSleutel('Prikkelarme kermis – Sara Kroos'), vormSleutel('Sara Kroos - Prikkelarme Kermis'));
  assert.notEqual(vormSleutel('Prikkelarme Kermis (reprise) – Sara Kroos'), vormSleutel('Prikkelarme kermis – Sara Kroos'));
});

test('zekere theaters stemmen eerst; Carré volgt de meerderheid; titelBron bewaard', () => {
  const { shows, gewijzigd } = pasMeerderheidToe([
    s('carre', 'Sara Kroos – Prikkelarme kermis'),
    s('ssu', 'Prikkelarme kermis – Sara Kroos', { volgordeZeker: true }),
    s('ks', 'Prikkelarme kermis – Sara Kroos', { volgordeZeker: true }),
    s('delamar', 'Prikkelarme Kermis – Sara Kroos', { volgordeZeker: true }),
  ]);
  assert.deepEqual(shows.map((x) => x.titel), Array(4).fill('Prikkelarme kermis – Sara Kroos'));
  assert.equal(shows[0].titelBron, 'Sara Kroos – Prikkelarme kermis');
  assert.equal(shows[2].titelBron, undefined);
  assert.equal(gewijzigd, 2);
});

test('toevoeging blijft: "(reprise)" en "(try-out)" worden niet weggestemd', () => {
  const { shows } = pasMeerderheidToe([
    s('stoep', 'Prikkelarme Kermis (reprise) – Sara Kroos'),
    s('ssu', 'Prikkelarme kermis – Sara Kroos', { volgordeZeker: true }),
    s('ks', 'Prikkelarme kermis – Sara Kroos', { volgordeZeker: true }),
  ]);
  assert.equal(shows[0].titel, 'Prikkelarme Kermis (reprise) – Sara Kroos');
});

test('één theater: niets; theatergebonden titel (uitsluitlijst): niets', () => {
  const een = [s('a', 'Sara Kroos – Gelukskoekje'), s('a', 'Gelukskoekje – Sara Kroos', { volgordeZeker: true })];
  // Binnen één theater wordt niet gestemd.
  assert.deepEqual(pasMeerderheidToe(een).shows.map((x) => x.titel), een.map((x) => x.titel));
  const nora = [s('a', 'Nora'), s('b', 'NORA'), s('c', 'NORA')];
  assert.equal(pasMeerderheidToe(nora).gewijzigd, 0);
});

test('geen zekere stemmen: meerderheid over alle theaters; gelijke stand vast en voorspelbaar', () => {
  assert.equal(kiesWeergave([{ vorm: 'B – A' }, { vorm: 'A – B' }, { vorm: 'A – B' }]), 'A – B');
  // Gelijke stand: meeste zekere stemmen, dan laagste in tekenvolgorde,
  // ongeacht de volgorde van de invoer.
  const gelijk = [{ vorm: 'Z – Y' }, { vorm: 'Y – Z' }];
  assert.equal(kiesWeergave(gelijk), 'Y – Z');
  assert.equal(kiesWeergave([...gelijk].reverse()), 'Y – Z');
  // Gelijke stand in hoofdletters: minste hoofdletters wint, in beide volgordes.
  assert.equal(kiesWeergave([{ vorm: 'GELUKKIG MAAR' }, { vorm: 'Gelukkig maar' }]), 'Gelukkig maar');
  assert.equal(kiesWeergave([{ vorm: 'Gelukkig maar' }, { vorm: 'GELUKKIG MAAR' }]), 'Gelukkig maar');
  // Zekere stemmen staken → meerderheid over alle theaters.
  assert.equal(
    kiesWeergave([{ vorm: 'Y – Z', zeker: true }, { vorm: 'Z – Y', zeker: true }, { vorm: 'Z – Y' }]),
    'Z – Y'
  );
});

test('sleutels, plannen en ontdubbeling blijven gelijk; opnieuw toepassen verandert niets', () => {
  const invoer = [
    s('carre', 'Sara Kroos – Prikkelarme kermis'),
    s('ssu', 'Prikkelarme kermis – Sara Kroos', { volgordeZeker: true }),
  ];
  const { shows } = pasMeerderheidToe(invoer);
  for (let i = 0; i < invoer.length; i++) {
    assert.equal(watchlistSleutel(shows[i].titel, shows[i].theaterId), watchlistSleutel(invoer[i].titel, invoer[i].theaterId));
    assert.equal(geplandSleutel(shows[i]), geplandSleutel(invoer[i]));
  }
  assert.equal(dubbelSleutel(invoer[0]), dubbelSleutel({ ...invoer[0] })); // ontdubbeling ziet de bron (scrapeRun)
  const terug = shows.map(({ titelBron, ...x }) => ({ ...x, titel: titelBron ?? x.titel }));
  assert.deepEqual(pasMeerderheidToe(terug).shows, shows);
});
