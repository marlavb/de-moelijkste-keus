import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseLandingWidget, bepaalLandingPodiumpas } from '../src/sites/amstelveen.js';

const WIDGET = (normaal, metPodiumpas = true) => `Kies aantal tickets
Amsterdam Klezmer Band
Theater De Landing
woensdag 30 september 2026 - 20:00 uur
Normaal
€ ${normaal}+ € 1,00 transactiekosten
€28,50
Voeg ticket toe
CJP
€ 25,50+ € 1,00 transactiekosten
Voeg ticket toe
${metPodiumpas ? 'Podiumpas\n€ 0,00\nUitsluitend voor Podiumpashouders.\nVoeg ticket toe' : ''}`;

const TM = 'https://apps.ticketmatic.com/widgets/schouwburg_amstelveen/addtickets?event=1';

test('widget lezen: reguliere prijs zonder transactiekosten, Podiumpas-prijstype', () => {
  assert.deepEqual(parseLandingWidget(WIDGET('27,50')), { leesbaar: true, heeftPodiumpas: true, laagsteRegulier: 27.5 });
  assert.equal(parseLandingWidget(WIDGET('27,50', false)).heeftPodiumpas, false);
  assert.equal(parseLandingWidget('Er ging iets mis').leesbaar, false);
});

test('bestellink van derden → false, ook zonder widget', () => {
  const r = bepaalLandingPodiumpas({ orderHref: 'https://patronstage.com/event/double-dutch', beschikbaarheid: 'beschikbaar', widget: null });
  assert.deepEqual(r, { podiumpas: false, reden: 'verkoop via patronstage.com' });
});

test('widget met Podiumpas-prijstype → true', () => {
  const r = bepaalLandingPodiumpas({ orderHref: TM, beschikbaarheid: 'beschikbaar', widget: parseLandingWidget(WIDGET('27,50')) });
  assert.equal(r.podiumpas, true);
});

test('widget zonder Podiumpas-prijstype, beschikbaar → false', () => {
  const r = bepaalLandingPodiumpas({ orderHref: TM, beschikbaarheid: 'beschikbaar', widget: parseLandingWidget(WIDGET('27,50', false)) });
  assert.deepEqual(r, { podiumpas: false, reden: 'geen Podiumpas-prijstype' });
});

test('widget onbereikbaar of onleesbaar → blijft true', () => {
  assert.equal(bepaalLandingPodiumpas({ orderHref: TM, beschikbaarheid: 'beschikbaar', widget: { fout: 'Timeout' } }).podiumpas, true);
  assert.equal(bepaalLandingPodiumpas({ orderHref: TM, beschikbaarheid: 'beschikbaar', widget: parseLandingWidget('leeg') }).podiumpas, true);
});

test('uitverkocht/wachtlijst zonder prijstype → blijft true', () => {
  for (const b of ['uitverkocht', 'wachtlijst']) {
    assert.equal(bepaalLandingPodiumpas({ orderHref: TM, beschikbaarheid: b, widget: parseLandingWidget(WIDGET('27,50', false)) }).podiumpas, true, b);
  }
});

test('laagste reguliere prijs boven €50 → false', () => {
  const r = bepaalLandingPodiumpas({ orderHref: TM, beschikbaarheid: 'beschikbaar', widget: parseLandingWidget(WIDGET('54,50')) });
  assert.deepEqual(r, { podiumpas: false, reden: 'prijs €54.5' });
});

test('verder dan 30 dagen (geen widget bezocht) → true', () => {
  assert.equal(bepaalLandingPodiumpas({ orderHref: TM, beschikbaarheid: 'beschikbaar', widget: null }).podiumpas, true);
});
