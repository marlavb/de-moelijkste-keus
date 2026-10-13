// Kaart bij Mijn theaters (okt 2026): de coördinaten in config.js (met bron,
// binnen Nederland, plausibel per stad), theaters.json, en de pure functies
// van public/js/kaart.js.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { THEATERS } from '../src/lib/config.js';
import { buildTheatersJson } from '../src/lib/theatersJson.js';
import { kaartTheaters, aantalTekst, LEAFLET_BESTANDEN } from '../public/js/kaart.js';

// Nog zonder coördinaten, met reden (zie config.js).
const NOG_OPEN = new Set(['agnietenhof']);
const NL = { latMin: 50.75, latMax: 53.56, lngMin: 3.35, lngMax: 7.23 };
const km = (a, b) => {
  const r = Math.PI / 180;
  const x = Math.sin(((b.lat - a.lat) * r) / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(((b.lng - a.lng) * r) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(x));
};

test('kaart: elk theater heeft coördinaten met bron, binnen Nederland', () => {
  for (const t of THEATERS) {
    if (NOG_OPEN.has(t.id)) {
      assert.equal(t.locatie, null, `${t.id}: nog open, dus null`);
      continue;
    }
    assert.ok(t.locatie, `${t.id} heeft geen locatie`);
    const { lat, lng, bron } = t.locatie;
    assert.ok(Number.isFinite(lat) && Number.isFinite(lng), t.id);
    assert.ok(lat > NL.latMin && lat < NL.latMax && lng > NL.lngMin && lng < NL.lngMax, `${t.id} ligt buiten Nederland: ${lat},${lng}`);
    assert.ok(typeof bron === 'string' && bron.length > 10 && /20\d\d/.test(bron), `${t.id}: bron met datum`);
  }
  assert.ok(THEATERS.filter((t) => t.locatie).length >= 80);
});

test('kaart: theaters in dezelfde stad liggen dicht bij elkaar (geen verwisselde of verkeerde plek)', () => {
  const perStad = new Map();
  for (const t of THEATERS.filter((x) => x.locatie)) {
    if (!perStad.has(t.stad)) perStad.set(t.stad, []);
    perStad.get(t.stad).push(t);
  }
  for (const [stad, lijst] of perStad) {
    for (const a of lijst) for (const b of lijst) {
      // Amsterdam is groot (Bijlmer, Nieuw-West); verder ruim binnen 12 km.
      const grens = stad === 'Amsterdam' ? 16 : 12;
      assert.ok(km(a.locatie, b.locatie) < grens, `${a.id} en ${b.id} (${stad}) liggen ${km(a.locatie, b.locatie).toFixed(1)} km uit elkaar`);
    }
  }
});

test('kaart: theaters.json krijgt lat/lng (zonder bron) en gepauzeerd', () => {
  const { theaters } = buildTheatersJson(THEATERS);
  const delamar = THEATERS.find((t) => t.id === 'delamar');
  assert.deepEqual([theaters.delamar.lat, theaters.delamar.lng], [delamar.locatie.lat, delamar.locatie.lng]);
  assert.equal(theaters.delamar.bron, undefined);
  for (const t of THEATERS.filter((x) => x.gepauzeerd)) assert.equal(theaters[t.id].gepauzeerd, true, t.id);
  assert.equal('lat' in theaters.agnietenhof, false);
});

test('kaart: per theater aan/uit, aantal komende voorstellingen en actief', () => {
  const info = {
    a: { naam: 'Bellevue', stad: 'Amsterdam', lat: 52.36, lng: 4.88 },
    b: { naam: 'Agnietenhof', stad: 'Tiel', gepauzeerd: true, lat: 51.88, lng: 5.43 },
    c: { naam: 'Zonder plek', stad: 'X' },
    d: { naam: 'Corrosia', stad: 'Almere', lat: 52.34, lng: 5.22 },
  };
  const shows = [
    { theaterId: 'a', datum: '2026-10-12' },
    { theaterId: 'a', datum: '2026-10-13' },
    { theaterId: 'a', datum: '2026-11-01' },
    { theaterId: 'b', datum: '2026-10-20' },
  ];
  const uit = kaartTheaters(info, shows, { d: false }, '2026-10-13');
  assert.deepEqual(uit.map((t) => [t.id, t.aan, t.aantal, t.actief]), [
    ['b', true, 1, false], // gepauzeerd: lichter, ook met data
    ['a', true, 2, true], // de voorstelling van gisteren telt niet
    ['d', false, 0, false],
  ]);
  assert.equal(aantalTekst(0), 'Geen komende voorstellingen');
  assert.equal(aantalTekst(1), '1 komende voorstelling');
  assert.equal(aantalTekst(12), '12 komende voorstellingen');
});

test('kaart: Leaflet van cdnjs met SRI, dezelfde bestanden als de npm-pakketten', async () => {
  const { createHash } = await import('node:crypto');
  const { readFileSync } = await import('node:fs');
  const lokaal = {
    'leaflet/1.9.4/leaflet.css': 'leaflet/dist/leaflet.css',
    'leaflet/1.9.4/leaflet.js': 'leaflet/dist/leaflet.js',
    'leaflet.markercluster/1.5.3/MarkerCluster.css': 'leaflet.markercluster/dist/MarkerCluster.css',
    'leaflet.markercluster/1.5.3/leaflet.markercluster.js': 'leaflet.markercluster/dist/leaflet.markercluster.js',
  };
  for (const b of LEAFLET_BESTANDEN) {
    assert.match(b.url, /^https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\//);
    const pad = lokaal[b.url.replace('https://cdnjs.cloudflare.com/ajax/libs/', '')];
    const hash = 'sha384-' + createHash('sha384').update(readFileSync(new URL(`../node_modules/${pad}`, import.meta.url))).digest('base64');
    assert.equal(b.sri, hash, b.url);
  }
});
