// Corrosia: de echte scraper in Chromium, zonder netwerk, op een met de hand
// gemaakte agendapagina (test/fixtures/corrosia-agenda.html, 20 nov 2026),
// plus de sanity check: een niet-OK status of geen enkele kaart geeft een
// exception (en in de nachtrun een DIAGNOSE-regel), nooit stil 0.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';

import { scrapeCorrosia } from '../src/sites/corrosia.js';
import { THEATERS } from '../src/lib/config.js';
import { runRefresh } from '../src/lib/scrapeRun.js';
import { createPoliteWaiter } from '../src/lib/politeness.js';

const theater = THEATERS.find((t) => t.id === 'corrosia');
const FIXTURE = readFileSync(new URL('./fixtures/corrosia-agenda.html', import.meta.url), 'utf-8');
const html = (body, status = 200) => ({ status, contentType: 'text/html; charset=utf-8', body });
// De dag van de voorstellingen in de fixture (laatst goede data, 12 nov 2026).
const REFERENTIE = new Date('2026-11-12T12:00:00Z');

async function draai(antwoord) {
  const browser = await chromium.launch();
  const logs = [];
  try {
    const page = await browser.newPage();
    await page.route('**/*', (r) => r.fulfill(antwoord));
    const shows = await scrapeCorrosia({ page, theater, robots: { isAllowed: () => true }, waitForTurn: async () => {}, log: (m) => logs.push(m), referentie: REFERENTIE });
    return { shows, logs };
  } finally {
    await browser.close();
  }
}

test('Corrosia: kaarten op de agendapagina → voorstellingen (genre, Podiumpas, jaarwisseling, "juni" voluit, kaart zonder link overgeslagen)', async () => {
  const { shows, logs } = await draai(html(FIXTURE));
  assert.match(logs.join('\n'), /6 voorstellingen gevonden op de agendapagina/);
  assert.deepEqual(shows.map((s) => `${s.titel} | ${s.datum} ${s.tijd} | ${s.genre} | pas ${s.podiumpas}`), [
    'Sophie van Winden - Cello Octet Amsterdam - CODA (try out) | 2026-11-18 20:00 | Muziek & Concert | pas true',
    'Uitgemolken | 2026-12-12 19:45 | Overig | pas false',
    'ICK Amsterdam - KNOWN & TO KNOW: Queens & The VOID | 2027-01-30 20:00 | Dans | pas true',
    'Arno Schuitemaker - Monday | 2027-02-18 20:00 | Toneel | pas true',
    'Studio SIBLING - Why we decided to get a dog | 2027-06-01 20:00 | Toneel | pas true',
  ]);
  assert.equal(shows[0].beschrijving, 'De 100-jarige Magda viert samen met de muziek.', '"Lees meer" eruit');
  assert.equal(shows[0].reserverenUrl, 'https://www.corrosia.nl/agenda/detail/q/a_id/3978/titel/sophie-van-winden-cello-octet-amsterdam-coda-try-out');
  assert.equal(shows[0].beschikbaarheid, 'onbekend');
});

test('Corrosia: niet-OK status → exception met de status, niet stil 0', async () => {
  for (const status of [404, 403, 500]) {
    await assert.rejects(draai(html('<html><body><h1>Pagina niet gevonden</h1></body></html>', status)), new RegExp(`agendapagina gaf HTTP ${status} op https://www\\.corrosia\\.nl/agenda/programma`));
  }
});

test('Corrosia: status 200 maar geen enkele kaart (.item-inner) → exception, niet stil 0', async () => {
  await assert.rejects(
    draai(html('<html><body><div class="agenda"><p>Er zijn op dit moment geen voorstellingen.</p></div></body></html>')),
    /geen agendakaarten \(\.item-inner\) op https:\/\/www\.corrosia\.nl\/agenda\/programma/
  );
});

test('Corrosia in de nachtrun: niet-OK status → terugval met een DIAGNOSE-regel (status, URL, titel, body)', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'corrosia-'));
  const paths = { previousShows: path.join(dir, 'prev.json'), showsOutputs: [path.join(dir, 'a.json'), path.join(dir, 'b.json')], status: path.join(dir, 'status.json') };
  const browser = await chromium.launch();
  const logs = [];
  try {
    await runRefresh({
      theaters: [theater],
      scrapers: { corrosia: scrapeCorrosia },
      deps: {
        openPage: async () => {
          const page = await browser.newPage();
          await page.route('**/*', (r) => r.fulfill(html('<html><head><title>Niet gevonden | Corrosia</title></head><body>Deze pagina bestaat niet meer.</body></html>', 404)));
          return page;
        },
        loadRobots: async () => ({ robotsUrl: 'robots', crawlDelayMs: 0, isAllowed: () => true }),
        createWaiter: (ms, log, signal) => createPoliteWaiter(ms, log, signal),
      },
      paths,
      budgets: { theaterMs: () => 20_000, totalMs: 30_000 },
      minDate: '2026-11-20',
      now: () => new Date('2026-11-20T05:00:00Z'),
      log: (m) => logs.push(m),
      annotate: () => {},
      aliassen: { aliassen: {}, nietSamenvoegen: [] },
    });
  } finally {
    await browser.close();
  }
  const tekst = logs.join('\n');
  assert.match(tekst, /\[corrosia\] DIAGNOSE: HTTP 404, URL https:\/\/www\.corrosia\.nl\/agenda\/programma, titel "Niet gevonden \| Corrosia", body: "Deze pagina bestaat niet meer\."/);
  const status = JSON.parse(await readFile(paths.status, 'utf-8')).theaters.corrosia;
  assert.match(status.fout, /agendapagina gaf HTTP 404/);
});
