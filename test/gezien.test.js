// Tests voor Gezien (public/js/gezien.js) en de koppeling met planning en
// watchlist. Geen netwerk, geen browser.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  legeGezien,
  voegGezienSamen,
  zetGezien,
  haalUitGezien,
  gezienSleutels,
  zonderGezien,
  isVoorbij,
  verwerkVoorbijePlannen,
  vragenOver,
  beantwoord,
  laatsteBezoek,
  sorteerGezien,
  laadGezien,
} from '../public/js/gezien.js';
import { planIn, zetStatus, legeGepland, indexeerShows, laadGepland } from '../public/js/gepland.js';
import { watchlistSleutel, voegToe, legeWatchlist, verwijder } from '../public/js/watchlist.js';

const show = (extra = {}) => ({
  id: 'dlm-1',
  titel: 'Prikkelarme kermis – Sara Kroos',
  theaterId: 'delamar',
  theaterNaam: 'DeLaMar',
  stad: 'Amsterdam',
  datum: '2026-10-04',
  tijd: '20:30',
  beschikbaarheid: 'beschikbaar',
  maker: null,
  ...extra,
});
// 5 okt 2026, 00:00 lokale tijd: de eerste minuut waarop 4 okt voorbij is.
const NA = new Date(2026, 9, 5, 0, 0);
const VOOR = new Date(2026, 9, 4, 23, 59);

function planMet(status, extra = {}, now = 1) {
  let g = planIn(legeGepland(), show(extra), now);
  if (status === 'kaarten') g = zetStatus(g, g.gepland[0].sleutel, 'kaarten', now + 1);
  return g;
}

test('sleutel = watchlist-sleutel (v4, volgorde-onafhankelijk, uitsluitlijst)', () => {
  const p = zetGezien(legeGezien(), { show: show(), bron: 'handmatig' }, 5);
  assert.equal(p.gezien[0].sleutel, watchlistSleutel('Sara Kroos – Prikkelarme kermis', 'x'));
  assert.equal(p.gezien[0].sleutel, 'prikkelarme kermis | sara kroos');
  // Theatergebonden titel (uitsluitlijst): sleutel met theater erin.
  const nora = zetGezien(legeGezien(), { show: show({ titel: 'Nora', theaterId: 'ita' }), bron: 'handmatig' }, 5);
  assert.equal(nora.gezien[0].sleutel, watchlistSleutel('Nora', 'ita'));
  assert.match(nora.gezien[0].sleutel, /^ita::/);
  assert.equal(nora.gezien[0].v, 4);
  assert.deepEqual(nora.gezien[0].bezoeken, []);
});

test('"voorbij" vanaf 00:00 lokale tijd op de dag ná de speeldatum', () => {
  assert.equal(isVoorbij('2026-10-04', VOOR), false);
  assert.equal(isVoorbij('2026-10-04', NA), true);
  assert.equal(isVoorbij('2026-10-04', new Date(2026, 9, 4, 12, 0)), false); // middagvoorstelling, zelfde dag
  assert.equal(isVoorbij('2026-12-31', new Date(2027, 0, 1, 0, 0)), true); // jaarwisseling
});

test('kaarten → Gezien (met bezoek), uit de planning en van de watchlist', () => {
  const gepland = planMet('kaarten');
  const watchlist = voegToe(legeWatchlist(), { titel: show().titel, theaterId: 'delamar' }, 1);
  const index = indexeerShows([]); // na de datum staat de voorstelling niet meer in de data
  const r = verwerkVoorbijePlannen({ gepland, gezien: legeGezien(), watchlist }, { index, nu: NA, now: 100 });
  assert.equal(r.gewijzigd, true);
  assert.equal(r.gepland.gepland.length, 0);
  assert.equal(r.gezien.gezien.length, 1);
  assert.equal(r.gezien.gezien[0].bron, 'planning');
  assert.deepEqual(r.gezien.gezien[0].bezoeken, [{ datum: '2026-10-04', tijd: '20:30', theaterId: 'delamar' }]);
  assert.equal(r.watchlist.watchlist.length, 0);
  assert.equal(r.watchlist.watchlistVerwijderd[0].sleutel, 'prikkelarme kermis | sara kroos');
  // Vóór middernacht: niets.
  const eerder = verwerkVoorbijePlannen({ gepland, gezien: legeGezien(), watchlist }, { index, nu: VOOR, now: 100 });
  assert.equal(eerder.gewijzigd, false);
});

test('kaarten ook bij "Niet meer in de agenda" en "Tijd gewijzigd"', () => {
  const gepland = planMet('kaarten');
  // Tijd gewijzigd: voorstelling staat (nog) in de data met een andere tijd.
  const index = indexeerShows([show({ tijd: '21:00' })]);
  const r = verwerkVoorbijePlannen({ gepland, gezien: legeGezien(), watchlist: legeWatchlist() }, { index, nu: NA, now: 100 });
  assert.equal(r.gezien.gezien.length, 1);
  // Het bezoek komt uit de momentopname van het plan.
  assert.equal(r.gezien.gezien[0].bezoeken[0].tijd, '20:30');
});

test('gepland → vraag; ja → Gezien en uit de planning; nee → alleen uit de planning', () => {
  const gepland = planMet('gepland');
  const stand = { gepland, gezien: legeGezien(), watchlist: legeWatchlist() };
  const verwerkt = verwerkVoorbijePlannen(stand, { index: indexeerShows([]), nu: NA, now: 100 });
  assert.equal(verwerkt.gewijzigd, false); // niet automatisch
  const vragen = vragenOver(gepland, { index: indexeerShows([]), nu: NA });
  assert.equal(vragen.length, 1);
  assert.equal(vragenOver(gepland, { nu: VOOR }).length, 0);

  const ja = beantwoord(stand, vragen[0], true, { now: 200 });
  assert.equal(ja.gepland.gepland.length, 0);
  assert.equal(ja.gezien.gezien.length, 1);
  assert.equal(ja.gezien.gezien[0].bezoeken.length, 1);

  const nee = beantwoord(stand, vragen[0], false, { now: 200 });
  assert.equal(nee.gepland.gepland.length, 0);
  assert.equal(nee.gezien.gezien.length, 0);
  assert.equal(vragenOver(nee.gepland, { nu: NA }).length, 0);
});

test('afgelast → nooit naar Gezien, stil uit de planning (ook als hij al uit de data is)', () => {
  // Zolang de voorstelling in de agenda staat, onthoudt het plan dat hij afgelast is.
  const index = indexeerShows([show({ beschikbaarheid: 'afgelast' })]);
  const gemarkeerd = laadGepland({ opgeslagen: planMet('kaarten'), index }).profiel;
  assert.equal(gemarkeerd.gepland[0].vervallen, 'afgelast');
  // Na de datum is hij uit de data: toch niet naar Gezien.
  const r = verwerkVoorbijePlannen(
    { gepland: gemarkeerd, gezien: legeGezien(), watchlist: legeWatchlist() },
    { index: indexeerShows([]), nu: NA, now: 100 }
  );
  assert.equal(r.gepland.gepland.length, 0);
  assert.equal(r.gezien.gezien.length, 0);
  // Ook een "Gepland"-plan: geen vraag.
  const gm = laadGepland({ opgeslagen: planMet('gepland'), index }).profiel;
  assert.equal(vragenOver(gm, { nu: NA }).length, 0);
  // De markering blijft staan als een ander apparaat een nieuwere status heeft.
  const anderApparaat = zetStatus(planMet('gepland'), gm.gepland[0].sleutel, 'kaarten', 50);
  assert.equal(laadGepland({ opgeslagen: gm, extra: anderApparaat }).profiel.gepland[0].vervallen, 'afgelast');
  assert.equal(laadGepland({ opgeslagen: gm, extra: anderApparaat }).profiel.gepland[0].status, 'kaarten');
});

test('idempotent: twee keer verwerken geeft niets nieuws', () => {
  const stand = { gepland: planMet('kaarten'), gezien: legeGezien(), watchlist: legeWatchlist() };
  const een = verwerkVoorbijePlannen(stand, { nu: NA, now: 100 });
  const twee = verwerkVoorbijePlannen(een, { nu: NA, now: 200 });
  assert.equal(twee.gewijzigd, false);
  assert.deepEqual(twee.gezien, een.gezien);
  assert.deepEqual(twee.gepland, een.gepland);
});

test('twee apparaten verwerken hetzelfde plan: één item, één bezoek', () => {
  const stand = { gepland: planMet('kaarten'), gezien: legeGezien(), watchlist: legeWatchlist() };
  const a = verwerkVoorbijePlannen(stand, { nu: NA, now: 100 });
  const b = verwerkVoorbijePlannen(stand, { nu: NA, now: 150 });
  const samen = voegGezienSamen(a.gezien, b.gezien);
  assert.equal(samen.gezien.length, 1);
  assert.equal(samen.gezien[0].bezoeken.length, 1);
  // Daarna op A opnieuw laden (met B's cloud): planning blijft leeg, niets dubbel.
  const plan = laadGepland({ opgeslagen: a.gepland, extra: b.gepland }).profiel;
  assert.equal(plan.gepland.length, 0);
  assert.equal(verwerkVoorbijePlannen({ gepland: plan, gezien: samen, watchlist: legeWatchlist() }, { nu: NA }).gewijzigd, false);
});

test('tweede bezoek aan dezelfde voorstelling: één item, twee bezoeken, laatste bovenaan', () => {
  let g = zetGezien(legeGezien(), { show: show(), bron: 'planning', bezoek: { datum: '2026-10-04', tijd: '20:30', theaterId: 'delamar' } }, 1);
  g = zetGezien(g, { show: show({ theaterId: 'carre' }), bron: 'planning', bezoek: { datum: '2026-12-03', tijd: null, theaterId: 'carre' } }, 2);
  assert.equal(g.gezien.length, 1);
  assert.equal(g.gezien[0].bezoeken.length, 2);
  assert.equal(laatsteBezoek(g.gezien[0]).theaterId, 'carre');
  // Hetzelfde bezoek nog eens: niet dubbel.
  g = zetGezien(g, { show: show(), bron: 'planning', bezoek: { datum: '2026-10-04', tijd: '20:30', theaterId: 'delamar' } }, 3);
  assert.equal(g.gezien[0].bezoeken.length, 2);
});

test('tombstones: weghalen wint van een oudere kopie op een ander apparaat; opnieuw toevoegen wint weer', () => {
  const a = zetGezien(legeGezien(), { show: show(), bron: 'handmatig' }, 10);
  const weg = haalUitGezien(a, a.gezien[0].sleutel, 20);
  assert.equal(voegGezienSamen(a, weg).gezien.length, 0);
  assert.equal(voegGezienSamen(weg, a).gezien.length, 0);
  const terug = zetGezien(weg, { show: show(), bron: 'handmatig' }, 30);
  const samen = voegGezienSamen(a, weg, terug);
  assert.equal(samen.gezien.length, 1);
  assert.equal(samen.gezienVerwijderd.length, 0);
  // Laden is idempotent.
  const l = laadGezien({ opgeslagen: samen });
  assert.equal(laadGezien({ opgeslagen: l.profiel }).gewijzigd, false);
});

test('handmatig: van de watchlist af, en ongedaan maken draait beide terug', () => {
  const s = show();
  const sleutel = watchlistSleutel(s.titel, s.theaterId);
  const wl0 = voegToe(legeWatchlist(), { titel: s.titel, theaterId: s.theaterId }, 1);
  // Aanvinken (zoals app.js): Gezien erbij, watchlist-tombstone.
  const gz1 = zetGezien(legeGezien(), { show: s, bron: 'handmatig' }, 10);
  const wl1 = verwijder(wl0, sleutel, 10);
  assert.equal(wl1.watchlist.length, 0);
  // Ongedaan maken: Gezien-tombstone, watchlist weer toevoegen (nieuwere tijd).
  const gz2 = haalUitGezien(gz1, sleutel, 11);
  const wl2 = voegToe(wl1, { titel: s.titel, theaterId: s.theaterId }, 11);
  assert.equal(gz2.gezien.length, 0);
  assert.equal(wl2.watchlist.length, 1);
  // Ook na samenvoegen met een apparaat dat de tussenstand al had.
  assert.equal(voegGezienSamen(gz1, gz2).gezien.length, 0);
});

test('filter "Verberg gezien"', () => {
  const shows = [show(), show({ id: 'x', titel: 'Titanique' }), show({ id: 'y', titel: 'Sara Kroos - Prikkelarme Kermis', theaterId: 'carre' })];
  const g = zetGezien(legeGezien(), { show: show(), bron: 'handmatig' }, 1);
  assert.deepEqual(zonderGezien(shows, gezienSleutels(g)).map((s) => s.id), ['x']);
  assert.equal(zonderGezien(shows, gezienSleutels(legeGezien())).length, 3);
});

test('sorteren: laatste bezoek eerst, zonder bezoek op toegevoegdOp', () => {
  const items = [
    { sleutel: 'a', toegevoegdOp: new Date(2026, 9, 10).getTime(), bezoeken: [] },
    { sleutel: 'b', toegevoegdOp: 1, bezoeken: [{ datum: '2026-10-20', tijd: '20:00', theaterId: 'x' }] },
    { sleutel: 'c', toegevoegdOp: 1, bezoeken: [{ datum: '2026-09-01', tijd: null, theaterId: 'x' }] },
  ];
  assert.deepEqual(sorteerGezien(items).map((i) => i.sleutel), ['b', 'a', 'c']);
});

test('verplaatst (ook met kaarten) → vraag, niet automatisch Gezien en niet stil weg', () => {
  // Via het vervallen-veld in het plan (de voorstelling is na de datum uit de data)...
  const index = indexeerShows([show({ beschikbaarheid: 'verplaatst' })]);
  const plan = laadGepland({ opgeslagen: planMet('kaarten'), index }).profiel;
  assert.equal(plan.gepland[0].vervallen, 'verplaatst');
  const stand = { gepland: plan, gezien: legeGezien(), watchlist: legeWatchlist() };
  const r = verwerkVoorbijePlannen(stand, { index: indexeerShows([]), nu: NA, now: 100 });
  assert.equal(r.gewijzigd, false);
  assert.equal(r.gepland.gepland.length, 1);
  assert.equal(r.gezien.gezien.length, 0);
  const vragen = vragenOver(plan, { index: indexeerShows([]), nu: NA });
  assert.equal(vragen.length, 1);
  assert.equal(vragen[0].verplaatst, true);
  // ... en via de agenda (voorstelling staat er nog als verplaatst), ook zonder kaarten.
  assert.equal(vragenOver(planMet('gepland'), { index, nu: NA })[0].verplaatst, true);
  assert.equal(verwerkVoorbijePlannen({ ...stand, gepland: planMet('kaarten') }, { index, nu: NA }).gewijzigd, false);
  // Ja → Gezien, Nee → alleen uit de planning.
  const ja = beantwoord(stand, vragen[0], true, { now: 200 });
  assert.equal(ja.gezien.gezien.length, 1);
  assert.equal(ja.gepland.gepland.length, 0);
  const nee = beantwoord(stand, vragen[0], false, { now: 200 });
  assert.equal(nee.gezien.gezien.length, 0);
  assert.equal(nee.gepland.gepland.length, 0);
  // Afgelast blijft stil weg.
  const afgelast = laadGepland({ opgeslagen: planMet('kaarten'), index: indexeerShows([show({ beschikbaarheid: 'afgelast' })]) }).profiel;
  assert.equal(vragenOver(afgelast, { nu: NA }).length, 0);
  assert.equal(verwerkVoorbijePlannen({ ...stand, gepland: afgelast }, { nu: NA, now: 100 }).gepland.gepland.length, 0);
});
