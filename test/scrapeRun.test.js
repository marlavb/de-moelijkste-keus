// Tests voor het vangnet in src/lib/scrapeRun.js, met nep-scrapers en
// tijdelijke bestanden — geen browser, geen netwerk. Draaien: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { runRefresh, ScrapeBlockedError } from '../src/lib/scrapeRun.js';
import { createPoliteWaiter, sleep } from '../src/lib/politeness.js';

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

async function run({ paths, theaters, scrapers, deps = fakeDeps(), budgets }) {
  const annotations = [];
  const result = await runRefresh({
    theaters,
    scrapers,
    deps,
    paths,
    budgets: budgets ?? { theaterMs: () => 5000, totalMs: 60000 },
    minDate: MIN_DATE,
    now: () => NOW,
    log: () => {},
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
