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
  naSpeeldag,
  laatsteBezoek,
  sorteerGezien,
  laadGezien,
  bezoekVan,
  bezoekUitShow,
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
// 5 okt 2026, 00:00 in Amsterdam (zomertijd, UTC+2): de eerste minuut
// waarop 4 okt voorbij is. Los van de tijdzone van de testmachine.
const NA = new Date('2026-10-04T22:00:00Z');
const VOOR = new Date('2026-10-04T21:59:00Z');

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

test('"voorbij" vanaf 00:00 in Amsterdam op de dag ná de speeldatum (zomer- en wintertijd)', () => {
  assert.equal(isVoorbij('2026-10-04', VOOR), false);
  assert.equal(isVoorbij('2026-10-04', NA), true);
  assert.equal(isVoorbij('2026-10-04', new Date('2026-10-04T10:00:00Z')), false); // middagvoorstelling, zelfde dag
  // Wintertijd (UTC+1): 31 dec is voorbij om 23:00 UTC.
  assert.equal(isVoorbij('2026-12-31', new Date('2026-12-31T22:59:00Z')), false);
  assert.equal(isVoorbij('2026-12-31', new Date('2026-12-31T23:00:00Z')), true); // jaarwisseling
  // naSpeeldag ligt nooit na middernacht in Amsterdam.
  assert.ok(naSpeeldag('2026-10-04') <= NA.getTime());
  assert.ok(naSpeeldag('2026-12-31') <= new Date('2026-12-31T23:00:00Z').getTime());
  assert.ok(naSpeeldag('2026-10-04') > new Date('2026-10-04T21:00:00Z').getTime());
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
  // Volledig bezoek uit de momentopname van het plan (de voorstelling is al uit de data).
  assert.deepEqual(r.gezien.gezien[0].bezoeken, [
    { datum: '2026-10-04', tijd: '20:30', theaterId: 'delamar', theaterNaam: 'DeLaMar', stad: 'Amsterdam', titel: 'Prikkelarme kermis – Sara Kroos', status: 'kaarten' },
  ]);
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

test('ook zonder kaarten (status "Gepland") automatisch naar Gezien en uit de planning', () => {
  const gepland = planMet('gepland');
  const stand = { gepland, gezien: legeGezien(), watchlist: legeWatchlist() };
  assert.equal(verwerkVoorbijePlannen(stand, { index: indexeerShows([]), nu: VOOR, now: 100 }).gewijzigd, false);
  const r = verwerkVoorbijePlannen(stand, { index: indexeerShows([]), nu: NA, now: 100 });
  assert.equal(r.gewijzigd, true);
  assert.equal(r.gepland.gepland.length, 0);
  assert.equal(r.gezien.gezien.length, 1);
  assert.equal(r.gezien.gezien[0].bron, 'planning');
  assert.equal(r.gezien.gezien[0].bezoeken[0].status, 'gepland');
});

test('plan dat vroeger op "Ben je geweest?" wachtte (weken voorbij): bij openen naar Gezien', () => {
  // Plan van 4 okt zonder kaarten, app pas op 20 okt weer geopend.
  const stand = { gepland: planMet('gepland'), gezien: legeGezien(), watchlist: legeWatchlist() };
  const r = verwerkVoorbijePlannen(stand, { index: indexeerShows([]), nu: new Date('2026-10-20T08:00:00Z'), now: 5000 });
  assert.equal(r.gepland.gepland.length, 0);
  assert.equal(r.gezien.gezien[0].bezoeken[0].datum, '2026-10-04');
});

test('"Niet meer in de agenda" (geen afgelast) zonder kaarten: ook naar Gezien', () => {
  const index = indexeerShows([show({ id: 'ander', titel: 'Iets anders' })]);
  const r = verwerkVoorbijePlannen({ gepland: planMet('gepland'), gezien: legeGezien(), watchlist: legeWatchlist() }, { index, nu: NA, now: 100 });
  assert.equal(r.gezien.gezien.length, 1);
});

test('gedeeld plan (planId, met wie): naar Gezien met "met @…" in het bezoek', () => {
  let gepland = planMet('gepland');
  gepland = { ...gepland, gepland: [{ ...gepland.gepland[0], planId: 'p1', metWie: ['@bob', '@cleo'] }] };
  const r = verwerkVoorbijePlannen({ gepland, gezien: legeGezien(), watchlist: legeWatchlist() }, { index: indexeerShows([]), nu: NA, now: 100 });
  assert.deepEqual(r.gezien.gezien[0].bezoeken[0].metWie, ['@bob', '@cleo']);
  assert.equal(r.gepland.gepland.length, 0);
});

test('nieuw Gezien-item krijgt toegevoegdOp net na de speeldag, op elk apparaat hetzelfde', () => {
  const stand = { gepland: planMet('gepland'), gezien: legeGezien(), watchlist: legeWatchlist() };
  const later = Date.parse('2026-10-09T10:00:00Z');
  const a = verwerkVoorbijePlannen(stand, { nu: new Date(later), now: later });
  const b = verwerkVoorbijePlannen(stand, { nu: new Date(later + 3600e3), now: later + 3600e3 });
  assert.equal(a.gezien.gezien[0].toegevoegdOp, naSpeeldag('2026-10-04'));
  assert.equal(b.gezien.gezien[0].toegevoegdOp, naSpeeldag('2026-10-04'));
  // Stond hij al op Gezien (eerder bezoek), dan blijft dat item en komt het bezoek erbij.
  const al = zetGezien(legeGezien(), { show: show(), bron: 'handmatig', bezoek: { datum: '2026-01-10', tijd: null, theaterId: 'carre' } }, 7);
  const c = verwerkVoorbijePlannen({ ...stand, gezien: al }, { nu: new Date(later), now: later });
  assert.equal(c.gezien.gezien.length, 1);
  assert.equal(c.gezien.gezien[0].toegevoegdOp, 7);
  assert.equal(c.gezien.gezien[0].bezoeken.length, 2);
});

test('ten onrechte op Gezien: weghalen, en het komt niet terug (ook niet via een ander apparaat met oude gegevens)', () => {
  const stand = { gepland: planMet('gepland'), gezien: legeGezien(), watchlist: legeWatchlist() };
  const t1 = Date.parse('2026-10-05T07:00:00Z');
  // Apparaat A verwerkt het plan en de gebruiker haalt het weg.
  const a = verwerkVoorbijePlannen(stand, { nu: new Date(t1), now: t1 });
  const sleutel = a.gezien.gezien[0].sleutel;
  const aWeg = { ...a, gezien: haalUitGezien(a.gezien, sleutel, t1 + 60e3) };
  assert.equal(aWeg.gezien.gezien.length, 0);
  // A opnieuw openen: niets terug (het plan is al uit de planning).
  assert.equal(verwerkVoorbijePlannen(aWeg, { nu: new Date(t1 + 120e3), now: t1 + 120e3 }).gewijzigd, false);
  // Apparaat B (offline, oude stand met het plan nog in de planning) verwerkt het later zelf.
  const t2 = t1 + 86400e3;
  const b = verwerkVoorbijePlannen(stand, { nu: new Date(t2), now: t2 });
  assert.equal(b.gezien.gezien.length, 1);
  // Sync: het weghalen van A wint, in beide volgordes; de planning blijft leeg.
  for (const samen of [voegGezienSamen(aWeg.gezien, b.gezien), voegGezienSamen(b.gezien, aWeg.gezien)]) {
    assert.equal(samen.gezien.length, 0);
    assert.equal(samen.gezienVerwijderd[0].sleutel, sleutel);
  }
  const plan = laadGepland({ opgeslagen: aWeg.gepland, extra: b.gepland }).profiel;
  assert.equal(plan.gepland.length, 0);
  // Daarna opnieuw verwerken (zoals na elke sync): blijft weg.
  const na = verwerkVoorbijePlannen(
    { gepland: plan, gezien: voegGezienSamen(aWeg.gezien, b.gezien), watchlist: legeWatchlist() },
    { nu: new Date(t2 + 1000), now: t2 + 1000 }
  );
  assert.equal(na.gewijzigd, false);
  assert.equal(na.gezien.gezien.length, 0);
});

test('later opnieuw dezelfde voorstelling gepland en gezien: verschijnt weer, ondanks het eerdere weghalen', () => {
  const t1 = Date.parse('2026-10-05T07:00:00Z');
  const a = verwerkVoorbijePlannen({ gepland: planMet('gepland'), gezien: legeGezien(), watchlist: legeWatchlist() }, { nu: new Date(t1), now: t1 });
  const weg = haalUitGezien(a.gezien, a.gezien.gezien[0].sleutel, t1 + 60e3);
  const nieuwPlan = planIn(legeGepland(), show({ datum: '2026-11-14', theaterId: 'carre' }), t1 + 1e5);
  const t3 = Date.parse('2026-11-15T09:00:00Z');
  const r = verwerkVoorbijePlannen({ gepland: nieuwPlan, gezien: weg, watchlist: legeWatchlist() }, { nu: new Date(t3), now: t3 });
  assert.equal(r.gezien.gezien.length, 1);
  assert.deepEqual(r.gezien.gezien[0].bezoeken.map((b) => b.datum), ['2026-11-14']);
});

test('net verwerkt plan staat bovenaan Gezien (nieuwste eerst)', () => {
  const eerder = zetGezien(legeGezien(), { show: show({ titel: 'Titanique' }), bron: 'handmatig', bezoek: { datum: '2026-09-20', tijd: '20:00', theaterId: 'x' } }, 5);
  const r = verwerkVoorbijePlannen({ gepland: planMet('gepland'), gezien: eerder, watchlist: legeWatchlist() }, { nu: NA, now: 100 });
  assert.equal(sorteerGezien(r.gezien.gezien)[0].sleutel, 'prikkelarme kermis | sara kroos');
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
  // Ook een "Gepland"-plan: weg, niet naar Gezien.
  const gm = laadGepland({ opgeslagen: planMet('gepland'), index }).profiel;
  const rg = verwerkVoorbijePlannen({ gepland: gm, gezien: legeGezien(), watchlist: legeWatchlist() }, { nu: NA, now: 100 });
  assert.equal(rg.gepland.gepland.length, 0);
  assert.equal(rg.gezien.gezien.length, 0);
  // Afgelast via de agenda (plan zonder markering, voorstelling nog in de data): ook niet.
  const viaAgenda = verwerkVoorbijePlannen({ gepland: planMet('gepland'), gezien: legeGezien(), watchlist: legeWatchlist() }, { index, nu: NA, now: 100 });
  assert.equal(viaAgenda.gezien.gezien.length, 0);
  assert.equal(viaAgenda.gepland.gepland.length, 0);
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

test('verplaatst (ook met kaarten): niet naar Gezien, uit de planning (op die datum niet gespeeld)', () => {
  // Via het vervallen-veld in het plan (de voorstelling is na de datum uit de data)...
  const index = indexeerShows([show({ beschikbaarheid: 'verplaatst' })]);
  const plan = laadGepland({ opgeslagen: planMet('kaarten'), index }).profiel;
  assert.equal(plan.gepland[0].vervallen, 'verplaatst');
  const stand = { gepland: plan, gezien: legeGezien(), watchlist: legeWatchlist() };
  const r = verwerkVoorbijePlannen(stand, { index: indexeerShows([]), nu: NA, now: 100 });
  assert.equal(r.gewijzigd, true);
  assert.equal(r.gepland.gepland.length, 0);
  assert.equal(r.gezien.gezien.length, 0);
  // ... en via de agenda (voorstelling staat er nog als verplaatst), ook zonder kaarten.
  const viaAgenda = verwerkVoorbijePlannen({ ...stand, gepland: planMet('gepland') }, { index, nu: NA, now: 100 });
  assert.equal(viaAgenda.gezien.gezien.length, 0);
  assert.equal(viaAgenda.gepland.gepland.length, 0);
  // Vóór de speeldag blijft hij staan (met de melding "Verplaatst" bij het plan).
  assert.equal(verwerkVoorbijePlannen(stand, { index, nu: VOOR, now: 100 }).gewijzigd, false);
});

// ---------- Volledige bezoekgegevens (1 okt 2026) ----------

const maaspoortShow = (extra = {}) => ({
  id: 'mp-1',
  titel: 'Enfin, Barbin',
  maker: 'Marleen Hendrickx',
  genre: 'Toneel',
  theaterId: 'maaspoort',
  theaterNaam: 'De Maaspoort Theater & Events',
  stad: 'Venlo',
  locatie: 'Theater De Garage | Venlo',
  datum: '2026-10-04',
  tijd: '20:15',
  reserverenUrl: 'https://www.maaspoort.nl/programma/enfin-barbin/04-10-2026-20-15/',
  beschikbaarheid: 'beschikbaar',
  ...extra,
});

test('plan bewaart maker, genre en locatie; na de datum staat alles in het bezoek (kaarten, externe locatie)', () => {
  let gepland = planIn(legeGepland(), maaspoortShow(), 1);
  assert.equal(gepland.gepland[0].maker, 'Marleen Hendrickx');
  assert.equal(gepland.gepland[0].locatie, 'Theater De Garage | Venlo');
  gepland = zetStatus(gepland, gepland.gepland[0].sleutel, 'kaarten', 2);
  // Na de datum is de voorstelling uit de data: alles komt uit de momentopname.
  const r = verwerkVoorbijePlannen({ gepland, gezien: legeGezien(), watchlist: legeWatchlist() }, { index: indexeerShows([]), nu: NA, now: 100 });
  assert.deepEqual(r.gezien.gezien[0].bezoeken[0], {
    datum: '2026-10-04',
    tijd: '20:15',
    theaterId: 'maaspoort',
    theaterNaam: 'De Maaspoort Theater & Events',
    stad: 'Venlo',
    locatie: 'Theater De Garage | Venlo',
    titel: 'Enfin, Barbin – Marleen Hendrickx',
    maker: 'Marleen Hendrickx',
    genre: 'Toneel',
    status: 'kaarten',
    url: 'https://www.maaspoort.nl/programma/enfin-barbin/04-10-2026-20-15/',
  });
});

test('automatisch zonder kaarten: volledig bezoek met status gepland; live voorstelling vult aan', () => {
  const gepland = planIn(legeGepland(), { ...show(), maker: null, genre: null }, 1); // oud plan zonder extra's
  const stand = { gepland, gezien: legeGezien(), watchlist: legeWatchlist() };
  // De voorstelling staat (nog) in de data, met genre: dat komt in het bezoek.
  const index = indexeerShows([show({ genre: 'Cabaret', zaal: 'Grote zaal' })]);
  const ja = verwerkVoorbijePlannen(stand, { index, nu: NA, now: 200 });
  const b = ja.gezien.gezien[0].bezoeken[0];
  assert.equal(b.status, 'gepland');
  assert.equal(b.genre, 'Cabaret');
  assert.equal(b.zaal, 'Grote zaal');
  assert.equal(b.titel, 'Prikkelarme kermis – Sara Kroos');
  assert.equal(b.stad, 'Amsterdam');
});

test('oud plan wordt aangevuld zolang de voorstelling in de agenda staat (tijdstempels gelijk)', () => {
  const oud = planIn(legeGepland(), { ...maaspoortShow(), maker: null, genre: null, locatie: null }, 1);
  assert.equal(oud.gepland[0].maker, undefined);
  const index = indexeerShows([maaspoortShow()]);
  const aangevuld = laadGepland({ opgeslagen: oud, index }).profiel.gepland[0];
  assert.equal(aangevuld.maker, 'Marleen Hendrickx');
  assert.equal(aangevuld.locatie, 'Theater De Garage | Venlo');
  assert.equal(aangevuld.gewijzigdOp, oud.gepland[0].gewijzigdOp);
  // Ander apparaat met een nieuwere status maar zonder extra's: blijft aangevuld.
  const anders = zetStatus(oud, oud.gepland[0].sleutel, 'kaarten', 50);
  const samen = laadGepland({ opgeslagen: { gepland: [aangevuld], geplandVerwijderd: [] }, extra: anders }).profiel.gepland[0];
  assert.equal(samen.status, 'kaarten');
  assert.equal(samen.maker, 'Marleen Hendrickx');
});

test('oude bezoeken zonder extra velden blijven werken; twee kopieën vullen elkaar aan', () => {
  const oud = { gezien: [{ sleutel: 'k', titel: 'K', toegevoegdOp: 5, bezoeken: [{ datum: '2026-09-01', tijd: null, theaterId: 'x' }] }], gezienVerwijderd: [] };
  const geladen = laadGezien({ opgeslagen: oud });
  assert.deepEqual(geladen.profiel.gezien[0].bezoeken, [{ datum: '2026-09-01', tijd: null, theaterId: 'x' }]);
  assert.equal(laadGezien({ opgeslagen: geladen.profiel }).gewijzigd, false);
  // Hetzelfde bezoek met extra's van een ander apparaat: één bezoek, aangevuld.
  const rijk = { gezien: [{ ...oud.gezien[0], bezoeken: [{ datum: '2026-09-01', tijd: null, theaterId: 'x', stad: 'Venlo', genre: 'Dans' }] }], gezienVerwijderd: [] };
  for (const samen of [voegGezienSamen(oud, rijk), voegGezienSamen(rijk, oud)]) {
    assert.equal(samen.gezien[0].bezoeken.length, 1);
    assert.equal(samen.gezien[0].bezoeken[0].stad, 'Venlo');
    assert.equal(samen.gezien[0].bezoeken[0].genre, 'Dans');
  }
});

test('meerdere bezoeken met gegevens: één item, nieuwste eerst via laatsteBezoek', () => {
  let g = zetGezien(legeGezien(), { show: show(), bron: 'planning', bezoek: bezoekVan({ ...planIn(legeGepland(), show(), 1).gepland[0], status: 'kaarten' }) }, 1);
  const tweede = planIn(legeGepland(), show({ theaterId: 'carre', theaterNaam: 'Koninklijk Theater Carré', datum: '2026-12-03', tijd: null }), 2).gepland[0];
  g = zetGezien(g, { show: show(), bron: 'planning', bezoek: bezoekVan(tweede) }, 2);
  assert.equal(g.gezien[0].bezoeken.length, 2);
  assert.equal(laatsteBezoek(g.gezien[0]).theaterNaam, 'Koninklijk Theater Carré');
  assert.equal(laatsteBezoek(g.gezien[0]).status, 'gepland');
});

test('bezoekUitShow: handmatig op een voorbije speeldatum', () => {
  const b = bezoekUitShow(maaspoortShow());
  assert.equal(b.datum, '2026-10-04');
  assert.equal(b.locatie, 'Theater De Garage | Venlo');
  assert.equal(b.titel, 'Enfin, Barbin – Marleen Hendrickx');
  assert.equal(b.status, undefined);
});

// ---------- Beoordeling (1 okt 2026) ----------

test('beoordeling: 1 t/m 5 in stappen van 0,5; 0,5, 5,5 en 3,3 geweigerd', async () => {
  const { zetBeoordeling, isGeldigeBeoordeling, beoordelingTekst } = await import('../public/js/gezien.js');
  for (let w = 1; w <= 5; w += 0.5) assert.equal(isGeldigeBeoordeling(w), true, String(w));
  for (const w of [0, 0.5, 5.5, 3.3, NaN, '4', null, undefined]) assert.equal(isGeldigeBeoordeling(w), false, String(w));
  const g = zetGezien(legeGezien(), { show: show(), bron: 'handmatig' }, 1);
  const k = g.gezien[0].sleutel;
  assert.throws(() => zetBeoordeling(g, k, 0.5));
  assert.throws(() => zetBeoordeling(g, k, 5.5));
  const b = zetBeoordeling(g, k, 4.5, 10);
  assert.equal(b.gezien[0].beoordeling, 4.5);
  assert.equal(b.gezien[0].beoordeeldOp, 10);
  assert.equal(beoordelingTekst(4.5), '4,5');
  assert.equal(beoordelingTekst(3), '3');
  // Wissen: veld weg, beoordeeldOp nieuw.
  const w = zetBeoordeling(b, k, null, 20);
  assert.equal('beoordeling' in w.gezien[0], false);
  assert.equal(w.gezien[0].beoordeeldOp, 20);
  // Onbekend item: niets.
  assert.equal(zetBeoordeling(g, 'bestaat niet', 3), g);
});

test('beoordeling sync: nieuwste beoordeeldOp wint, wissen synchroniseert, los van bezoeken', async () => {
  const { zetBeoordeling } = await import('../public/js/gezien.js');
  const basis = zetGezien(legeGezien(), { show: show(), bron: 'handmatig' }, 1);
  const k = basis.gezien[0].sleutel;
  const a = zetBeoordeling(basis, k, 3, 10);
  const b = zetBeoordeling(basis, k, 4.5, 20);
  for (const samen of [voegGezienSamen(a, b), voegGezienSamen(b, a)]) assert.equal(samen.gezien[0].beoordeling, 4.5);
  const gewist = zetBeoordeling(b, k, null, 30);
  for (const samen of [voegGezienSamen(a, b, gewist), voegGezienSamen(gewist, b, a)]) {
    assert.equal('beoordeling' in samen.gezien[0], false);
    assert.equal(samen.gezien[0].beoordeeldOp, 30);
  }
  // Een later bezoek (nieuwere gewijzigdOp, oude beoordeling) gooit de nieuwere beoordeling niet weg.
  const metBezoek = zetGezien(a, { show: show(), bron: 'planning', bezoek: { datum: '2026-10-04', tijd: '20:30', theaterId: 'delamar' } }, 40);
  assert.equal(voegGezienSamen(metBezoek, b).gezien[0].beoordeling, 4.5);
  assert.equal(voegGezienSamen(metBezoek, b).gezien[0].bezoeken.length, 1);
});

test('beoordeling: item weghalen neemt de beoordeling mee; oude items zonder beoordeling werken', async () => {
  const { zetBeoordeling } = await import('../public/js/gezien.js');
  const g = zetBeoordeling(zetGezien(legeGezien(), { show: show(), bron: 'handmatig' }, 1), 'prikkelarme kermis | sara kroos', 4, 5);
  const weg = haalUitGezien(g, 'prikkelarme kermis | sara kroos', 10);
  assert.equal(voegGezienSamen(g, weg).gezien.length, 0);
  // Opnieuw toevoegen: zonder de oude beoordeling.
  const terug = zetGezien(weg, { show: show(), bron: 'handmatig' }, 20);
  assert.equal('beoordeling' in voegGezienSamen(g, weg, terug).gezien[0], false);
  const oud = { gezien: [{ sleutel: 'x', titel: 'X', toegevoegdOp: 1, bezoeken: [] }], gezienVerwijderd: [] };
  assert.equal(laadGezien({ opgeslagen: oud }).gewijzigd, false);
  assert.equal('beoordeeldOp' in laadGezien({ opgeslagen: oud }).profiel.gezien[0], false);
});

// ---------- Maker en genre aanvullen (okt 2026) ----------

import { infoPerSleutel, vulGezienAan, gezienVeld } from '../public/js/gezien.js';
import { kopieGezien } from '../public/js/gedeeld.js';

const teckelZelf = () => ({
  sleutel: 'teckel',
  titel: 'Teckel',
  sleutelTitel: 'Teckel',
  theaterId: 'stadsschouwburgutrecht',
  bron: 'handmatig',
  toegevoegdOp: 1000,
  gewijzigdOp: 1000,
  v: 4,
  bezoeken: [],
});
const teckelShows = [
  { titel: 'Teckel', theaterId: 'stadsschouwburgutrecht', maker: 'Nina van Tongeren / Theater Bellevue', genre: 'Toneel' },
  { titel: 'Teckel', theaterId: 'bellevue', maker: 'Nina van Tongeren / Theater Bellevue', genre: 'Toneel' },
];

test('infoPerSleutel: alleen als alle speeldata het eens zijn', () => {
  const info = infoPerSleutel([...teckelShows, { titel: 'Nora', theaterId: 'a', maker: 'X' }, { titel: 'Tiresias', theaterId: 'a', maker: 'A' }, { titel: 'Tiresias', theaterId: 'b', maker: 'B', genre: 'Toneel' }]);
  assert.deepEqual(info.get('teckel'), { maker: 'Nina van Tongeren / Theater Bellevue', genre: 'Toneel' });
  // Theatergebonden titel: eigen sleutel.
  assert.ok(info.has('a::nora'));
  // Twee verschillende makers (gelijke stand): geen maker, wel het genre.
  assert.deepEqual(info.get('tiresias'), { genre: 'Toneel' });
  // Oude data zonder maker/genre: niets.
  assert.equal(infoPerSleutel([{ titel: 'Teckel', theaterId: 'x' }]).size, 0);
});

test('vulGezienAan: zelf aangevinkt item zonder maker krijgt maker en genre, tijdstempels gelijk, idempotent', () => {
  const profiel = { gezien: [teckelZelf()], gezienVerwijderd: [] };
  const { profiel: uit, gewijzigd } = vulGezienAan(profiel, infoPerSleutel(teckelShows));
  assert.equal(gewijzigd, true);
  assert.equal(uit.gezien[0].maker, 'Nina van Tongeren / Theater Bellevue');
  assert.equal(uit.gezien[0].genre, 'Toneel');
  assert.equal(uit.gezien[0].gewijzigdOp, 1000);
  assert.equal(uit.gezien[0].toegevoegdOp, 1000);
  assert.equal(vulGezienAan(uit, infoPerSleutel(teckelShows)).gewijzigd, false);
  // Productie niet in de agenda: niets.
  assert.equal(vulGezienAan(profiel, new Map()).gewijzigd, false);
});

test('vulGezienAan: nooit een bestaande maker of genre overschrijven (item of bezoek)', () => {
  const eigen = { ...teckelZelf(), maker: 'Nina van Tongeren' };
  const metBezoek = { ...teckelZelf(), sleutel: 'teckel', bezoeken: [{ datum: '2026-09-30', tijd: null, theaterId: 'ssu', maker: 'Bellevue', genre: 'Overig' }] };
  const info = infoPerSleutel(teckelShows);
  assert.equal(vulGezienAan({ gezien: [eigen] }, info).profiel.gezien[0].maker, 'Nina van Tongeren');
  const r = vulGezienAan({ gezien: [metBezoek] }, info);
  assert.equal(r.gewijzigd, false);
  assert.equal(gezienVeld(r.profiel.gezien[0], 'maker'), 'Bellevue');
});

test('laadGezien met info: aanvullen telt als wijziging; zonder info en bij oude items zonder velden blijft alles', () => {
  const opgeslagen = { gezien: [teckelZelf()], gezienVerwijderd: [] };
  const r = laadGezien({ opgeslagen, info: infoPerSleutel(teckelShows) });
  assert.equal(r.gewijzigd, true);
  assert.equal(r.profiel.gezien[0].maker, 'Nina van Tongeren / Theater Bellevue');
  assert.equal(laadGezien({ opgeslagen }).gewijzigd, false);
  assert.equal(laadGezien({ opgeslagen: {} }).gewijzigd, false);
});

test('samenvoegen: een kopie mét maker vult een nieuwere kopie zonder maker aan', () => {
  const oud = { ...teckelZelf(), maker: 'Nina van Tongeren / Theater Bellevue', genre: 'Toneel' };
  const nieuw = { ...teckelZelf(), gewijzigdOp: 5000, beoordeling: 4, beoordeeldOp: 5000 };
  const { gezien } = voegGezienSamen({ gezien: [oud] }, { gezien: [nieuw] });
  assert.equal(gezien[0].maker, 'Nina van Tongeren / Theater Bellevue');
  assert.equal(gezien[0].genre, 'Toneel');
  assert.equal(gezien[0].gewijzigdOp, 5000);
});

test('zetGezien bewaart maker en genre van de voorstelling op het item', () => {
  const p = zetGezien(legeGezien(), { show: teckelShows[0], bron: 'handmatig' }, 1);
  assert.equal(p.gezien[0].maker, 'Nina van Tongeren / Theater Bellevue');
  assert.equal(p.gezien[0].genre, 'Toneel');
  const zonder = zetGezien(legeGezien(), { show: { titel: 'Teckel', theaterId: 'x' }, bron: 'handmatig' }, 1);
  assert.equal('maker' in zonder.gezien[0], false);
});

test('kopie voor vrienden: maker van het item als de voorstelling niet in de agenda staat', () => {
  const item = { ...teckelZelf(), maker: 'Nina van Tongeren / Theater Bellevue', genre: 'Toneel' };
  const [k] = kopieGezien({ gezien: [item] });
  assert.equal(k.maker, 'Nina van Tongeren / Theater Bellevue');
  assert.equal(k.genre, 'Toneel');
  // Een bezoek met maker gaat voor het item.
  const [k2] = kopieGezien({ gezien: [{ ...item, bezoeken: [{ datum: '2026-09-30', maker: 'Bezoek' }] }] });
  assert.equal(k2.maker, 'Bezoek');
});

test('Alain Clark → Date Night (okt 2026): Gezien-item migreert met bezoeken en sterren; niet na de einddatum, niet als de oude sleutel nog in de agenda staat', async () => {
  const { pasGezienMappingToe } = await import('../public/js/gezien.js');
  const item = {
    sleutel: 'alain clark', titel: 'Alain Clark – Date Night', sleutelTitel: 'Alain Clark', theaterId: 'stoep', bron: 'planning',
    toegevoegdOp: 10, gewijzigdOp: 10, v: 4, beoordeling: 4.5, beoordeeldOp: 11,
    bezoeken: [{ datum: '2026-10-09', tijd: '20:15', theaterId: 'stoep' }],
  };
  const r = laadGezien({ opgeslagen: { gezien: [item], gezienVerwijderd: [] }, bekend: new Map() });
  assert.equal(r.gewijzigd, true);
  const [n] = r.profiel.gezien;
  assert.equal(n.sleutel, 'date night');
  assert.equal(n.titel, 'Date Night – Alain Clark');
  assert.equal(n.beoordeling, 4.5);
  assert.equal(n.bezoeken.length, 1);
  assert.equal(laadGezien({ opgeslagen: r.profiel, bekend: new Map() }).gewijzigd, false);
  // Samen met een bestaand "date night"-item: één item, beide bezoeken.
  const al = { ...item, sleutel: 'date night', bezoeken: [{ datum: '2026-10-07', tijd: '20:15', theaterId: 'omval' }] };
  const samen = pasGezienMappingToe({ gezien: [item, al], gezienVerwijderd: [] }, new Map()).profiel;
  assert.equal(samen.gezien.length, 1);
  assert.equal(samen.gezien[0].bezoeken.length, 2);
  // Oude sleutel nog in de agenda, of bezoek na de einddatum: niets.
  assert.equal(pasGezienMappingToe({ gezien: [item] }, new Map([['alain clark', 'Alain Clark']])).gewijzigd, false);
  assert.equal(pasGezienMappingToe({ gezien: [{ ...item, bezoeken: [{ datum: '2027-03-01', theaterId: 'x' }] }] }, new Map()).gewijzigd, false);
  // Zonder `bekend` (oude aanroep) blijft alles zoals het was.
  assert.equal(laadGezien({ opgeslagen: { gezien: [item] } }).profiel.gezien[0].sleutel, 'alain clark');
  // De rest van TITEL_MAPPING geldt niet voor Gezien.
  const babel = { ...item, sleutel: 'babel', titel: 'Babel', bezoeken: [{ datum: '2026-10-02', theaterId: 'x' }] };
  assert.equal(pasGezienMappingToe({ gezien: [babel] }, new Map()).gewijzigd, false);
});
