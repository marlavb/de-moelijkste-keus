// Profiel (vrienden, stap 1): controle van gebruikersnaam en naam, en de
// transactie van bewaarProfiel() met een nep-Firestore. De echte rules worden
// getest met de emulator (firebase/tests/profiel.test.js, npm run test:rules).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  controleerGebruikersnaam,
  controleerNaam,
  voorstelGebruikersnaam,
  bewaarProfiel,
  ProfielFout,
  GERESERVEERDE_NAMEN,
} from '../public/js/profiel.js';

test('geldige gebruikersnamen: hoofdletters blijven zichtbaar, de sleutel is in kleine letters', () => {
  assert.deepEqual(controleerGebruikersnaam('MarlaVB'), { ok: true, weergave: 'MarlaVB', laag: 'marlavb' });
  assert.deepEqual(controleerGebruikersnaam('  @anna.de_vries  '), { ok: true, weergave: 'anna.de_vries', laag: 'anna.de_vries' });
  for (const n of ['abc', 'a1b', '007', 'a'.repeat(20), 'j.p_v']) assert.equal(controleerGebruikersnaam(n).ok, true, n);
});

test('ongeldige gebruikersnamen geven een begrijpelijke melding', () => {
  const fout = (n) => controleerGebruikersnaam(n).fout;
  assert.match(fout(''), /Kies een gebruikersnaam/);
  assert.match(fout('ab'), /minstens 3/);
  assert.match(fout('a'.repeat(21)), /hooguit 20/);
  assert.match(fout('anna vries'), /geen spaties/);
  assert.match(fout('aliçe'), /zonder accent/);
  assert.match(fout('anna-v'), /zonder accent/);
  assert.match(fout('.anna'), /Begin en eindig/);
  assert.match(fout('anna_'), /Begin en eindig/);
  assert.match(fout('an..na'), /twee leestekens/);
  assert.match(fout('an._na'), /twee leestekens/);
});

test('gereserveerde namen (ook met hoofdletters) en alles met podiumagenda/podiumpas erin', () => {
  for (const n of ['admin', 'Admin', 'VRIENDEN', 'podiumagenda', 'fan.podiumpas', 'Podiumpas2026']) {
    assert.equal(controleerGebruikersnaam(n).ok, false, n);
    assert.match(controleerGebruikersnaam(n).fout, /niet beschikbaar/);
  }
  assert.equal(controleerGebruikersnaam('administratie').ok, true);
});

test('de lijst gereserveerde namen is gelijk aan die in firestore.rules', async () => {
  const rules = await readFile(new URL('../firestore.rules', import.meta.url), 'utf8');
  const blok = rules.match(/function gereserveerd\(laag\) \{\s*return laag in \[([^\]]*)\]/);
  assert.ok(blok, 'gereserveerd() niet gevonden in firestore.rules');
  const inRules = [...blok[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(inRules, GERESERVEERDE_NAMEN);
  assert.match(rules, /laag\.matches\('\.\*\(podiumagenda\|podiumpas\)\.\*'\)/);
});

test('volledige naam: spaties samengevoegd, 1–60 tekens, geen stuurtekens', () => {
  assert.deepEqual(controleerNaam('  Marla   van  Broekhoven '), { ok: true, naam: 'Marla van Broekhoven' });
  assert.deepEqual(controleerNaam('Jörgen Ö'), { ok: true, naam: 'Jörgen Ö' });
  assert.match(controleerNaam('   ').fout, /Vul je naam in/);
  assert.match(controleerNaam('x'.repeat(61)).fout, /hooguit 60/);
  assert.equal(controleerNaam('x'.repeat(60)).ok, true);
  assert.match(controleerNaam('a\u0007b').fout, /ongeldig teken/);
  // Een regeleinde is witruimte en wordt een spatie.
  assert.deepEqual(controleerNaam('Anna\nde Vries'), { ok: true, naam: 'Anna de Vries' });
});

test('voorstel uit de Google-naam: geldig of leeg', () => {
  assert.equal(voorstelGebruikersnaam('Marla van Broekhoven'), 'marla.van.broekhoven');
  assert.equal(voorstelGebruikersnaam('Jörgen Ö'), 'jorgen.o');
  assert.equal(voorstelGebruikersnaam('Al'), '');
  assert.equal(voorstelGebruikersnaam(null), '');
  assert.equal(voorstelGebruikersnaam('Admin'), '');
  assert.ok(voorstelGebruikersnaam('Een heel erg lange naam die niet past').length <= 20);
  assert.equal(controleerGebruikersnaam(voorstelGebruikersnaam('Een heel erg lange naam die niet past')).ok, true);
});

// ---------- bewaarProfiel met een nep-Firestore ----------

function nepFirestore(begin = {}) {
  const docs = new Map(Object.entries(begin));
  const fs = {
    doc: (_db, ...pad) => pad.join('/'),
    serverTimestamp: () => 'NU',
    runTransaction: async (_db, fn) => {
      const schrijf = [];
      const tx = {
        get: async (p) => ({ exists: () => docs.has(p), data: () => docs.get(p) }),
        set: (p, d) => schrijf.push(['set', p, d]),
        delete: (p) => schrijf.push(['delete', p]),
      };
      const uit = await fn(tx);
      for (const [soort, p, d] of schrijf) soort === 'set' ? docs.set(p, d) : docs.delete(p);
      return uit;
    },
  };
  return { fs, docs };
}

test('bewaarProfiel: eerste keer schrijft profiel en naam', async () => {
  const { fs, docs } = nepFirestore();
  const uit = await bewaarProfiel({ db: null, fs, uid: 'u1', gebruikersnaam: 'Anna', naam: ' Anna  V ' });
  assert.deepEqual(uit, { gebruikersnaam: 'Anna', gebruikersnaamLaag: 'anna', naam: 'Anna V' });
  assert.deepEqual(docs.get('usernames/anna'), { uid: 'u1', gebruikersnaam: 'Anna', naam: 'Anna V' });
  assert.deepEqual(docs.get('profielen/u1'), {
    gebruikersnaam: 'Anna', gebruikersnaamLaag: 'anna', naam: 'Anna V', aangemaaktOp: 'NU', gewijzigdOp: 'NU', v: 1,
  });
});

test('bewaarProfiel: naam van een ander → bezet, er wordt niets geschreven', async () => {
  const { fs, docs } = nepFirestore({ 'usernames/anna': { uid: 'u2', gebruikersnaam: 'anna', naam: 'A' } });
  await assert.rejects(
    bewaarProfiel({ db: null, fs, uid: 'u1', gebruikersnaam: 'ANNA', naam: 'Anna' }),
    (e) => e instanceof ProfielFout && e.code === 'bezet'
  );
  assert.equal(docs.has('profielen/u1'), false);
});

test('bewaarProfiel: wijzigen geeft de oude naam vrij en houdt aangemaaktOp', async () => {
  const { fs, docs } = nepFirestore({
    'profielen/u1': { gebruikersnaam: 'anna', gebruikersnaamLaag: 'anna', naam: 'Anna', aangemaaktOp: 'TOEN', gewijzigdOp: 'TOEN', v: 1 },
    'usernames/anna': { uid: 'u1', gebruikersnaam: 'anna', naam: 'Anna' },
  });
  await bewaarProfiel({ db: null, fs, uid: 'u1', gebruikersnaam: 'anna2', naam: 'Anna' });
  assert.equal(docs.has('usernames/anna'), false);
  assert.equal(docs.get('usernames/anna2').uid, 'u1');
  assert.equal(docs.get('profielen/u1').aangemaaktOp, 'TOEN');
});

test('bewaarProfiel: alleen hoofdletters wijzigen haalt de naam niet weg', async () => {
  const { fs, docs } = nepFirestore({
    'profielen/u1': { gebruikersnaam: 'anna', gebruikersnaamLaag: 'anna', naam: 'Anna', aangemaaktOp: 'TOEN', gewijzigdOp: 'TOEN', v: 1 },
    'usernames/anna': { uid: 'u1', gebruikersnaam: 'anna', naam: 'Anna' },
  });
  await bewaarProfiel({ db: null, fs, uid: 'u1', gebruikersnaam: 'Anna', naam: 'Anna' });
  assert.equal(docs.get('usernames/anna').gebruikersnaam, 'Anna');
});

test('bewaarProfiel: ongeldige invoer → ProfielFout("ongeldig") zonder Firestore', async () => {
  const fs = { runTransaction: () => assert.fail('mag Firestore niet aanroepen') };
  await assert.rejects(bewaarProfiel({ db: null, fs, uid: 'u1', gebruikersnaam: 'x', naam: 'X' }), (e) => e.code === 'ongeldig');
  await assert.rejects(bewaarProfiel({ db: null, fs, uid: 'u1', gebruikersnaam: 'xyz', naam: '' }), (e) => e.code === 'ongeldig');
});
