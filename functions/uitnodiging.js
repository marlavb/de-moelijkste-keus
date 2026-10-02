// De uitnodigingsmail, zonder Cloud Functions-afhankelijkheden (zie index.js),
// zodat de tests het met de Firestore- en Auth-emulator kunnen draaien.
// - Opnieuw controleren vóór het versturen: plan bestaat en loopt, het lid
//   is nog uitgenodigd, de speeldag is niet voorbij (Amsterdam), vrienden
//   in beide richtingen, geen blokkade, mail niet uitgezet, een geverifieerd
//   adres in Auth.
// - Hooguit één mail per uitnodiging: mailLog/{planId}_{uid} wordt in
//   dezelfde transactie als de dagtellers vastgelegd, vóór het versturen.
// - Dagtellers (Amsterdamse dag): hooguit 10 per afzender, 5 per ontvanger,
//   100 in totaal.
// - Het e-mailadres komt alleen uit Auth, gaat alleen naar `verstuur`, en wordt
//   nooit opgeslagen of gelogd. Er wordt niets in plannen of leden geschreven.

import { Timestamp } from 'firebase-admin/firestore';
import { amsterdamDatum, maakUitnodigingsmail } from './mail.js';

export const LIMIETEN = { afzender: 10, ontvanger: 5, totaal: 100 };
export const LOG_DAGEN = 60;
const DAG_MS = 24 * 3600 * 1000;

/**
 * Geeft een korte status terug ('verstuurd', 'opgeheven', 'limiet-afzender', …).
 * `verstuur({ aan, subject, text, html })` verstuurt de mail.
 * `log(status, code?)` krijgt nooit persoonsgegevens.
 */
export async function verwerkUitnodiging({ db, auth, verstuur, appUrl, planId, uid, nu = Date.now(), log = () => {} }) {
  const planSnap = await db.doc(`plannen/${planId}`).get();
  if (!planSnap.exists) return 'geen-plan';
  const plan = planSnap.data();
  if (plan.opgeheven) return 'opgeheven';
  const lid = (await db.doc(`plannen/${planId}/leden/${uid}`).get()).data();
  if (!lid || lid.rol !== 'gast' || lid.status !== 'uitgenodigd') return 'geen-open-uitnodiging';
  if (!plan.voorstelling?.datum || amsterdamDatum(nu) > plan.voorstelling.datum) return 'voorbij';

  const eigenaar = plan.eigenaar;
  const [vriendHeen, vriendTerug, blokHeen, blokTerug, voorkeur, uitnodiger] = await Promise.all([
    db.doc(`vrienden/${eigenaar}/lijst/${uid}`).get(),
    db.doc(`vrienden/${uid}/lijst/${eigenaar}`).get(),
    db.doc(`blokkades/${eigenaar}/lijst/${uid}`).get(),
    db.doc(`blokkades/${uid}/lijst/${eigenaar}`).get(),
    db.doc(`mailvoorkeur/${uid}`).get(),
    db.doc(`profielen/${eigenaar}`).get(),
  ]);
  if (!vriendHeen.exists || !vriendTerug.exists) return 'geen-vrienden';
  if (blokHeen.exists || blokTerug.exists) return 'blokkade';
  if (voorkeur.exists && voorkeur.data().uitnodigingen === false) return 'mail-uit';
  if (!uitnodiger.exists) return 'geen-profiel';

  let gebruiker;
  try {
    gebruiker = await auth.getUser(uid);
  } catch {
    return 'geen-account';
  }
  if (!gebruiker.email || !gebruiker.emailVerified) return 'geen-adres';

  const dag = amsterdamDatum(nu);
  const logRef = db.doc(`mailLog/${planId}_${uid}`);
  const telRef = db.doc(`mailTellers/${dag}`);
  const besluit = await db.runTransaction(async (tx) => {
    const [vastgelegd, tellerSnap] = await Promise.all([tx.get(logRef), tx.get(telRef)]);
    if (vastgelegd.exists) return 'al-verwerkt';
    const t = tellerSnap.exists ? tellerSnap.data() : { totaal: 0, afzender: {}, ontvanger: {} };
    const afzender = t.afzender?.[eigenaar] ?? 0;
    const ontvanger = t.ontvanger?.[uid] ?? 0;
    const over =
      (t.totaal ?? 0) >= LIMIETEN.totaal ? 'totaal' : afzender >= LIMIETEN.afzender ? 'afzender' : ontvanger >= LIMIETEN.ontvanger ? 'ontvanger' : null;
    const basis = { planId, dag, aangemaaktOp: Timestamp.fromMillis(nu) };
    if (over) {
      tx.set(logRef, { ...basis, status: `limiet-${over}` });
      return `limiet-${over}`;
    }
    tx.set(logRef, { ...basis, status: 'bezig' });
    tx.set(telRef, {
      dag,
      totaal: (t.totaal ?? 0) + 1,
      afzender: { ...(t.afzender ?? {}), [eigenaar]: afzender + 1 },
      ontvanger: { ...(t.ontvanger ?? {}), [uid]: ontvanger + 1 },
      bijgewerktOp: Timestamp.fromMillis(nu),
    });
    return 'versturen';
  });
  if (besluit !== 'versturen') {
    log(besluit);
    return besluit;
  }

  const mail = maakUitnodigingsmail({ uitnodiger: uitnodiger.data(), voorstelling: plan.voorstelling, appUrl });
  try {
    await verstuur({ aan: gebruiker.email, ...mail });
  } catch (err) {
    // Alleen de foutcode: een SMTP-melding kan het adres bevatten.
    await logRef.update({ status: 'mislukt' });
    log('mislukt', err?.code ?? err?.responseCode ?? null);
    return 'mislukt';
  }
  await logRef.update({ status: 'verstuurd' });
  return 'verstuurd';
}

/** mailLog en mailTellers ouder dan LOG_DAGEN weghalen (hooguit 200 per keer). */
export async function ruimOp({ db, nu = Date.now() }) {
  const grens = Timestamp.fromMillis(nu - LOG_DAGEN * DAG_MS);
  const grensDag = amsterdamDatum(nu - LOG_DAGEN * DAG_MS);
  const [oudeLogs, oudeTellers] = await Promise.all([
    db.collection('mailLog').where('aangemaaktOp', '<', grens).limit(100).get(),
    db.collection('mailTellers').where('dag', '<', grensDag).limit(100).get(),
  ]);
  if (oudeLogs.empty && oudeTellers.empty) return 0;
  const b = db.batch();
  for (const d of [...oudeLogs.docs, ...oudeTellers.docs]) b.delete(d.ref);
  await b.commit();
  return oudeLogs.size + oudeTellers.size;
}
