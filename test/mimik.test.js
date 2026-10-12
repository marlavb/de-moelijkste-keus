// MIMIK: de echte scraper op een ingekorte sitemap en vijf productiepagina's
// uit de cache van 9 okt 2026 (test/fixtures/mimik-*), in Chromium, zonder
// netwerk; met een tijdelijke detailcache.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';

const dir = await mkdtemp(path.join(os.tmpdir(), 'mimik-'));
process.env.DETAIL_CACHE_DIR = dir;
const { scrapeMimik, mimikSpeeldata, mimikStatus, mimikWeglaten, isVerkoopNogNiet, isFilmzaal, verwerkMimik } = await import('../src/sites/mimik.js');
const { THEATERS } = await import('../src/lib/config.js');
const theater = THEATERS.find((t) => t.id === 'mimik');
const lees = (naam) => readFileSync(new URL(`./fixtures/${naam}`, import.meta.url), 'utf-8');
const PAGINA = {
  'femke-arnouts-het-wakker-liggen-van-wanda': 'mimik-femke.html',
  'sara-kroos-gelukskoekje': 'mimik-sara.html',
  'ludwig-bindervoet': 'mimik-ludwig.html',
  'millennium-jazz-orchestra-oktober-26': 'mimik-millennium.html',
  'filmclub-de-premiere-met-inleiding': 'mimik-filmclub.html',
};
const START = Date.parse('2026-10-09T15:00:00Z');

async function draai(nu) {
  const browser = await chromium.launch();
  const urls = [];
  const logs = [];
  try {
    const page = await browser.newPage();
    await page.route('**/*', (r) => {
      const url = new URL(r.request().url());
      urls.push(url.pathname);
      if (url.pathname === '/sitemap.xml') return r.fulfill({ status: 200, contentType: 'application/xml', body: lees('mimik-sitemap.xml') });
      const slug = url.pathname.split('/').pop();
      if (PAGINA[slug]) return r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: lees(PAGINA[slug]) });
      return r.fulfill({ status: 404, body: '' });
    });
    const shows = await scrapeMimik({ page, theater, robots: { isAllowed: () => true }, waitForTurn: async () => {}, log: (m) => logs.push(m), warn: (m) => logs.push(`WARN ${m}`), vandaag: '2026-10-09', nu: () => nu });
    return { shows, urls, logs };
  } finally {
    await browser.close();
  }
}

test('MIMIK: sitemap + productiepagina\'s via de detailcache; film weg, "Voorstelling – Maker", status, Podiumpas', async (t) => {
  t.after(() => rm(dir, { recursive: true, force: true }));
  const eerste = await draai(START);
  assert.equal(eerste.urls.filter((u) => u.startsWith('/agenda/')).length, 5, eerste.urls.join('\n'));
  const kort = (s) => `${s.titel} | ${s.datum} ${s.tijd} | ${s.genre} | ${s.beschikbaarheid} | pas ${s.podiumpas} | ${s.beschrijving ?? '-'}`;
  assert.deepEqual(eerste.shows.map(kort).sort(), [
    'ARTAUD3000 – Ludwig Bindervoet | 2027-03-17 20:00 | Toneel | afgelast | pas true | -',
    'Gelukskoekje – Sara Kroos | 2027-04-23 20:00 | Cabaret | uitverkocht | pas true | try-out',
    'Het wakker liggen van Wanda – Femke Arnouts | 2026-10-10 20:00 | Toneel | beschikbaar | pas true | -',
    'Millennium Jazz Orchestra | 2026-10-11 15:00 | Muziektheater | beschikbaar | pas true | oktober · Erik van Lier',
  ]);
  const femke = eerste.shows.find((s) => s.titel.startsWith('Het wakker'));
  assert.equal(femke.zaal, 'Theaterzaal');
  assert.equal(femke.prijs, 20);
  assert.match(femke.reserverenUrl, /^https:\/\/www\.mimik\.nl\/tickets\?programId=\d+$/);
  assert.ok(eerste.logs.some((l) => /weggelaten \(komende producties; filmzaal = speeldata\): film \(1\)/.test(l)), eerste.logs.join('\n'));
  assert.equal(eerste.logs.some((l) => /^WARN/.test(l)), false, eerste.logs.join('\n'));

  // Een dag later: alleen wat binnen 7 dagen speelt opnieuw (Femke, 10 okt);
  // de film (weggelaten) niet.
  const tweede = await draai(START + 21 * 3_600_000);
  const opgehaald = tweede.urls.filter((u) => u.startsWith('/agenda/'));
  assert.ok(opgehaald.includes('/agenda/femke-arnouts-het-wakker-liggen-van-wanda'), opgehaald.join('\n'));
  assert.equal(opgehaald.includes('/agenda/filmclub-de-premiere-met-inleiding'), false);
  assert.equal(tweede.shows.length, eerste.shows.length);
});

test('MIMIK: jaar bij "za 10-10" uit JSON-LD en oplopend over de jaarwisseling', () => {
  const rijen = [{ datum: 'vr 06-11', tijd: '20:00' }, { datum: 'vr 18-12', tijd: '20:00' }, { datum: 'vr 08-01', tijd: '19:30' }];
  assert.deepEqual(mimikSpeeldata(rijen, '2026-11-06T20:00:00').map((s) => `${s.datum} ${s.tijd}`), ['2026-11-06 20:00', '2026-12-18 20:00', '2027-01-08 19:30']);
});

test('MIMIK: knop, verkoop nog niet gestart, weglaten', () => {
  assert.equal(mimikStatus('Tickets'), 'beschikbaar');
  assert.equal(mimikStatus('Uitverkocht'), 'uitverkocht');
  assert.equal(mimikStatus('Afgelast'), 'afgelast');
  assert.equal(mimikStatus('Reserveer'), 'beschikbaar');
  assert.equal(mimikStatus('Verkoop start23 oktober 12:00'), 'onbekend');
  assert.equal(isVerkoopNogNiet('Verkoop start23 oktober 12:00'), true);
  assert.equal(mimikWeglaten({ categorie: 'Film, Junior', kop: 'Tetem workshop films' }), 'film');
  assert.equal(mimikWeglaten({ categorie: 'Sneak Preview', kop: 'Sneak Preview' }), 'Sneak Preview');
  assert.equal(mimikWeglaten({ categorie: 'Theater', kop: 'Femke Arnouts' }), null);
  assert.equal(mimikWeglaten({ categorie: 'Junior', kop: 'Workshop dansen' }), 'workshop/cursus');
});

test('MIMIK: alleen het theaterfilter; filmreeksen en filmzalen weg; onbekende categorie weg met waarschuwing (12 okt 2026)', () => {
  for (const c of ['Cabaret', 'Dans', 'Fysiek theater', 'Junior', 'Muziektheater', 'Special', 'Theater', 'Theaterconcert', 'Woordkunst']) {
    assert.equal(mimikWeglaten({ categorie: c, kop: 'X' }), null, c);
  }
  for (const c of ['Cinekid', 'MIMIK x Japan', 'Queer', 'Movies that Matter', 'Koolhovens Keuze', 'Royal Ballet and Opera', 'Klassieker']) {
    assert.equal(mimikWeglaten({ categorie: c, kop: 'X' }), c, c);
  }
  assert.equal(mimikWeglaten({ categorie: 'Film', kop: 'X' }), 'film');
  assert.equal(mimikWeglaten({ categorie: 'Film, Junior', kop: 'X' }), 'film');
  assert.equal(mimikWeglaten({ categorie: 'Halloween', kop: 'X' }), 'onbekende categorie: Halloween');
  assert.equal(isFilmzaal('Filmzaal 3'), true);
  assert.equal(isFilmzaal('Theaterzaal'), false);
  // Junior: theater in de Theaterzaal blijft, een film in een filmzaal niet.
  const rij = (datum, zaal) => ({ datum, tijd: '11:00', zaal, prijs: '€ 10,00', knop: 'Tickets', href: '/tickets?programId=1' });
  const logs = [];
  const shows = verwerkMimik(
    [
      { url: 'https://www.mimik.nl/agenda/groen-en-van-lien', data: { categorie: 'Junior', kop: 'Groen en van Lien', onder: 'Het verraad van Ithaka 8+', speeldata: [rij('2027-03-21', 'Theaterzaal')] } },
      { url: 'https://www.mimik.nl/agenda/shaun', data: { categorie: 'Junior', kop: 'Shaun het Schaap: Het Beest van de Boerderij (6+)', onder: 'Steve Cox', speeldata: [rij('2026-10-18', 'Filmzaal 3')] } },
      { url: 'https://www.mimik.nl/agenda/rbo', data: { categorie: 'Royal Ballet and Opera', kop: 'RBO 26/27: Tosca', speeldata: [rij('2026-11-01', 'Filmzaal 2')] } },
      { url: 'https://www.mimik.nl/agenda/nieuw', data: { categorie: 'Halloween', kop: 'Spookfeest', speeldata: [rij('2026-10-31', 'Foyer')] } },
    ],
    { theater, vandaag: '2026-10-12', log: (m) => logs.push(m), warn: (m) => logs.push(`WARN ${m}`) }
  );
  assert.deepEqual(shows.map((s) => s.titel), ['Het verraad van Ithaka 8+ – Groen en van Lien']);
  assert.ok(logs.some((l) => /filmzaal \(Junior\) \(1\)/.test(l) && /Royal Ballet and Opera \(1\)/.test(l)), logs.join('\n'));
  assert.ok(logs.some((l) => /^WARN onbekende categorieën, weggelaten .*Halloween \(1\)/.test(l)), logs.join('\n'));
});

test('MIMIK: "Te gast" alleen in de theaterzaal, Podiumpas onbekend met noot (12 okt 2026)', () => {
  assert.equal(mimikWeglaten({ categorie: 'Te gast', kop: 'DZ on Stage' }), null);
  const rij = (datum, zaal) => ({ datum, tijd: '20:00', zaal, prijs: '€ 20,00', knop: 'Tickets', href: '/tickets?programId=2' });
  const logs = [];
  const shows = verwerkMimik(
    [
      { url: 'https://www.mimik.nl/agenda/dz-on-stage-borstkanker', data: { categorie: 'Te gast', kop: 'DZ on Stage', speeldata: [rij('2026-10-27', 'Theaterzaal')] } },
      { url: 'https://www.mimik.nl/agenda/the-big-bike-film-night-2026', data: { categorie: 'Te gast', kop: 'The Big Bike Film Night', speeldata: [rij('2026-11-05', 'Filmzaal 1'), rij('2026-11-06', 'Foyer')] } },
    ],
    { theater, vandaag: '2026-10-12', log: (m) => logs.push(m), warn: (m) => logs.push(`WARN ${m}`) }
  );
  assert.deepEqual(shows.map((s) => [s.titel, s.podiumpas, s.podiumpasNoot]), [['DZ on Stage', null, 'Podiumpas-voorwaarden voor gastvoorstellingen nog niet bekend']]);
  assert.ok(logs.some((l) => /filmzaal \(Te gast\) \(1\)/.test(l) && /te gast buiten de theaterzaal \(1\)/.test(l)), logs.join('\n'));
  assert.ok(!logs.some((l) => l.startsWith('WARN')), logs.join('\n'));
});
