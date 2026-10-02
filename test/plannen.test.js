// Gedeelde plannen (vrienden, stap 4): de pure delen van public/js/plannen.js,
// planId en metWie in gepland.js en gezien.js, en dat metWie niet in de
// kopie voor vrienden komt. De rules worden getest met de emulator
// (firebase/tests/plannen.test.js).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  speeldagVan,
  amsterdamDatum,
  isNogTePlannen,
  voorstellingVan,
  isPlanVoorbij,
  metWie,
  metWieRegels,
  uitnodigingStand,
  MAX_GENODIGDEN,
} from '../public/js/plannen.js';
import {
  planIn,
  zetStatus,
  haalUitPlanning,
  voegGeplandSamen,
  laadGepland,
  koppelPlan,
  zetMetWie,
  indexeerShows,
  legeGepland,
} from '../public/js/gepland.js';
import { planNaarGezien, legeGezien } from '../public/js/gezien.js';
import { legeWatchlist } from '../public/js/watchlist.js';
import { kopieGezien } from '../public/js/gedeeld.js';

const SHOW = { id: 's1', titel: 'Grip – Rayen Panday', theaterId: 'delamar', theaterNaam: 'DeLaMar', stad: 'Amsterdam', datum: '2026-10-18', tijd: '20:15', reserverenUrl: 'https://x', maker: 'Rayen Panday', genre: 'Cabaret' };

test('speeldag: middernacht UTC; vandaag of later is nog te plannen', () => {
  assert.equal(speeldagVan('2026-10-18').toISOString(), '2026-10-18T00:00:00.000Z');
  assert.equal(isNogTePlannen('2026-10-18', '2026-10-18'), true);
  assert.equal(isNogTePlannen('2026-10-17', '2026-10-18'), false);
  assert.equal(MAX_GENODIGDEN, 10);
});

test('momentopname van de voorstelling: alleen titel, theater, stad, datum en tijd', () => {
  const item = planIn(legeGepland(), SHOW, 1).gepland[0];
  assert.deepEqual(voorstellingVan(item), { titel: SHOW.titel, theaterId: 'delamar', theaterNaam: 'DeLaMar', stad: 'Amsterdam', datum: '2026-10-18', tijd: '20:15' });
});

test('plan voorbij: na middernacht in Amsterdam (18 okt = zomertijd, UTC+2)', () => {
  const plan = { speeldag: speeldagVan('2026-10-18') };
  assert.equal(isPlanVoorbij(plan, Date.parse('2026-10-18T21:59:59Z')), false); // 23:59:59 Amsterdam
  assert.equal(isPlanVoorbij(plan, Date.parse('2026-10-18T22:00:00Z')), true); // 00:00 Amsterdam, in UTC nog de 18e
  assert.equal(isPlanVoorbij({ speeldag: { toMillis: () => Date.UTC(2026, 9, 18) } }, Date.UTC(2026, 9, 17)), false);
  // Met voorstelling: de datum daaruit.
  assert.equal(isPlanVoorbij({ voorstelling: { datum: '2026-10-18' }, speeldag: 0 }, Date.parse('2026-10-18T21:00:00Z')), false);
});

test('rond middernacht in zomertijd (UTC+2): Amsterdam, niet UTC', () => {
  assert.equal(amsterdamDatum(Date.parse('2026-07-15T21:59:59Z')), '2026-07-15');
  assert.equal(amsterdamDatum(Date.parse('2026-07-15T22:00:00Z')), '2026-07-16');
  assert.equal(amsterdamDatum(Date.parse('2026-07-14T22:30:00Z')), '2026-07-15'); // 00:30, UTC zegt nog de 14e
  assert.equal(isNogTePlannen('2026-07-15', amsterdamDatum(Date.parse('2026-07-15T21:59:59Z'))), true);
  assert.equal(isNogTePlannen('2026-07-15', amsterdamDatum(Date.parse('2026-07-15T22:00:00Z'))), false);
  const plan = { voorstelling: { datum: '2026-07-15' }, speeldag: speeldagVan('2026-07-15') };
  assert.equal(uitnodigingStand({ plan, leden: [{ uid: 'b', status: 'uitgenodigd' }] }, 'b', Date.parse('2026-07-15T21:59:59Z')), 'open');
  assert.equal(uitnodigingStand({ plan, leden: [{ uid: 'b', status: 'uitgenodigd' }] }, 'b', Date.parse('2026-07-15T22:00:00Z')), 'verlopen');
});

test('rond middernacht in wintertijd (UTC+1): Amsterdam, niet UTC', () => {
  assert.equal(amsterdamDatum(Date.parse('2026-01-15T22:59:59Z')), '2026-01-15');
  assert.equal(amsterdamDatum(Date.parse('2026-01-15T23:00:00Z')), '2026-01-16');
  assert.equal(amsterdamDatum(Date.parse('2026-01-14T23:30:00Z')), '2026-01-15');
  const plan = { voorstelling: { datum: '2026-01-15' }, speeldag: speeldagVan('2026-01-15') };
  assert.equal(isPlanVoorbij(plan, Date.parse('2026-01-15T22:59:59Z')), false);
  assert.equal(isPlanVoorbij(plan, Date.parse('2026-01-15T23:00:00Z')), true);
  // De wissel naar wintertijd (25 okt 2026, 03:00 → 02:00) en naar zomertijd (29 mrt 2026).
  assert.equal(amsterdamDatum(Date.parse('2026-10-25T22:59:59Z')), '2026-10-25');
  assert.equal(amsterdamDatum(Date.parse('2026-10-25T23:00:00Z')), '2026-10-26');
  assert.equal(amsterdamDatum(Date.parse('2026-03-29T21:59:59Z')), '2026-03-29');
  assert.equal(amsterdamDatum(Date.parse('2026-03-29T22:00:00Z')), '2026-03-30');
});

const INFO = {
  plan: { eigenaar: 'a', speeldag: speeldagVan('2026-10-18'), opgeheven: false },
  leden: [
    { uid: 'a', rol: 'organisator', status: 'gaat', kaarten: true },
    { uid: 'b', rol: 'gast', status: 'gaat', kaarten: false },
    { uid: 'c', rol: 'gast', status: 'uitgenodigd' },
    { uid: 'd', rol: 'gast', status: 'kan-niet' },
    { uid: 'e', rol: 'gast', status: 'weg' },
  ],
};
const naam = (uid) => (uid === 'e' ? 'iemand' : `@${uid}`);

test('met wie: de organisator ziet ook open, kan niet en gaat niet meer', () => {
  assert.deepEqual(metWieRegels(metWie(INFO, 'a', naam)), ['Met @b', '@c heeft nog niet gereageerd', '@d kan niet', 'iemand gaat niet meer']);
});

test('met wie: een gast ziet alleen wie er meegaan, met kaarten ✓', () => {
  assert.deepEqual(metWieRegels(metWie(INFO, 'b', naam)), ['Met @a (kaarten ✓)']);
  assert.deepEqual(metWieRegels(metWie({ ...INFO, leden: INFO.leden.slice(0, 1) }, 'a', naam)), []);
});

test('stand van een uitnodiging voor de ontvanger', () => {
  const voor = Date.UTC(2026, 9, 10);
  const na = Date.UTC(2026, 9, 20);
  assert.equal(uitnodigingStand(INFO, 'c', voor), 'open');
  assert.equal(uitnodigingStand(INFO, 'c', na), 'verlopen');
  assert.equal(uitnodigingStand(INFO, 'b', voor), 'gaat');
  assert.equal(uitnodigingStand(INFO, 'd', voor), 'kan-niet');
  assert.equal(uitnodigingStand(INFO, 'e', voor), 'weg');
  assert.equal(uitnodigingStand(INFO, 'x', voor), 'ingetrokken');
  assert.equal(uitnodigingStand(null, 'c', voor), 'ingetrokken');
  assert.equal(uitnodigingStand({ ...INFO, plan: { ...INFO.plan, opgeheven: true } }, 'c', voor), 'opgeheven');
});

// ---------- planId blijft staan (ook voor oudere app-versies) ----------

test('planId: koppelPlan is een handeling (nieuwe gewijzigdOp)', () => {
  const p = koppelPlan(planIn(legeGepland(), SHOW, 1), planIn(legeGepland(), SHOW, 1).gepland[0].sleutel, 'P1', 5);
  assert.equal(p.gepland[0].planId, 'P1');
  assert.equal(p.gepland[0].gewijzigdOp, 5);
});

test('planId: direct na planIn in dezelfde milliseconde gekoppeld, blijft staan', () => {
  const p = planIn(legeGepland(), SHOW, 7);
  const k = koppelPlan(p, p.gepland[0].sleutel, 'P1', 7);
  assert.equal(k.gepland[0].planId, 'P1');
  assert.equal(k.gepland[0].gewijzigdOp, 8);
});

test('planId blijft staan bij samenvoegen, status wisselen en laden met de agenda', () => {
  let p = planIn(legeGepland(), SHOW, 1);
  const sleutel = p.gepland[0].sleutel;
  p = koppelPlan(p, sleutel, 'P1', 2);
  // Samenvoegen met een ander apparaat (oudere kopie zonder planId).
  const ouder = planIn(legeGepland(), SHOW, 1);
  assert.equal(voegGeplandSamen(ouder, p).gepland[0].planId, 'P1');
  assert.equal(voegGeplandSamen(p, ouder).gepland[0].planId, 'P1');
  // Status wisselen (ook zoals een oude app-versie dat doet: zetStatus kopieert het item).
  assert.equal(zetStatus(p, sleutel, 'kaarten', 3).gepland[0].planId, 'P1');
  // Laden met de agenda (werkPlannenBij, markeerVervallen, vulInfoAan).
  const geladen = laadGepland({ opgeslagen: p, index: indexeerShows([{ ...SHOW, beschikbaarheid: 'afgelast' }]) }).profiel;
  assert.equal(geladen.gepland[0].planId, 'P1');
  assert.equal(geladen.gepland[0].vervallen, 'afgelast');
  // JSON heen en terug (Firestore/localStorage) laat het veld staan.
  assert.equal(laadGepland({ opgeslagen: JSON.parse(JSON.stringify(p)) }).profiel.gepland[0].planId, 'P1');
});

test('uit de planning halen en opnieuw plannen: geen oude planId', () => {
  let p = koppelPlan(planIn(legeGepland(), SHOW, 1), planIn(legeGepland(), SHOW, 1).gepland[0].sleutel, 'P1', 2);
  p = haalUitPlanning(p, p.gepland[0].sleutel, 3);
  p = planIn(p, SHOW, 4);
  assert.equal(p.gepland[0].planId, undefined);
});

test('metWie: momentopname zonder tijdstempel; naar het bezoek in Gezien; niet in de kopie voor vrienden', () => {
  let p = koppelPlan(planIn(legeGepland(), SHOW, 1), planIn(legeGepland(), SHOW, 1).gepland[0].sleutel, 'P1', 2);
  const sleutel = p.gepland[0].sleutel;
  const r = zetMetWie(p, sleutel, ['@b', '@a', '@b']);
  assert.equal(r.gewijzigd, true);
  assert.deepEqual(r.profiel.gepland[0].metWie, ['@a', '@b']);
  assert.equal(r.profiel.gepland[0].gewijzigdOp, 2);
  assert.equal(zetMetWie(r.profiel, sleutel, ['@a', '@b']).gewijzigd, false);
  assert.equal(zetMetWie(r.profiel, sleutel, []).profiel.gepland[0].metWie, undefined);

  const item = r.profiel.gepland[0];
  const stand = planNaarGezien({ gepland: r.profiel, gezien: legeGezien(), watchlist: legeWatchlist() }, item, null, 10);
  assert.deepEqual(stand.gezien.gezien[0].bezoeken[0].metWie, ['@a', '@b']);
  const kopie = kopieGezien(stand.gezien);
  assert.ok(!JSON.stringify(kopie).includes('@a'), JSON.stringify(kopie));
  assert.ok(!JSON.stringify(kopie).includes('metWie'));
});
