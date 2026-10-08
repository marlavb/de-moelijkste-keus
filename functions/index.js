// Cloud Functions (2nd gen, Node 22, europe-west4 = de regio van Firestore).
//   uitnodigingsmail  — mail bij een nieuwe uitnodiging (zie uitnodiging.js)
//   stopFacturering   — facturering stoppen bij overschrijding van het budget
//                       (zie facturering.js); DRY_RUN staat standaard aan.
//   startNachtrun     — start refresh-data.yml om 05:00 Europe/Amsterdam
//                       (Cloud Scheduler, zie nachtrun.js).
//   zoekOpNaam        — callable: vrienden zoeken op volledige naam
//                       (zie naamzoeken.js).
//   naamIndexProfiel, naamIndexVoorkeur — houden de zoekindex bij na een
//                       wijziging van profielen/{uid} of naamvoorkeur/{uid}.
// Geheimen (Secret Manager): GMAIL_USER, GMAIL_APP_PASSWORD,
// GITHUB_DISPATCH_TOKEN. Nooit in de repo.
// Instellingen (functions/.env): BUDGET_TOPIC, DRY_RUN; in de emulator
// (functions/.env.local) een lokale SMTP-vanger in plaats van Gmail.

import { setGlobalOptions } from 'firebase-functions/v2';
import { onDocumentCreated, onDocumentWritten } from 'firebase-functions/v2/firestore';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { onMessagePublished } from 'firebase-functions/v2/pubsub';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { defineSecret, defineString, defineInt, defineBoolean } from 'firebase-functions/params';
import * as logger from 'firebase-functions/logger';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import nodemailer from 'nodemailer';

import { verwerkUitnodiging, ruimOp } from './uitnodiging.js';
import { verwerkBudgetBericht } from './facturering.js';
import { startRefresh } from './nachtrun.js';
import { zoekOpNaam as zoekOpNaamKern, indexeerNaam, ruimZoekTellersOp, ZOEK_LIMIET } from './naamzoeken.js';

setGlobalOptions({ region: 'europe-west4', maxInstances: 2 });
initializeApp();

const GMAIL_USER = defineSecret('GMAIL_USER');
const GMAIL_APP_PASSWORD = defineSecret('GMAIL_APP_PASSWORD');
const APP_URL = defineString('APP_URL', { default: 'https://marlavb.github.io/de-moelijkste-keus/' });
const SMTP_HOST = defineString('SMTP_HOST', { default: 'smtp.gmail.com' });
const SMTP_PORT = defineInt('SMTP_PORT', { default: 465 });
const SMTP_SECURE = defineBoolean('SMTP_SECURE', { default: true });
const DRY_RUN = defineBoolean('DRY_RUN', { default: true });
const GITHUB_DISPATCH_TOKEN = defineSecret('GITHUB_DISPATCH_TOKEN');
// Het topic moet bij het deployen bekend zijn: uit functions/.env.
const BUDGET_TOPIC = process.env.BUDGET_TOPIC || 'budget-meldingen';

// Reageert alleen op het aanmaken (niet op wijzigen) van een lid met rol
// 'gast' en status 'uitgenodigd'. Schrijft alleen in mailLog en mailTellers,
// nooit in plannen of leden: de functie kan zichzelf dus niet opnieuw starten.
export const uitnodigingsmail = onDocumentCreated(
  {
    document: 'plannen/{planId}/leden/{uid}',
    secrets: [GMAIL_USER, GMAIL_APP_PASSWORD],
    retry: false,
    maxInstances: 1,
    timeoutSeconds: 60,
    memory: '256MiB',
  },
  async (event) => {
    const lid = event.data?.data();
    if (!lid || lid.rol !== 'gast' || lid.status !== 'uitgenodigd') return;
    const { planId, uid } = event.params;
    const db = getFirestore();
    const transport = nodemailer.createTransport({
      host: SMTP_HOST.value(),
      port: SMTP_PORT.value(),
      secure: SMTP_SECURE.value(),
      auth: { user: GMAIL_USER.value(), pass: GMAIL_APP_PASSWORD.value() },
    });
    const status = await verwerkUitnodiging({
      db,
      auth: getAuth(),
      appUrl: APP_URL.value(),
      planId,
      uid,
      verstuur: ({ aan, subject, text, html }) =>
        transport.sendMail({ from: { name: 'Podiumagenda', address: GMAIL_USER.value() }, to: aan, subject, text, html }),
      log: (s, code) => logger.info('uitnodigingsmail', { status: s, code: code ?? null }),
    });
    // Geen persoonsgegevens in de log: alleen de status en het plan.
    logger.info('uitnodigingsmail', { status, planId });
    await ruimOp({ db }).catch((err) => logger.warn('mailLog opruimen mislukt', { code: err?.code ?? null }));
  }
);

export const stopFacturering = onMessagePublished({ topic: BUDGET_TOPIC, retry: false, maxInstances: 1 }, async (event) => {
  const { CloudBillingClient } = await import('@google-cloud/billing');
  const projectId = process.env.GCLOUD_PROJECT || JSON.parse(process.env.FIREBASE_CONFIG || '{}').projectId;
  const status = await verwerkBudgetBericht({
    data: event.data?.message?.data,
    projectId,
    dryRun: DRY_RUN.value(),
    billing: new CloudBillingClient(),
    log: (s, extra) => logger.warn('stopFacturering', { status: s, ...(extra ?? {}) }),
  });
  logger.warn('stopFacturering', { status, dryRun: DRY_RUN.value() });
});

// Elke dag om 05:00 in Amsterdam (zomer- en wintertijd) de nachtelijke run
// starten. Geen herhaling (retryCount 0): een tweede poging zou een dubbele
// run kunnen geven; mislukt het, dan vangt de cron in de workflow het op.
// De workflow stopt zelf als de data vandaag al ververst is.
export const startNachtrun = onSchedule(
  {
    schedule: '0 5 * * *',
    timeZone: 'Europe/Amsterdam',
    secrets: [GITHUB_DISPATCH_TOKEN],
    retryCount: 0,
    timeoutSeconds: 30,
    maxInstances: 1,
    memory: '256MiB',
  },
  async () => {
    const status = await startRefresh({
      token: GITHUB_DISPATCH_TOKEN.value(),
      // Nooit het token: alleen status, HTTP-code en een opgeschoonde melding.
      log: (s, extra) => (s === 'gestart' ? logger.info : logger.error)('startNachtrun', { status: s, ...extra }),
    });
    if (status !== 'gestart') logger.error('startNachtrun', { status, uitkomst: 'niet gestart; de cron van GitHub is het vangnet' });
  }
);

// Vrienden zoeken op volledige naam: alleen ingelogd, hooguit ZOEK_LIMIET
// keer per dag per gebruiker. Geeft alleen gebruikersnaam en naam terug.
// Geen namen in de log: alleen de status en het aantal treffers.
export const zoekOpNaam = onCall({ maxInstances: 2, timeoutSeconds: 20, memory: '256MiB' }, async (req) => {
  if (!req.auth?.uid) throw new HttpsError('unauthenticated', 'Log in om te zoeken.');
  const db = getFirestore();
  const r = await zoekOpNaamKern({ db, uid: req.auth.uid, invoer: req.data?.naam });
  logger.info('zoekOpNaam', { status: r.status, treffers: r.treffers?.length ?? 0 });
  if (r.status === 'ongeldig') throw new HttpsError('invalid-argument', 'Vul een voornaam en achternaam in.');
  if (r.status === 'limiet') throw new HttpsError('resource-exhausted', `Je hebt vandaag al ${ZOEK_LIMIET} keer op naam gezocht. Probeer het morgen weer.`);
  await ruimZoekTellersOp({ db }).catch((err) => logger.warn('zoekTellers opruimen mislukt', { code: err?.code ?? null }));
  return { treffers: r.treffers };
});

// De zoekindex volgt het profiel en de voorkeur "Vindbaar op naam".
const indexeer = (bron) => async (event) => {
  const status = await indexeerNaam({ db: getFirestore(), uid: event.params.uid });
  logger.info('naamIndex', { bron, status });
};
export const naamIndexProfiel = onDocumentWritten({ document: 'profielen/{uid}', retry: false, maxInstances: 2 }, indexeer('profiel'));
export const naamIndexVoorkeur = onDocumentWritten({ document: 'naamvoorkeur/{uid}', retry: false, maxInstances: 2 }, indexeer('voorkeur'));
