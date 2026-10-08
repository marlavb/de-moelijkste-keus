// Tests voor het vangnet in src/lib/scrapeRun.js, met nep-scrapers en
// tijdelijke bestanden — geen browser, geen netwerk. Draaien: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { runRefresh, ScrapeBlockedError } from '../src/lib/scrapeRun.js';
import { createPoliteWaiter, sleep, effectieveCrawlDelayMs } from '../src/lib/politeness.js';

const MIN_DATE = '2026-10-01';
const NOW = new Date('2026-10-01T04:30:00.000Z');

function theater(id) {
  return { id, naam: id, stad: 'Amsterdam', agendaUrl: `https://${id}.test/agenda` };
}

function show(theaterId, datum, extra = {}) {
  return {
    id: `${theaterId}-${datum}`,
    titel: `Voorstelling ${datum}`,
    theaterId,
    datum,
    tijd: '20:00',
    opgehaaldOp: '2026-09-30T04:30:00.000Z',
    ...extra,
  };
}

async function setup({ previousShows, previousStatus } = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), 'scraperun-'));
  const paths = {
    previousShows: path.join(dir, 'public/shows.json'),
    showsOutputs: [path.join(dir, 'data/shows.json'), path.join(dir, 'public/shows.json')],
    status: path.join(dir, 'public/scrape-status.json'),
  };
  await mkdir(path.join(dir, 'public'), { recursive: true });
  if (previousShows) await writeFile(paths.previousShows, JSON.stringify(previousShows));
  if (previousStatus) await writeFile(paths.status, JSON.stringify(previousStatus));
  return paths;
}

function fakeDeps({ crawlDelayMs = 0 } = {}) {
  const closedPages = [];
  return {
    closedPages,
    openPage: async () => {
      const page = { closed: false, close: async () => { page.closed = true; closedPages.push(page); } };
      return page;
    },
    loadRobots: async () => ({ robotsUrl: 'robots', crawlDelayMs, isAllowed: () => true }),
    createWaiter: (ms, log, signal) => createPoliteWaiter(ms, log, signal),
  };
}

async function run({ paths, theaters, scrapers, deps = fakeDeps(), budgets, logs = [] }) {
  const annotations = [];
  const result = await runRefresh({
    theaters,
    scrapers,
    deps,
    paths,
    budgets: budgets ?? { theaterMs: () => 5000, totalMs: 60000 },
    minDate: MIN_DATE,
    now: () => NOW,
    log: (m) => logs.push(m),
    annotate: (level, title, message) => annotations.push({ level, title, message }),
  });
  const written = JSON.parse(await readFile(paths.showsOutputs[1], 'utf-8'));
  const writtenStatus = JSON.parse(await readFile(paths.status, 'utf-8'));
  return { ...result, annotations, written, writtenStatus };
}

const failing = async () => {
  throw new Error('selector niet gevonden');
};
const empty = async () => [];

test('scraper gooit een error → vorige data van dat theater blijft, verlopen shows eruit', async () => {
  const paths = await setup({
    previousShows: [show('a', '2026-09-20'), show('a', '2026-10-05'), show('a', '2026-11-01')],
  });
  const { written, status, annotations } = await run({ paths, theaters: [theater('a')], scrapers: { a: failing } });

  assert.deepEqual(written.map((s) => s.datum), ['2026-10-05', '2026-11-01']);
  assert.equal(written[0].opgehaaldOp, '2026-09-30T04:30:00.000Z', 'oorspronkelijke opgehaaldOp blijft staan');
  assert.equal(status.theaters.a.status, 'terugval');
  assert.equal(status.theaters.a.aantal, 2);
  assert.equal(status.theaters.a.fout, 'exception: selector niet gevonden');
  assert.equal(annotations.length, 1);
  assert.match(annotations[0].title, /Terugval a/);
});

test('scraper geeft [] en vorige keer waren er shows → terugval', async () => {
  const paths = await setup({ previousShows: [show('a', '2026-10-05')] });
  const { written, status, annotations } = await run({ paths, theaters: [theater('a')], scrapers: { a: empty } });

  assert.equal(written.length, 1);
  assert.equal(status.theaters.a.status, 'terugval');
  assert.match(status.theaters.a.fout, /0 resultaten \(vorige keer 1/);
  assert.equal(annotations.length, 1);
});

test('scraper geeft [] en vorige keer ook niets (alleen verlopen) → leeg, geen waarschuwing', async () => {
  const paths = await setup({ previousShows: [show('a', '2026-09-20')] });
  const { written, status, annotations } = await run({ paths, theaters: [theater('a')], scrapers: { a: empty } });

  assert.deepEqual(written, []);
  assert.equal(status.theaters.a.status, 'leeg');
  assert.equal(status.theaters.a.fout, null);
  assert.equal(status.theaters.a.laatsteSucces, NOW.toISOString());
  assert.deepEqual(annotations, []);
});

test('scraper werkt normaal → nieuwe data, geen terugval, prijs/maker genormaliseerd', async () => {
  const paths = await setup({ previousShows: [show('a', '2026-10-05', { titel: 'oud' })] });
  const nieuw = [show('a', '2026-10-06', { titel: 'nieuw', opgehaaldOp: NOW.toISOString() })];
  const { written, status, annotations } = await run({
    paths,
    theaters: [theater('a')],
    scrapers: { a: async () => nieuw },
  });

  assert.deepEqual(written.map((s) => s.titel), ['nieuw']);
  assert.equal(written[0].prijs, null);
  assert.equal(written[0].maker, null);
  assert.equal(status.theaters.a.status, 'ok');
  assert.equal(status.theaters.a.terugvalSinds, null);
  assert.equal(typeof status.theaters.a.duurSeconden, 'number');
  assert.deepEqual(annotations, []);
});

test('andere theaters in dezelfde run blijven onaangetast; niet-gescrapete theaters blijven staan', async () => {
  const paths = await setup({
    previousShows: [show('a', '2026-10-05'), show('b', '2026-10-05', { titel: 'oud b' }), show('c', '2026-10-07')],
  });
  const { written, status } = await run({
    paths,
    theaters: [theater('a'), theater('b')],
    scrapers: { a: failing, b: async () => [show('b', '2026-10-08', { titel: 'nieuw b' })] },
  });

  assert.deepEqual(written.filter((s) => s.theaterId === 'b').map((s) => s.titel), ['nieuw b']);
  assert.equal(written.filter((s) => s.theaterId === 'a').length, 1);
  assert.equal(written.filter((s) => s.theaterId === 'c').length, 1);
  assert.equal(status.theaters.a.status, 'terugval');
  assert.equal(status.theaters.b.status, 'ok');
});

test('geen vorige shows.json en geen status (eerste run) → geen crash', async () => {
  const paths = await setup();
  const { written, status } = await run({
    paths,
    theaters: [theater('a'), theater('b'), theater('c')],
    scrapers: { a: failing, b: empty, c: async () => [show('c', '2026-10-05')] },
  });

  assert.equal(written.length, 1);
  assert.equal(status.theaters.a.status, 'fout');
  assert.equal(status.theaters.a.laatsteSucces, null);
  assert.equal(status.theaters.a.terugvalSinds, NOW.toISOString());
  assert.equal(status.theaters.b.status, 'leeg');
  assert.equal(status.theaters.c.status, 'ok');
});

test('hangende scraper wordt afgebroken, valt terug, en doet ná de timeout geen requests meer', async () => {
  const paths = await setup({ previousShows: [show('a', '2026-10-05')] });
  const requests = [];
  let stoppedWith = null;
  // Bouwt net als een echte scraper: vóór elke "request" waitForTurn(). Met
  // 1000ms crawl-delay valt de deadline (300ms) midden in de sleep.
  const endless = async ({ waitForTurn }) => {
    try {
      for (;;) {
        await waitForTurn();
        requests.push(Date.now());
      }
    } catch (err) {
      stoppedWith = err;
      throw err;
    }
  };
  const deps = fakeDeps({ crawlDelayMs: 1000 });
  const started = Date.now();
  const { status } = await run({
    paths,
    theaters: [theater('a'), theater('b')],
    scrapers: { a: endless, b: async () => [show('b', '2026-10-05')] },
    deps,
    budgets: { theaterMs: () => 300, totalMs: 60000 },
  });
  const elapsed = Date.now() - started;

  assert.ok(elapsed < 1000, `run ging na de deadline meteen door (${elapsed}ms)`);
  assert.equal(status.theaters.a.status, 'terugval');
  assert.equal(status.theaters.a.fout, 'timeout na 0.3s');
  assert.equal(status.theaters.b.status, 'ok', 'volgende theater draaide gewoon');
  assert.equal(deps.closedPages.length, 2, 'page van het gehangen theater is gesloten');
  assert.equal(stoppedWith?.name, 'ScrapeTimeoutError', 'waitForTurn gooide en stopte de lus');

  await sleep(1500); // ruim voorbij de volgende crawl-delay-beurt
  assert.equal(requests.length, 1, 'na de timeout geen enkele request meer');
});

test('scraper die nooit resolvet (zonder waitForTurn) blokkeert de run niet', async () => {
  const paths = await setup({ previousShows: [show('a', '2026-10-05')] });
  const { status } = await run({
    paths,
    theaters: [theater('a')],
    scrapers: { a: () => new Promise(() => {}) },
    budgets: { theaterMs: () => 100, totalMs: 60000 },
  });
  assert.equal(status.theaters.a.status, 'terugval');
  assert.equal(status.theaters.a.fout, 'timeout na 0.1s');
});

test('totaalbudget op → theaters die nog niet aan de beurt waren vallen terug', async () => {
  const paths = await setup({ previousShows: [show('a', '2026-10-05'), show('b', '2026-10-05')] });
  let bStarted = false;
  const { written, status } = await run({
    paths,
    theaters: [theater('a'), theater('b')],
    scrapers: {
      a: () => new Promise(() => {}),
      b: async () => {
        bStarted = true;
        return [];
      },
    },
    budgets: { theaterMs: () => 5000, totalMs: 200 },
  });
  assert.equal(status.theaters.a.fout, 'timeout na 0.2s', 'theaterbudget wordt afgekapt op wat er van de run over is');
  assert.equal(status.theaters.b.status, 'terugval');
  assert.match(status.theaters.b.fout, /niet gestart: totaalbudget/);
  assert.equal(bStarted, false);
  assert.equal(written.length, 2);
});

test('scherpe daling → alleen een waarschuwing, nieuwe data wordt gebruikt', async () => {
  const previous = Array.from({ length: 30 }, (_, i) => show('a', `2026-10-${String(i + 2).padStart(2, '0')}`));
  const paths = await setup({ previousShows: previous });
  const { written, status, annotations } = await run({
    paths,
    theaters: [theater('a')],
    scrapers: { a: async () => [show('a', '2026-10-05', { titel: 'enige' })] },
  });
  assert.deepEqual(written.map((s) => s.titel), ['enige']);
  assert.equal(status.theaters.a.status, 'ok');
  assert.match(status.theaters.a.waarschuwing, /scherpe daling: 1 unieke .* vorige keer 30/);
  assert.equal(annotations.length, 1);
  assert.match(annotations[0].title, /Scherpe daling/);
});

test('scrape-status: laatsteSucces en terugvalSinds lopen door over runs', async () => {
  const paths = await setup({
    previousShows: [show('a', '2026-10-05'), show('b', '2026-10-05')],
    previousStatus: {
      bijgewerktOp: '2026-09-30T04:30:00.000Z',
      theaters: {
        a: { status: 'terugval', laatsteSucces: '2026-09-28T04:30:00.000Z', terugvalSinds: '2026-09-29T04:30:00.000Z' },
        b: { status: 'terugval', laatsteSucces: '2026-09-28T04:30:00.000Z', terugvalSinds: '2026-09-29T04:30:00.000Z' },
        z: { status: 'ok', laatsteSucces: '2026-09-30T04:30:00.000Z' },
      },
    },
  });
  const { writtenStatus } = await run({
    paths,
    theaters: [theater('a'), theater('b')],
    scrapers: { a: failing, b: async () => [show('b', '2026-10-06')] },
  });
  assert.equal(writtenStatus.bijgewerktOp, NOW.toISOString());
  assert.equal(writtenStatus.theaters.a.laatsteSucces, '2026-09-28T04:30:00.000Z');
  assert.equal(writtenStatus.theaters.a.terugvalSinds, '2026-09-29T04:30:00.000Z');
  assert.equal(writtenStatus.theaters.b.status, 'ok');
  assert.equal(writtenStatus.theaters.b.laatsteSucces, NOW.toISOString());
  assert.equal(writtenStatus.theaters.b.terugvalSinds, null);
  assert.equal(writtenStatus.theaters.z.status, 'ok', 'status van niet-gescrapete theaters blijft staan');
  // terugvalReeks: 29 sep, 30 sep en 1 okt (NOW) = 3 nachten; b is weer ok.
  assert.equal(writtenStatus.theaters.a.terugvalReeks, 3);
  assert.equal(writtenStatus.theaters.b.terugvalReeks, 0);
});

test('shows.json blijft een platte array, identiek in beide outputs', async () => {
  const paths = await setup({ previousShows: [show('a', '2026-10-05')] });
  await run({ paths, theaters: [theater('a')], scrapers: { a: failing } });
  const [data, pub] = await Promise.all(paths.showsOutputs.map((f) => readFile(f, 'utf-8')));
  assert.equal(data, pub);
  assert.ok(Array.isArray(JSON.parse(pub)));
});

test('fout in scrape-status bevat alleen de eerste regel van de melding, ingekort', async () => {
  const paths = await setup({ previousShows: [show('a', '2026-10-05')] });
  const playwrightLike = async () => {
    throw new Error(`page.goto: Timeout 30000ms exceeded.\nCall log:\n  - navigating to "https://a.test/", waiting until "load"`);
  };
  const long = async () => {
    throw new Error('x'.repeat(500));
  };
  const { status } = await run({
    paths,
    theaters: [theater('a'), theater('b')],
    scrapers: { a: playwrightLike, b: long },
  });
  assert.equal(status.theaters.a.fout, 'exception: page.goto: Timeout 30000ms exceeded.');
  assert.ok(status.theaters.b.fout.length <= 'exception: '.length + 200);
  assert.ok(!/\n|at .*\.js/.test(status.theaters.a.fout + status.theaters.b.fout));
});

test('scraper kan zelf een waarschuwing geven: komt in scrape-status en als annotatie, data blijft', async () => {
  const paths = await setup({ previousShows: [] });
  const { written, status, annotations } = await run({
    paths,
    theaters: [theater('a')],
    scrapers: {
      a: async ({ warn }) => {
        warn('uitsluitingslijst gewijzigd');
        return [show('a', '2026-10-05')];
      },
    },
  });
  assert.equal(written.length, 1);
  assert.equal(status.theaters.a.status, 'ok');
  assert.equal(status.theaters.a.waarschuwing, 'uitsluitingslijst gewijzigd');
  assert.equal(annotations.length, 1);
  assert.match(annotations[0].message, /uitsluitingslijst/);
});

test('gepauzeerd theater: geen scrape, status gepauzeerd, oude data weg, andere theaters normaal', async () => {
  const paths = await setup({ previousShows: [show('a', '2026-10-05'), show('b', '2026-10-05')] });
  let called = false;
  const { written, status, annotations } = await run({
    paths,
    theaters: [{ ...theater('a'), gepauzeerd: { sinds: '2026-09-28', reden: 'botcontrole (403)' } }, theater('b')],
    scrapers: {
      a: async () => {
        called = true;
        return [];
      },
      b: async () => [show('b', '2026-10-06')],
    },
  });
  assert.equal(called, false, 'geen requests naar een gepauzeerd theater');
  assert.equal(status.theaters.a.status, 'gepauzeerd');
  assert.equal(status.theaters.a.aantal, 0);
  assert.equal(status.theaters.a.fout, null);
  assert.deepEqual(status.theaters.a.gepauzeerd, { sinds: '2026-09-28', reden: 'botcontrole (403)' });
  assert.equal(written.filter((s) => s.theaterId === 'a').length, 0, 'oude voorstellingen vervallen');
  assert.equal(status.theaters.b.status, 'ok');
  assert.deepEqual(annotations.map((x) => x.level), ['notice'], 'alleen een notice, geen warning');
});

test('geblokkeerd: fout zonder "exception:"-voorvoegsel, en terugval', async () => {
  const paths = await setup({ previousShows: [show('a', '2026-10-05')] });
  const { status } = await run({
    paths,
    theaters: [theater('a')],
    scrapers: {
      a: async () => {
        throw new ScrapeBlockedError('geblokkeerd (Cloudflare-challenge)');
      },
    },
  });
  assert.equal(status.theaters.a.status, 'terugval');
  assert.equal(status.theaters.a.fout, 'geblokkeerd (Cloudflare-challenge)');
});

test('robots.txt onbereikbaar (HTTP 500): theater overgeslagen, vorige data blijft, waarschuwing zonder "exception:"', async () => {
  const { RobotsOnbereikbaarError } = await import('../src/lib/robots.js');
  const paths = await setup({ previousShows: [show('a', '2026-10-05'), show('b', '2026-10-06')] });
  let gescrapet = false;
  const deps = {
    ...fakeDeps(),
    loadRobots: async (t) => {
      if (t.id === 'a') throw new RobotsOnbereikbaarError('robots.txt niet bereikbaar (HTTP 500)');
      return { robotsUrl: 'robots', crawlDelayMs: 0, isAllowed: () => true };
    },
  };
  const logs = [];
  const { written, status, annotations } = await run({
    paths,
    theaters: [theater('a'), theater('b')],
    scrapers: {
      a: async () => {
        gescrapet = true;
        return [];
      },
      b: async () => [show('b', '2026-10-07')],
    },
    deps,
    logs,
  });
  assert.equal(gescrapet, false, 'geen enkele request naar de agenda');
  assert.equal(status.theaters.a.status, 'terugval');
  assert.equal(status.theaters.a.fout, 'robots.txt niet bereikbaar (HTTP 500)');
  assert.deepEqual(written.filter((s) => s.theaterId === 'a').map((s) => s.datum), ['2026-10-05']);
  assert.equal(status.theaters.b.status, 'ok');
  assert.deepEqual(annotations.map((a) => a.title), ['Terugval a']);
  assert.match(annotations[0].message, /robots\.txt niet bereikbaar \(HTTP 500\)/);
  assert.equal(logs.some((l) => /DIAGNOSE/.test(l)), false, 'geen lege paginadiagnose');
});

test('robots.txt onbereikbaar door DNS (ENOTFOUND in de melding) → telt als netwerkfout voor de herpoging', async () => {
  const { isNetwerkfout } = await import('../src/lib/scrapeRun.js');
  const { RobotsOnbereikbaarError } = await import('../src/lib/robots.js');
  assert.equal(isNetwerkfout(new RobotsOnbereikbaarError('robots.txt niet bereikbaar (fetch failed: ENOTFOUND)')), true);
  assert.equal(isNetwerkfout(new RobotsOnbereikbaarError('robots.txt niet bereikbaar (HTTP 500)')), false);
});

test('dubbelingen: weggehaald vóór het wegschrijven, geteld in de status, warning bij meer dan een handvol', async () => {
  // b viel terug op vorige data die zelf al dubbel was; a levert 30 kopieën.
  const vorigB = [show('b', '2026-10-06'), show('b', '2026-10-06', { id: 'b-2026-10-06-2' })];
  const paths = await setup({ previousShows: vorigB });
  const kopieen = Array.from({ length: 30 }, (_, i) => show('a', '2026-10-05', { id: i ? `a-2026-10-05-${i + 1}` : 'a-2026-10-05' }));
  const { written, status, annotations } = await run({
    paths,
    theaters: [theater('a'), theater('b'), theater('c')],
    scrapers: {
      a: async () => [...kopieen, show('a', '2026-10-07')],
      b: failing,
      c: async () => [show('c', '2026-10-05'), show('c', '2026-10-05', { id: 'c-2' })],
    },
  });
  assert.deepEqual(
    written.map((s) => s.id).sort(),
    ['a-2026-10-05', 'a-2026-10-07', 'b-2026-10-06', 'c-2026-10-05']
  );
  assert.equal(status.theaters.a.dubbelingen, 29);
  assert.equal(status.theaters.a.aantal, 2);
  assert.match(status.theaters.a.waarschuwing, /29 dubbele voorstellingen/);
  assert.equal(status.theaters.b.dubbelingen, 1);
  assert.equal(status.theaters.c.dubbelingen, 1);
  assert.equal(status.theaters.c.waarschuwing, null);
  const dubbelWarnings = annotations.filter((a) => a.title.startsWith('Dubbelingen'));
  assert.deepEqual(dubbelWarnings.map((a) => a.title), ['Dubbelingen a']);
});

test('scherpe daling telt unieke voorstellingen: 600 records waarvan 20 uniek, vorige keer 360 → warning', async () => {
  const datum = (i) => `2026-${String(10 + Math.floor(i / 28)).padStart(2, '0')}-${String((i % 28) + 1).padStart(2, '0')}`;
  const previous = Array.from({ length: 360 }, (_, i) => show('a', datum(i), { id: `a-${i}`, titel: `Voorstelling ${i}` }));
  const paths = await setup({ previousShows: previous });
  // Zoals Muziekgebouw in sep 2026: 30 keer dezelfde eerste pagina van 20.
  const pagina = Array.from({ length: 20 }, (_, i) => show('a', datum(i), { titel: `Voorstelling ${i}` }));
  const records = Array.from({ length: 30 }, (_, p) => pagina.map((s, i) => ({ ...s, id: `a-${i}-${p}` }))).flat();
  assert.equal(records.length, 600);
  const { written, status, annotations } = await run({
    paths,
    theaters: [theater('a')],
    scrapers: { a: async () => records },
  });
  assert.equal(written.length, 20);
  assert.equal(status.theaters.a.vorigAantal, 360);
  assert.match(status.theaters.a.waarschuwing, /scherpe daling: 20 unieke komende voorstellingen, vorige keer 360/);
  assert.ok(annotations.some((a) => a.level === 'warning' && /Scherpe daling a/.test(a.title)));
  assert.ok(annotations.some((a) => a.level === 'warning' && /Dubbelingen a/.test(a.title)));
});

test('vorige data met dubbelingen telt als het aantal unieke voorstellingen', async () => {
  // Vorige keer 600 records, 20 uniek; nu 20 unieke → geen daling.
  const pagina = Array.from({ length: 20 }, (_, i) => show('a', '2026-10-05', { titel: `Voorstelling ${i}` }));
  const previous = Array.from({ length: 30 }, (_, p) => pagina.map((s, i) => ({ ...s, id: `a-${i}-${p}` }))).flat();
  const paths = await setup({ previousShows: previous });
  const { status } = await run({ paths, theaters: [theater('a')], scrapers: { a: async () => pagina.map((s, i) => ({ ...s, id: `n-${i}` })) } });
  assert.equal(status.theaters.a.vorigAantal, 20);
  assert.equal(status.theaters.a.waarschuwing, null);
});

test('speeldata meer dan twee jaar vooruit: weggehaald, geteld en een warning', async () => {
  const paths = await setup({ previousShows: [] });
  // Zoals Bijlmer Parktheater in sep 2026: dezelfde pagina, elk jaar opnieuw.
  const records = Array.from({ length: 10 }, (_, i) => show('a', `${2026 + i}-10-12`, { id: `a-${i}` }));
  const { written, status, annotations } = await run({ paths, theaters: [theater('a')], scrapers: { a: async () => records } });
  assert.deepEqual(written.map((s) => s.datum), ['2026-10-12', '2027-10-12']);
  assert.equal(status.theaters.a.aantal, 2);
  assert.match(status.theaters.a.waarschuwing, /8 voorstelling\(en\) na 2028-10-01 weggehaald/);
  assert.ok(annotations.some((a) => a.title === 'Onwaarschijnlijke data a'));
});

test('zonder tijd: geteld per theater; warning alleen bij een flinke stijging, niet bij structureel 100%', async () => {
  const reeks = (id, n, tijd) => Array.from({ length: n }, (_, i) => show(id, `2026-10-${String(i + 2).padStart(2, '0')}`, { id: `${id}-${i}`, titel: `T${i}`, tijd }));
  // a: had tijden, nu 15 van 20 zonder → warning. c (zoals Carré): altijd zonder → geen warning.
  const paths = await setup({ previousShows: [...reeks('a', 20, '20:00'), ...reeks('c', 20, null)] });
  const { status, annotations } = await run({
    paths,
    theaters: [theater('a'), theater('c')],
    scrapers: {
      a: async () => [...reeks('a', 15, null), ...reeks('a', 20, '20:00').slice(15)],
      c: async () => reeks('c', 20, null),
    },
  });
  assert.equal(status.theaters.a.zonderTijd, 15);
  assert.match(status.theaters.a.waarschuwing, /15 van 20 voorstellingen zonder tijd \(75%, vorige keer 0%\)/);
  assert.equal(status.theaters.c.zonderTijd, 20);
  assert.equal(status.theaters.c.waarschuwing, null);
  assert.deepEqual(annotations.filter((x) => x.title.startsWith('Tijden')).map((x) => x.title), ['Tijden ontbreken a']);
});

test('afgelast: statuswoord uit de titel; afgelast en gewoon op hetzelfde tijdstip blijven allebei', async () => {
  const paths = await setup();
  const scrapers = {
    a: async () => [
      show('a', '2026-10-05', { titel: 'Gelukkig maar - geannuleerd – Myrte Siebinga', beschikbaarheid: 'afgelast' }),
      show('a', '2026-10-06', { id: 'a-x', titel: 'Wacht - geannuleerd', beschikbaarheid: 'beschikbaar' }),
      show('a', '2026-10-07', { id: 'a-1', titel: 'Kiem', beschikbaarheid: 'afgelast' }),
      show('a', '2026-10-07', { id: 'a-2', titel: 'Kiem', beschikbaarheid: 'beschikbaar' }),
    ],
  };
  const { written, writtenStatus } = await run({ paths, theaters: [theater('a')], scrapers });
  assert.equal(written[0].titel, 'Gelukkig maar – Myrte Siebinga');
  // Zonder het signaal van het theater blijft de titel zoals hij was.
  assert.equal(written[1].titel, 'Wacht – geannuleerd');
  assert.equal(written.filter((s) => s.titel === 'Kiem').length, 2);
  assert.equal(writtenStatus.theaters?.a?.dubbelingen ?? 0, 0);
});

test('crawl-delay = max(robots.txt, crawlDelaySeconden, 1 s); eigen instelling versnelt nooit', () => {
  assert.equal(effectieveCrawlDelayMs(0), 1000); // globaal minimum
  assert.equal(effectieveCrawlDelayMs(500), 1000);
  assert.equal(effectieveCrawlDelayMs(5000), 5000);
  assert.equal(effectieveCrawlDelayMs(0, 4), 4000); // ITA: eigen instelling ruimer
  assert.equal(effectieveCrawlDelayMs(5000, 2), 5000); // eigen instelling korter: robots.txt wint
  assert.equal(effectieveCrawlDelayMs(5000, 0.5), 5000);
  assert.equal(effectieveCrawlDelayMs(0, 0.5), 1000); // ook niet onder het minimum
  // Ongeldige waarden tellen als 0, nooit NaN (dan zou er niet gewacht worden).
  for (const fout of [NaN, -3, 'vier', null, undefined, Infinity]) {
    assert.equal(effectieveCrawlDelayMs(5000, fout), 5000, String(fout));
    assert.equal(effectieveCrawlDelayMs(fout, 0), 1000, String(fout));
  }
});

test('runRefresh geeft de effectieve crawl-delay aan de waiter', async () => {
  const gekregen = {};
  const cases = [
    { id: 'robotswint', robots: 5000, eigen: 2, verwacht: 5000 },
    { id: 'eigenwint', robots: 0, eigen: 4, verwacht: 4000 },
    { id: 'minimum', robots: 200, eigen: undefined, verwacht: 1000 },
    { id: 'typfout', robots: 3000, eigen: 'vier', verwacht: 3000 },
  ];
  for (const c of cases) {
    const paths = await setup();
    const deps = {
      ...fakeDeps(),
      loadRobots: async () => ({ robotsUrl: 'robots', crawlDelayMs: c.robots, isAllowed: () => true }),
      createWaiter: (ms, log, signal) => {
        gekregen[c.id] = ms;
        return createPoliteWaiter(ms, log, signal);
      },
    };
    await run({ paths, theaters: [{ ...theater(c.id), crawlDelaySeconden: c.eigen }], scrapers: { [c.id]: empty }, deps });
    assert.equal(gekregen[c.id], c.verwacht, c.id);
  }
});

test('waiter wacht echt minstens de effectieve pauze tussen twee requests', async () => {
  const meldingen = [];
  const wacht = createPoliteWaiter(effectieveCrawlDelayMs(0, 1.2), (m) => meldingen.push(m));
  const start = Date.now();
  await wacht();
  await wacht();
  assert.ok(Date.now() - start >= 1150, `${Date.now() - start} ms`);
  assert.match(meldingen[0], /crawl-delay = 1200ms/);
});

test('weergave op meerderheid: brontitel terug vóór ontdubbeling, stabiel over twee runs', async () => {
  const paths = await setup();
  const scrapers = {
    carre: async () => [show('carre', '2026-12-03', { titel: 'Sara Kroos - Prikkelarme kermis' })],
    ssu: async () => [show('ssu', '2026-11-12', { titel: 'Prikkelarme kermis – Sara Kroos', volgordeZeker: true })],
    ks: async () => [show('ks', '2026-12-02', { titel: 'Prikkelarme kermis – Sara Kroos', volgordeZeker: true })],
  };
  const theaters = [theater('carre'), theater('ssu'), theater('ks')];
  const eerste = await run({ paths, theaters, scrapers });
  const carre = eerste.written.find((x) => x.theaterId === 'carre');
  assert.equal(carre.titel, 'Prikkelarme kermis – Sara Kroos');
  assert.equal(carre.titelBron, 'Sara Kroos – Prikkelarme kermis');
  // Tweede run: Carré valt terug op de vorige data; titel en titelBron blijven gelijk.
  const tweede = await run({ paths, theaters, scrapers: { ...scrapers, carre: failing } });
  const carre2 = tweede.written.find((x) => x.theaterId === 'carre');
  assert.equal(carre2.titel, 'Prikkelarme kermis – Sara Kroos');
  assert.equal(carre2.titelBron, 'Sara Kroos – Prikkelarme kermis');
});

test('genre op productieniveau: brongenre terug vóór elke run, stabiel over twee runs', async () => {
  const paths = await setup();
  const scrapers = {
    frascati: async () => [show('frascati', '2026-11-03', { titel: 'SEXODUS', genre: 'Overig' })],
    kunstlinie: async () => [show('kunstlinie', '2026-11-04', { titel: 'SEXODUS', genre: 'Muziektheater' })],
  };
  const theaters = [theater('frascati'), theater('kunstlinie')];
  const eerste = await run({ paths, theaters, scrapers });
  const fr = eerste.written.find((x) => x.theaterId === 'frascati');
  assert.equal(fr.genre, 'Muziektheater');
  assert.equal(fr.genreBron, 'Overig');
  // Tweede run: Kunstlinie valt terug; Frascati komt vers binnen.
  const tweede = await run({ paths, theaters, scrapers: { ...scrapers, kunstlinie: failing } });
  const fr2 = tweede.written.find((x) => x.theaterId === 'frascati');
  const kl2 = tweede.written.find((x) => x.theaterId === 'kunstlinie');
  assert.equal(fr2.genre, 'Muziektheater');
  assert.equal(fr2.genreBron, 'Overig');
  assert.equal(kl2.genre, 'Muziektheater');
  assert.equal('genreBron' in kl2, false);
});

test('maker op productieniveau: bronmaker terug vóór elke run, stabiel over twee runs', async () => {
  const paths = await setup();
  const scrapers = {
    ssu: async () => [show('ssu', '2027-02-11', { titel: 'Teckel' })],
    bellevue: async () => [show('bellevue', '2027-04-02', { titel: 'Teckel', maker: 'Nina van Tongeren / Bellevue Producties' })],
    mozaiek: async () => [show('mozaiek', '2027-01-22', { titel: 'Teckel', maker: 'Nina van Tongeren / Theater Bellevue' })],
  };
  const theaters = [theater('ssu'), theater('bellevue'), theater('mozaiek')];
  const eerste = await run({ paths, theaters, scrapers });
  const ssu = eerste.written.find((x) => x.theaterId === 'ssu');
  assert.equal(ssu.maker, 'Nina van Tongeren');
  assert.equal(ssu.makerBron, null);
  // Tweede run: Bellevue valt terug, SSU komt vers binnen (weer zonder maker).
  const tweede = await run({ paths, theaters, scrapers: { ...scrapers, bellevue: failing } });
  const ssu2 = tweede.written.find((x) => x.theaterId === 'ssu');
  const bv2 = tweede.written.find((x) => x.theaterId === 'bellevue');
  assert.equal(ssu2.maker, 'Nina van Tongeren');
  assert.equal(ssu2.makerBron, null);
  assert.equal(bv2.maker, 'Nina van Tongeren');
  assert.equal(bv2.makerBron, 'Nina van Tongeren / Bellevue Producties');
  // Derde run zonder bron met maker: SSU valt terug op zijn eigen (lege) maker.
  const derde = await run({ paths, theaters: [theater('ssu')], scrapers: { ssu: scrapers.ssu } });
  const ssu3 = derde.written.find((x) => x.theaterId === 'ssu');
  assert.equal(ssu3.maker, 'Nina van Tongeren'); // Bellevue en Mozaïek staan nog in de behouden data
});

test('omgedraaide titel en maker (OMGEDRAAID): ook in teruggevallen data recht, groepeert met de andere theaters', async () => {
  const paths = await setup();
  const scrapers = {
    flint: async () => [show('flint', '2027-04-29', { titel: 'Nhung Dam', maker: 'Legende van de witte slang', genre: 'Muziektheater' })],
    aandeslinger: async () => [show('aandeslinger', '2027-02-10', { titel: 'Legende van de witte slang', maker: 'Nhung Dam' })],
    ssu: async () => [show('ssu', '2027-04-10', { titel: 'Legende van de witte slang' })],
  };
  const theaters = [theater('flint'), theater('aandeslinger'), theater('ssu')];
  const eerste = await run({ paths, theaters, scrapers });
  const fl = eerste.written.find((x) => x.theaterId === 'flint');
  assert.equal(fl.titel, 'Legende van de witte slang');
  assert.equal(fl.maker, 'Nhung Dam');
  assert.equal(eerste.written.find((x) => x.theaterId === 'ssu').maker, 'Nhung Dam');
  const tweede = await run({ paths, theaters, scrapers: { ...scrapers, flint: failing } });
  const fl2 = tweede.written.find((x) => x.theaterId === 'flint');
  assert.equal(fl2.titel, 'Legende van de witte slang');
  assert.equal(fl2.maker, 'Nhung Dam');
});

test('netwerkfout (DNS): één herpoging na de pauze; gelukt → ok, nog een keer mis → terugval', async () => {
  const { isNetwerkfout, ScrapeTimeoutError } = await import('../src/lib/scrapeRun.js');
  const dns = () => new Error('page.goto: net::ERR_NAME_NOT_RESOLVED at https://www.podiummozaiek.nl/programma/agenda');
  assert.equal(isNetwerkfout(dns()), true);
  assert.equal(isNetwerkfout(Object.assign(new Error('fetch failed'), { cause: { code: 'EAI_AGAIN' } })), true);
  assert.equal(isNetwerkfout(new ScrapeTimeoutError('timeout na 5 s')), false);
  assert.equal(isNetwerkfout(Object.assign(new Error('geweigerd'), { name: 'ScrapeBlockedError' })), false);
  assert.equal(isNetwerkfout(new Error('agendacontainer ontbreekt')), false);

  const pauzes = [];
  const deps = { ...fakeDeps(), netwerkHerpogingMs: 60000, sleep: async (ms) => pauzes.push(ms) };
  // Eerste poging DNS-fout, tweede lukt.
  let n = 0;
  const paths = await setup({ previousShows: [show('mozaiek', '2027-01-22')] });
  const gelukt = await run({ paths, theaters: [theater('mozaiek')], scrapers: { mozaiek: async () => { if (n++ === 0) throw dns(); return [show('mozaiek', '2027-01-23')]; } }, deps, budgets: { theaterMs: () => 120000, totalMs: 600000 } });
  assert.equal(n, 2);
  assert.deepEqual(pauzes, [60000]);
  assert.equal(gelukt.writtenStatus.theaters.mozaiek.status, 'ok');
  // Twee keer mis: terugval, niet vaker dan één herpoging.
  let m = 0;
  const mis = await run({ paths: await setup({ previousShows: [show('mozaiek', '2027-01-22')] }), theaters: [theater('mozaiek')], scrapers: { mozaiek: async () => { m++; throw dns(); } }, deps, budgets: { theaterMs: () => 120000, totalMs: 600000 } });
  assert.equal(m, 2);
  assert.equal(mis.writtenStatus.theaters.mozaiek.status, 'terugval');
  // Geen netwerkfout, of te weinig budget na de pauze: geen herpoging.
  let k = 0;
  await run({ paths: await setup(), theaters: [theater('x')], scrapers: { x: async () => { k++; throw new Error('agendacontainer ontbreekt'); } }, deps });
  assert.equal(k, 1);
  let j = 0;
  await run({ paths: await setup(), theaters: [theater('x')], scrapers: { x: async () => { j++; throw dns(); } }, deps, budgets: { theaterMs: () => 5000, totalMs: 60000 } });
  assert.equal(j, 1);
});

test('dalingReeks: telt nachten op rij met een scherpe daling, terug op 0 als het weer goed is', async () => {
  const veel = Array.from({ length: 40 }, (_, i) => show('a', `2026-11-${String((i % 28) + 1).padStart(2, '0')}`, { titel: `Voorstelling ${i}` }));
  const paths = await setup({
    previousShows: veel,
    previousStatus: { theaters: { a: { status: 'ok', dalingSinds: '2026-09-30T04:30:00.000Z' } } },
  });
  const { writtenStatus } = await run({ paths, theaters: [theater('a')], scrapers: { a: async () => veel.slice(0, 5) } });
  assert.match(writtenStatus.theaters.a.waarschuwing, /scherpe daling/);
  assert.equal(writtenStatus.theaters.a.dalingSinds, '2026-09-30T04:30:00.000Z');
  assert.equal(writtenStatus.theaters.a.dalingReeks, 2);
  const herstel = await run({ paths: await setup({ previousShows: veel, previousStatus: { theaters: { a: { status: 'ok', dalingSinds: '2026-09-30T04:30:00.000Z' } } } }), theaters: [theater('a')], scrapers: { a: async () => veel } });
  assert.equal(herstel.writtenStatus.theaters.a.dalingReeks, 0);
  assert.equal(herstel.writtenStatus.theaters.a.dalingSinds, null);
});

test('productie samenvoegen: Greg Shapiro wordt één productie; bron (titel en beschrijving) terug bij teruggevallen data', async () => {
  const paths = await setup();
  const scrapers = {
    stadsgehoorzaal: async () => [show('stadsgehoorzaal', '2026-11-04', { titel: 'Greg Shapiro', genre: 'Overig', beschrijving: 'KING ME | 250 years of Donald Trump' })],
    cpunt: async () => [show('cpunt', '2026-10-23', { titel: 'KING ME – 250 years of Donald Trump – Greg Shapiro', genre: 'Cabaret', volgordeZeker: true })],
    stoep: async () => [show('stoep', '2026-10-21', { titel: 'KING ME – Greg Shapiro', genre: 'Cabaret', volgordeZeker: true })],
  };
  const theaters = [theater('stadsgehoorzaal'), theater('cpunt'), theater('stoep')];
  const eerste = await run({ paths, theaters, scrapers });
  for (const t of ['stadsgehoorzaal', 'cpunt', 'stoep']) assert.equal(eerste.written.find((x) => x.theaterId === t).titel, 'KING ME – Greg Shapiro', t);
  const sgz = eerste.written.find((x) => x.theaterId === 'stadsgehoorzaal');
  assert.equal(sgz.genre, 'Cabaret');
  assert.equal(sgz.titelBron, 'Greg Shapiro');
  assert.equal(sgz.beschrijving, '250 years of Donald Trump');
  // Tweede run: Stadsgehoorzaal valt terug; de bron gaat terug en wordt opnieuw samengevoegd.
  const tweede = await run({ paths, theaters, scrapers: { ...scrapers, stadsgehoorzaal: failing } });
  const sgz2 = tweede.written.find((x) => x.theaterId === 'stadsgehoorzaal');
  assert.equal(sgz2.titel, 'KING ME – Greg Shapiro');
  assert.equal(sgz2.titelBron, 'Greg Shapiro');
  assert.equal(sgz2.beschrijving, '250 years of Donald Trump');
  assert.equal(sgz2.beschrijvingBron, 'KING ME | 250 years of Donald Trump');
});

test('log: aantal samengevoegde producties en speeldata, ook bij 0 (8 okt 2026)', async () => {
  const paths = await setup();
  const kingMe = (id, titel, datum, maker = 'Greg Shapiro') => ({ ...show(id, datum), id: `${id}-${datum}`, titel, maker, genre: 'Cabaret' });
  const logs = [];
  await run({
    paths,
    logs,
    theaters: [theater('a'), theater('b')],
    scrapers: {
      a: async () => [kingMe('a', 'KING ME – 250 years of Donald Trump', '2026-11-01')],
      b: async () => [kingMe('b', 'KING ME', '2026-11-02')],
    },
  });
  assert.ok(logs.some((l) => /^Productie-samenvoeging: 1 productie\(s\), 1 speeldata samengevoegd/.test(l)), logs.join('\n'));
  const leeg = [];
  await run({ paths: await setup(), logs: leeg, theaters: [theater('a')], scrapers: { a: async () => [show('a', '2026-11-01')] } });
  assert.ok(leeg.some((l) => /^Productie-samenvoeging: 0 productie\(s\), 0 speeldata/.test(l)), leeg.join('\n'));
});
