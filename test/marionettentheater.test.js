import { test } from 'node:test';
import assert from 'node:assert/strict';

import { normalizeSlug, classifyMarionetItem } from '../src/sites/marionettentheater.js';

const REPERTOIRE = new Set(['luchtkasteel', 'vliegendehollander', 'toverfluit', 'faust', 'impresario', 'wijdewereld', 'bastien']);

test('normalizeSlug: schema, host, slash en hoofdletters maken niet uit', () => {
  for (const href of ['http://marionettentheater.nl/impresario/', 'https://www.marionettentheater.nl/Impresario', '/impresario/', 'impresario']) {
    assert.equal(normalizeSlug(href), 'impresario', href);
  }
  assert.equal(normalizeSlug(null), null);
});

const impresario = {
  titel: 'De Impresario – W.A. Mozart',
  detailHref: 'https://www.marionettentheater.nl/impresario',
  buttons: [{ text: 'Info', href: 'https://www.marionettentheater.nl/impresario' }, { text: 'Tickets', href: 'https://www.marionettentheater.nl/tickets' }],
};
const gast = (titel, info) => ({ titel, detailHref: null, buttons: [{ text: 'Info', href: info }, { text: 'Free', href: null }] });

test('data van nu: De Impresario true, gastitems false, geen waarschuwing', () => {
  assert.deepEqual(classifyMarionetItem(impresario, REPERTOIRE), { podiumpas: true, warn: null });
  for (const item of [gast('Turkish Movie Night', 'https://www.marionettentheater.nl/turkishmovie/'), gast('Underground Cinema', 'https://www.marionettentheater.nl/cinemasoon')]) {
    assert.deepEqual(classifyMarionetItem(item, REPERTOIRE), { podiumpas: false, warn: null }, item.titel);
  }
});

test('onbekende productie mét eigen Tickets-knop → false + waarschuwing', () => {
  const nieuw = {
    titel: 'Pinokkio',
    detailHref: null,
    buttons: [{ text: 'Info', href: '/pinokkio/' }, { text: 'Tickets', href: 'https://www.marionettentheater.nl/tickets/' }],
  };
  const r = classifyMarionetItem(nieuw, REPERTOIRE);
  assert.equal(r.podiumpas, false);
  assert.match(r.warn, /Pinokkio.*niet op de repertoirepagina/);
});
