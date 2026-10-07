// Musis en Stadstheater Arnhem: de echte scraper op een nagebouwde API en
// detailpagina's (opbouw zoals op 7 okt 2026), in Chromium, zonder netwerk.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';

const dir = await mkdtemp(path.join(os.tmpdir(), 'musis-'));
process.env.DETAIL_CACHE_DIR = dir;
const { scrapeMusisGroep, musisPlek } = await import('../src/sites/musis.js');
const { THEATERS } = await import('../src/lib/config.js');
const theater = THEATERS.find((t) => t.id === 'musis');

const prod = (slug, title, performer, tags) => ({ slug, title, performer, tags: tags.map((name) => ({ name })) });
const PRODUCTIES = {
  blauwdruk: prod('blauwdruk', 'Laatste kaarten...', 'Collectief Blauwdruk', ['Toneel', 'Tips voor studenten']),
  rekhalzen: prod('rekhalzen', 'Rekhalzen (Verplaatst)', 'Yentl en de Boer', ['Cabaret']),
  '40up': prod('40up', "40 UP - Let's dance again!", 'Tijdmachine Tour', ['Dansfeest', 'Gastprogramma', 'Pop']),
  kerk: prod('kerk', 'Nederlandse Bachvereniging', 'Allerzielen', ['Koormuziek']),
  serie: prod('serie', 'Serie: Kijk op theater', null, ['Serie']),
  tar: prod('tar', 'Residentie', 'TAR', ['Toneel']),
  toonkunst: prod('toonkunst', 'Arnhem, mijn stadje.', 'Arnhems Promenade Orkest', ['Orkestraal']),
};
const ev = (id, slug, startsAt, soldOut = false) => ({ id, production: PRODUCTIES[slug], startsAt, soldOut });
const EVENTS = [
  [ev(1, 'blauwdruk', '2026-12-11T19:00:00+01:00'), ev(2, 'blauwdruk', '2026-12-12T20:00:00+01:00'), ev(3, 'rekhalzen', '2026-11-05T20:15:00+01:00', true)],
  [ev(4, '40up', '2026-12-11T20:00:00+01:00'), ev(5, 'kerk', '2027-03-26T19:30:00+01:00'), ev(6, 'serie', '2026-11-01T14:00:00+01:00'), ev(7, 'tar', '2026-11-02T20:00:00+01:00'), ev(8, 'toonkunst', '2027-01-10T15:00:00+01:00')],
];
const DETAIL = {
  blauwdruk: ['Musis, Parkzaal', 'https://tix.musisenstadstheater.nl/nl/tickets/1', ''],
  rekhalzen: ['Musis Arnhem, Arnhem, Muzenzaal', 'https://tix.musisenstadstheater.nl/nl/tickets/3', ''],
  '40up': ['Musis Arnhem, Parkzaal', 'https://www.40up.nl/agenda/tijdmachine-arnhem/', 'Ticketverkoop verloopt via de organisator, je wordt doorgestuurd.'],
  kerk: ['Eusebiuskerk, Externe locatie', 'https://tix.musisenstadstheater.nl/nl/tickets/5', ''],
  tar: ['Theater a/d Rijn, Externe locatie', 'https://tix.musisenstadstheater.nl/nl/tickets/7', ''],
  toonkunst: ['Musis, Muzenzaal', 'https://tix.musisenstadstheater.nl/nl/tickets/8', ''],
};
const detailHtml = ([plek, ticket, notitie]) => `<!doctype html><div class="info-box event">
  <div class="h5">vr 11 december 2026 - 20:00</div><h1>X</h1>
  <div class="genres my-1 fw-bold"><div class="h6">Toneel</div></div>
  <div class="fw-bold">${plek}</div>
  ${notitie ? `<div class="mt-3 fst-italic">${notitie}</div>` : ''}
  <a class="btn btn-orange" href="${ticket}">Tickets</a></div>`;

async function draai() {
  const browser = await chromium.launch();
  const urls = [];
  const logs = [];
  try {
    const page = await browser.newPage();
    await page.route('**/*', (r) => {
      const url = new URL(r.request().url());
      urls.push(url.pathname);
      if (url.pathname === '/api/events') {
        const p = Number(url.searchParams.get('page'));
        const body = { totalItems: 8, member: EVENTS[p - 1] ?? [], view: p < EVENTS.length ? { next: `/api/events?page=${p + 1}` } : {} };
        return r.fulfill({ status: 200, contentType: 'application/ld+json', body: JSON.stringify(body) });
      }
      const slug = url.pathname.split('/')[3];
      return r.fulfill({ status: 200, contentType: 'text/html', body: detailHtml(DETAIL[slug]) });
    });
    const opts = { page, robots: { isAllowed: () => true }, waitForTurn: async () => {}, log: (m) => logs.push(m), warn: (m) => logs.push(`WARN ${m}`) };
    const musis = await scrapeMusisGroep({ ...opts, theater });
    return { musis, urls, logs };
  } finally {
    await browser.close();
  }
}

test('Musis: API + detailpagina (zaal, extern, gast), titelconventie, kerk als locatie, TAR en serie weg, detailcache', async (t) => {
  t.after(() => rm(dir, { recursive: true, force: true }));
  const { musis, urls, logs } = await draai();
  const kort = (s) => `${s.titel} | ${s.datum} ${s.tijd} | ${s.beschikbaarheid} | pas ${s.podiumpas} | ${s.zaal ?? '-'} | ${s.locatie ?? '-'}`;
  assert.deepEqual(musis.map(kort), [
    'Laatste kaarten... | 2026-12-11 19:00 | beschikbaar | pas true | Parkzaal | -',
    'Laatste kaarten... | 2026-12-12 20:00 | beschikbaar | pas true | Parkzaal | -',
    'Yentl en de Boer – Rekhalzen | 2026-11-05 20:15 | uitverkocht | pas true | Muzenzaal | -',
    "40 UP - Let's dance again! | 2026-12-11 20:00 | beschikbaar | pas false | Parkzaal | -",
    'Allerzielen – Nederlandse Bachvereniging | 2027-03-26 19:30 | beschikbaar | pas true | - | Eusebiuskerk | Arnhem',
    // Ensemble als performer: niet omdraaien, wel "Voorstelling – Maker"; punt aan het eind weg.
    'Arnhem, mijn stadje – Arnhems Promenade Orkest | 2027-01-10 15:00 | beschikbaar | pas true | Muzenzaal | -',
  ]);
  assert.equal(musis[0].maker, 'Collectief Blauwdruk');
  assert.equal(musis[0].genre, 'Toneel');
  assert.equal(musis[2].genre, 'Cabaret');
  assert.equal(musis[3].genre, 'Muziek & Concert');
  assert.equal(musis[4].genre, 'Muziek & Concert');
  assert.ok(musis.every((s) => s.theaterId === 'musis' && s.theaterNaam === 'Musis Arnhem'));
  // Eén detailpagina per productie, niet voor de serie.
  const details = urls.filter((u) => u.startsWith('/nl/agenda/'));
  assert.equal(details.length, 6);
  assert.ok(!details.some((u) => u.includes('/serie/')));
  assert.ok(logs.some((l) => /weggelaten: .*serie\/combiticket\/rondleiding\/workshop \(1\).*Theater a\/d Rijn/.test(l)), logs.join('\n'));
  assert.equal(logs.some((l) => /WARN/.test(l)), false, logs.join('\n'));

  // Tweede run: alles uit de detailcache.
  const tweede = await draai();
  assert.equal(tweede.urls.filter((u) => u.startsWith('/nl/agenda/')).length, 0);
  assert.deepEqual(tweede.musis.map(kort), musis.map(kort));
});

test('Musis: plek uit de detailpagina', () => {
  assert.deepEqual(musisPlek('Musis, Muzenzaal'), { theaterId: 'musis', zaal: 'Muzenzaal', locatie: null });
  assert.deepEqual(musisPlek('Musis, Arnhem, Parkzaal'), { theaterId: 'musis', zaal: 'Parkzaal', locatie: null });
  assert.deepEqual(musisPlek('Stadstheater Arnhem, Grote Zaal'), { theaterId: 'stadstheater', zaal: 'Grote Zaal', locatie: null });
  assert.deepEqual(musisPlek('Koepelkerk, Externe locatie'), { theaterId: 'musis', zaal: null, locatie: 'Koepelkerk | Arnhem' });
  assert.equal(musisPlek('Theater a/d Rijn, Externe locatie'), null);
  assert.equal(musisPlek(null), null);
});
