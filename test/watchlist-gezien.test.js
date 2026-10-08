// Watchlist en Gezien (okt 2026): op Gezien = van de watchlist af, alleen bij
// de overgang; daarna opnieuw toevoegen blijft staan; opruiming van wat nu
// op beide staat. Geen netwerk, geen browser.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { markeerHandmatig, ruimWatchlistOp, planNaarGezien, legeGezien, zetGezien, naSpeeldag, laadGezien } from '../public/js/gezien.js';
import { voegToe, legeWatchlist, watchlistSleutel, laadWatchlist, samenvoegMapping } from '../public/js/watchlist.js';
import { legeGepland, planIn } from '../public/js/gepland.js';

const SHOW = { id: 'dlm-1', titel: 'Prikkelarme kermis – Sara Kroos', theaterId: 'delamar', datum: '2026-12-04', tijd: '20:30' };
const K = watchlistSleutel(SHOW.titel, SHOW.theaterId);
const T = (dag, uur = 12) => Date.UTC(2026, 9, dag, uur); // okt 2026
const opWatchlist = (w, k = K) => w.watchlist.some((i) => i.sleutel === k);

test('overgang (handmatig): op Gezien → van de watchlist af, met tombstone en het weggehaalde item', () => {
  const watchlist = voegToe(legeWatchlist(), SHOW, T(1));
  const r = markeerHandmatig({ gezien: legeGezien(), watchlist }, SHOW, null, T(2));
  assert.equal(opWatchlist(r.watchlist), false);
  assert.deepEqual(r.watchlist.watchlistVerwijderd, [{ sleutel: K, verwijderdOp: T(2) }]);
  assert.equal(r.watchItem.sleutel, K);
  assert.equal(r.gezien.gezien[0].sleutel, K);
  // Niet op de watchlist: niets te doen, geen item.
  const zonder = markeerHandmatig({ gezien: legeGezien(), watchlist: legeWatchlist() }, SHOW, null, T(2));
  assert.equal(zonder.watchItem, null);
  assert.deepEqual(zonder.watchlist, legeWatchlist());
});

test('overgang (vanuit Gepland, na de speeldag): ook van de watchlist af', () => {
  const watchlist = voegToe(legeWatchlist(), SHOW, T(1));
  const gepland = planIn(legeGepland(), SHOW, T(1));
  const plan = gepland.gepland[0];
  const r = planNaarGezien({ gepland, gezien: legeGezien(), watchlist }, plan, SHOW, Date.UTC(2026, 11, 5));
  assert.equal(opWatchlist(r.watchlist), false);
  assert.equal(r.gezien.gezien[0].toegevoegdOp, naSpeeldag('2026-12-04'));
});

test('opnieuw op de watchlist na Gezien: blijft staan (opruiming laat hem met rust)', () => {
  const eerst = markeerHandmatig({ gezien: legeGezien(), watchlist: voegToe(legeWatchlist(), SHOW, T(1)) }, SHOW, null, T(2));
  const weerOp = voegToe(eerst.watchlist, SHOW, T(3));
  assert.equal(opWatchlist(weerOp), true);
  const r = ruimWatchlistOp({ watchlist: weerOp, gezien: eerst.gezien }, T(4));
  assert.equal(r.gewijzigd, false);
  assert.equal(opWatchlist(r.watchlist), true);
});

test('opruiming: op beide → van de watchlist, behalve als het watchlist-item later is toegevoegd dan het laatste Gezien-moment', () => {
  const ander = { titel: 'Teckel', theaterId: 'ssu' };
  const derde = { titel: 'Dekpunt – Jan Beuving', theaterId: 'kunstlinie' };
  let watchlist = voegToe(legeWatchlist(), SHOW, T(1)); // vóór Gezien → weg
  watchlist = voegToe(watchlist, ander, T(9)); // ná Gezien → blijft
  watchlist = voegToe(watchlist, derde, T(1)); // niet op Gezien → blijft
  let gezien = zetGezien(legeGezien(), { show: SHOW, bron: 'handmatig' }, T(5));
  gezien = zetGezien(gezien, { show: ander, bron: 'handmatig' }, T(5));
  const r = ruimWatchlistOp({ watchlist, gezien }, T(10));
  assert.deepEqual(r.weg, [K]);
  assert.equal(opWatchlist(r.watchlist), false);
  assert.equal(opWatchlist(r.watchlist, 'teckel'), true);
  assert.equal(opWatchlist(r.watchlist, watchlistSleutel(derde.titel, derde.theaterId)), true);
  // Een later bezoek (gewijzigdOp) telt als laatste Gezien-moment.
  const metBezoek = zetGezien(gezien, { show: ander, bron: 'planning', bezoek: { datum: '2026-10-10', tijd: '20:00', theaterId: 'ssu' } }, T(11));
  assert.deepEqual(ruimWatchlistOp({ watchlist, gezien: metBezoek }, T(12)).weg.sort(), [K, 'teckel'].sort());
  // Idempotent: een tweede keer verandert niets.
  assert.equal(ruimWatchlistOp({ watchlist: r.watchlist, gezien }, T(11)).gewijzigd, false);
  // Oude favoriet (toegevoegdOp 0) gaat ook weg.
  const fav = { watchlist: [{ sleutel: K, titel: SHOW.titel, theaterId: 'delamar', toegevoegdOp: 0, v: 4 }], watchlistVerwijderd: [] };
  assert.equal(ruimWatchlistOp({ watchlist: fav, gezien }, T(10)).gewijzigd, true);
});

test('opruiming met samengevoegde sleutel: "Greg Shapiro" op de watchlist, "KING ME – Greg Shapiro" op Gezien', () => {
  // De agenda: titel die alleen de artiest was, samengevoegd tot de productie (titelBron).
  const shows = [
    { id: 'sgh-1', titel: 'KING ME – Greg Shapiro', titelBron: 'Greg Shapiro', theaterId: 'stadsgehoorzaal', datum: '2026-11-01' },
    { id: 'kk-1', titel: 'KING ME – Greg Shapiro', theaterId: 'kleinekomedie', datum: '2026-11-02' },
  ];
  const samenvoeging = samenvoegMapping(shows);
  const oudeWatchlist = voegToe(legeWatchlist(), { titel: 'Greg Shapiro', theaterId: 'stadsgehoorzaal' }, T(1));
  const gezienRuw = zetGezien(legeGezien(), { show: shows[1], bron: 'handmatig' }, T(3));
  const watchlist = laadWatchlist({ opgeslagen: oudeWatchlist, samenvoeging, mapping: new Map() }).profiel;
  const gezien = laadGezien({ opgeslagen: gezienRuw, samenvoeging }).profiel;
  const r = ruimWatchlistOp({ watchlist, gezien }, T(4));
  assert.deepEqual(r.weg, ['greg shapiro | king me']);
  assert.deepEqual(r.watchlist.watchlist, []);
});
