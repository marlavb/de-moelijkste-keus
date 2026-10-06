// De echte trigger in de Functions-emulator: een nieuw lid (gast,
// uitgenodigd) → één mail bij de lokale SMTP-vanger (functions/.env.local).
// Niet bij een tweede keer aanmaken, niet bij een wijziging, niet bij een
// organisator.

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { SMTPServer } from 'smtp-server';
import { simpleParser } from 'mailparser';
import { Timestamp } from 'firebase-admin/firestore';
import { admin, wis, gebruiker, vrienden, plan } from './hulp.js';

let server;
let ontvangen = [];
let db;

before(async () => {
  ({ db } = admin());
  server = new SMTPServer({
    authOptional: true,
    allowInsecureAuth: true,
    disabledCommands: ['STARTTLS'],
    onAuth: (_a, _s, cb) => cb(null, { user: 'test' }),
    onData: (stream, _s, cb) => {
      simpleParser(stream)
        .then((m) => ontvangen.push(m))
        .then(() => cb(), cb);
    },
  });
  await new Promise((r) => server.listen(2525, '127.0.0.1', r));
});
after(async () => {
  await new Promise((r) => server.close(r));
});
beforeEach(async () => {
  await wis();
  ontvangen = [];
  await gebruiker('anna');
  await gebruiker('bob');
  await vrienden('anna', 'bob');
});

async function wachtOp(fn, ms = 30000) {
  const eind = Date.now() + ms;
  while (Date.now() < eind) {
    const r = await fn();
    if (r) return r;
    await new Promise((x) => setTimeout(x, 250));
  }
  return null;
}

test('nieuwe uitnodiging → één mail met onderwerp, tekst en HTML, van "Podiumagenda"', async () => {
  await plan('P1', 'anna', 'bob');
  const log = await wachtOp(async () => (await db.doc('mailLog/P1_bob').get()).data()?.status === 'verstuurd');
  assert.ok(log, 'mailLog niet op verstuurd');
  assert.equal(ontvangen.length, 1);
  const m = ontvangen[0];
  assert.equal(m.subject, '@anna nodigt je uit voor Grip – Rayen Panday');
  assert.equal(m.to.text, 'bob@mail.test');
  assert.equal(m.from.value[0].name, 'Podiumagenda');
  assert.match(m.text, /Bekijk in Podiumagenda en laat weten of je meegaat:\nhttps:\/\/marlavb\.github\.io\/de-moelijkste-keus\/#\/berichten/);
  assert.match(m.html, /Bekijk in Podiumagenda<\/a>/);
  assert.ok(!m.text.includes('anna@mail.test') && !m.html.includes('anna@mail.test'), 'geen adres van de uitnodiger');
});

test('opnieuw aanmaken, een wijziging of een organisator: geen tweede mail', async () => {
  await plan('P1', 'anna', 'bob');
  await wachtOp(async () => (await db.doc('mailLog/P1_bob').get()).data()?.status === 'verstuurd');
  const lid = (await db.doc('plannen/P1/leden/bob').get()).data();
  await db.doc('plannen/P1/leden/bob').delete();
  await db.doc('plannen/P1/leden/bob').set({ ...lid, uitgenodigdOp: Timestamp.now() });
  await db.doc('plannen/P1/leden/bob').update({ kaarten: true });
  await new Promise((r) => setTimeout(r, 4000));
  assert.equal(ontvangen.length, 1);
  assert.equal((await db.collection('mailLog').get()).size, 1);
});

test('mail uitgezet: de trigger stuurt niets', async () => {
  await db.doc('mailvoorkeur/bob').set({ uitnodigingen: false, gewijzigdOp: Timestamp.now() });
  await plan('P2', 'anna', 'bob');
  await new Promise((r) => setTimeout(r, 5000));
  assert.equal(ontvangen.length, 0);
  assert.equal((await db.doc('mailLog/P2_bob').get()).exists, false);
});
