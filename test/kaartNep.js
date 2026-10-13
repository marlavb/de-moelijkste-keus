// Kaart in de tests (okt 2026), zonder netwerk naar buiten: Leaflet van
// cdnjs komt uit node_modules (zelfde bestanden, dus de SRI klopt), tegels
// van OpenStreetMap worden een doorzichtig plaatje, en data/theaters.json
// komt vers uit config.js (met de coördinaten). Te gebruiken vóór een
// algemene "abort alles van buiten"-route (Playwright neemt de laatst
// toegevoegde route eerst).

import { readFile } from 'node:fs/promises';
import { THEATERS } from '../src/lib/config.js';
import { buildTheatersJson } from '../src/lib/theatersJson.js';

const NM = new URL('../node_modules/', import.meta.url);
const CDN = {
  'leaflet/1.9.4/leaflet.css': ['leaflet/dist/leaflet.css', 'text/css'],
  'leaflet/1.9.4/leaflet.js': ['leaflet/dist/leaflet.js', 'text/javascript'],
  'leaflet.markercluster/1.5.3/MarkerCluster.css': ['leaflet.markercluster/dist/MarkerCluster.css', 'text/css'],
  'leaflet.markercluster/1.5.3/leaflet.markercluster.js': ['leaflet.markercluster/dist/leaflet.markercluster.js', 'text/javascript'],
};
// 1×1 doorzichtige PNG.
const LEEG_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');

export async function routeKaart(ctx, { tegels = [] } = {}) {
  await ctx.route(/^https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\//, async (r) => {
    const sleutel = r.request().url().replace('https://cdnjs.cloudflare.com/ajax/libs/', '');
    const [bestand, type] = CDN[sleutel] ?? [];
    if (!bestand) return r.abort();
    r.fulfill({ status: 200, contentType: type, headers: { 'access-control-allow-origin': '*' }, body: await readFile(new URL(bestand, NM)) });
  });
  await ctx.route(/^https:\/\/([a-c]\.)?tile\.openstreetmap\.org\//, (r) => {
    tegels.push(r.request().url());
    r.fulfill({ status: 200, contentType: 'image/png', headers: { 'access-control-allow-origin': '*' }, body: LEEG_PNG });
  });
  await ctx.route(/\/data\/theaters\.json(\?.*)?$/, (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify(buildTheatersJson(THEATERS)) }));
}
