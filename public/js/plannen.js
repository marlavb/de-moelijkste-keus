// Gedeelde plannen en uitnodigingen (vrienden, stap 4, okt 2026). Zonder
// Firestore-imports: de functies komen als argument `fs` binnen (zoals in
// profiel.js, vrienden.js en gedeeld.js), zodat app en emulator-tests
// dezelfde code gebruiken. firestore.rules dwingt alles ook af.
//
// Datamodel:
//   plannen/{planId}: { eigenaar, sleutel, sleutelV, voorstelling, speeldag,
//                       genodigden, opgeheven, aangemaaktOp, gewijzigdOp }
//     voorstelling: { titel, theaterId, theaterNaam, stad, datum, tijd }
//       (momentopname; wijzigingen ziet ieder lid zelf via shows.json)
//     speeldag: middernacht UTC van datum (voor de rules: niet in het verleden)
//     genodigden: uids van iedereen die is uitgenodigd (max. 10, zonder de
//       organisator); bepaalt wie het plan mag lezen
//   plannen/{planId}/leden/{uid}: { uid, planId, rol, status, uitgenodigdDoor,
//                                   uitgenodigdOp, reactieOp?, kaarten }
//     rol 'organisator' (status altijd 'gaat') of 'gast'
//     status: 'uitgenodigd' → 'gaat' | 'kan-niet'; 'gaat' → 'weg'
//   inbox/{uid}/berichten/{id}: { soort, van, planId, aangemaaktOp, gelezen }
//     soort: 'uitnodiging' (organisator → gast), 'gaat-mee' / 'kan-niet' /
//     'weg' (gast → organisator), 'opgeheven' (organisator → genodigden).
//     Geen namen of titels: die komen bij het tonen uit het plan en de
//     profielen.
// Mail (stap 5): reageert op het aanmaken van een lid met rol 'gast' en
// status 'uitgenodigd'. Clients schrijven niets in een mailcollectie.
//
// `fs` = { doc, getDoc, getDocs, setDoc, writeBatch, collection, query,
//          where, orderBy, serverTimestamp }.

import { geplandSleutel } from './gepland.js';
import { NORMALISATIE_VERSIE } from './watchlist.js';

export const MAX_GENODIGDEN = 10;
export const BERICHT_DAGEN = 60;
export const STATUS_LABELS = {
  gaat: 'gaat mee',
  uitgenodigd: 'heeft nog niet gereageerd',
  'kan-niet': 'kan niet',
  weg: 'gaat niet meer',
};

export class PlanFout extends Error {
  constructor(code, bericht) {
    super(bericht);
    this.code = code;
  }
}

const isGeweigerd = (err) => err?.code === 'permission-denied' || err?.code === 'firestore/permission-denied';

/**
 * Middernacht UTC van een ISO-datum ('2026-10-18'). Alleen voor de rules
 * (die kennen geen tijdzones); de app rekent met amsterdamDatum().
 */
export function speeldagVan(datum) {
  const [j, m, d] = String(datum).split('-').map(Number);
  return new Date(Date.UTC(j, m - 1, d));
}

const AMSTERDAM = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Amsterdam', year: 'numeric', month: '2-digit', day: '2-digit' });

/** De datum in Amsterdam ('YYYY-MM-DD'), ook in zomer- en wintertijd en op een toestel in een andere tijdzone. */
export function amsterdamDatum(nu = Date.now()) {
  const d = Object.fromEntries(AMSTERDAM.formatToParts(new Date(nu)).map((p) => [p.type, p.value]));
  return `${d.year}-${d.month}-${d.day}`;
}

/** Vandaag of later, in Amsterdam: dan kun je nog uitnodigen of meegaan. */
export function isNogTePlannen(datum, vandaag = amsterdamDatum()) {
  return typeof datum === 'string' && datum >= vandaag;
}

/** De momentopname van de voorstelling uit een gepland-item. */
export function voorstellingVan(item) {
  return {
    titel: item.titel,
    theaterId: item.theaterId,
    theaterNaam: item.theaterNaam ?? '',
    stad: item.stad ?? '',
    datum: item.datum,
    tijd: item.tijd ?? null,
  };
}

const planRef = (fs, db, planId) => fs.doc(db, 'plannen', planId);
const lidRef = (fs, db, planId, uid) => fs.doc(db, 'plannen', planId, 'leden', uid);
const nieuwBericht = (fs, db, ontvanger) => fs.doc(fs.collection(db, 'inbox', ontvanger, 'berichten'));
const bericht = (fs, soort, van, planId) => ({ soort, van, planId, aangemaaktOp: fs.serverTimestamp(), gelezen: false });

/** Een nieuw planId (Firestore-id), zonder te schrijven. */
export function nieuwPlanId({ db, fs }) {
  return fs.doc(fs.collection(db, 'plannen')).id;
}

/**
 * Nodigt één vriend uit. Zonder `planId` wordt het plan eerst gedeeld (plan +
 * organisator, in dezelfde batch). Eén batch per vriend: de rules controleren
 * per uitnodiging vriendschap en blokkades (zie firestore.rules).
 * `plan` = het huidige plandocument (of null bij een nieuw plan).
 * Geeft het (nieuwe) planId. Fouten: PlanFout 'vol', 'al-uitgenodigd',
 * 'niet-mogelijk' (geweigerd door de rules: geen vriend, blokkade, voorbij, …).
 */
export async function nodigUit({ db, fs, ik, item, planId = null, plan = null, gast }) {
  const genodigden = plan?.genodigden ?? [];
  if (genodigden.includes(gast)) throw new PlanFout('al-uitgenodigd', 'Al uitgenodigd.');
  if (genodigden.length >= MAX_GENODIGDEN) throw new PlanFout('vol', `Je kunt hooguit ${MAX_GENODIGDEN} vrienden uitnodigen.`);
  const id = planId ?? nieuwPlanId({ db, fs });
  const b = fs.writeBatch(db);
  const nu = fs.serverTimestamp();
  if (!planId) {
    b.set(planRef(fs, db, id), {
      eigenaar: ik,
      sleutel: item.sleutel ?? geplandSleutel(item),
      sleutelV: NORMALISATIE_VERSIE,
      voorstelling: voorstellingVan(item),
      speeldag: speeldagVan(item.datum),
      genodigden: [gast],
      opgeheven: false,
      aangemaaktOp: nu,
      gewijzigdOp: nu,
    });
    b.set(lidRef(fs, db, id, ik), {
      uid: ik, planId: id, rol: 'organisator', status: 'gaat', uitgenodigdDoor: ik, uitgenodigdOp: nu, kaarten: item.status === 'kaarten',
    });
  } else {
    b.update(planRef(fs, db, id), { genodigden: [...genodigden, gast], gewijzigdOp: nu });
  }
  b.set(lidRef(fs, db, id, gast), {
    uid: gast, planId: id, rol: 'gast', status: 'uitgenodigd', uitgenodigdDoor: ik, uitgenodigdOp: nu, kaarten: false,
  });
  b.set(nieuwBericht(fs, db, gast), bericht(fs, 'uitnodiging', ik, id));
  try {
    await b.commit();
  } catch (err) {
    if (isGeweigerd(err)) throw new PlanFout('niet-mogelijk', 'Deze uitnodiging kan niet worden verstuurd.');
    throw err;
  }
  return id;
}

/** Uitnodiging intrekken (alleen de organisator). */
export function trekIn({ db, fs, planId, plan, gast }) {
  const b = fs.writeBatch(db);
  b.update(planRef(fs, db, planId), { genodigden: (plan.genodigden ?? []).filter((u) => u !== gast), gewijzigdOp: fs.serverTimestamp() });
  b.delete(lidRef(fs, db, planId, gast));
  return b.commit();
}

/**
 * Eigen status zetten als gast ('gaat', 'kan-niet' of 'weg'), met een
 * bericht aan de organisator in dezelfde batch. Weigeren de rules alleen het
 * bericht (bv. de organisator heeft je inmiddels geblokkeerd), dan wordt de
 * status zonder bericht gezet.
 */
export async function zetMijnStatus({ db, fs, ik, planId, eigenaar, status }) {
  const wijziging = { status, reactieOp: fs.serverTimestamp() };
  const b = fs.writeBatch(db);
  b.update(lidRef(fs, db, planId, ik), wijziging);
  b.set(nieuwBericht(fs, db, eigenaar), bericht(fs, status === 'gaat' ? 'gaat-mee' : status, ik, planId));
  try {
    await b.commit();
  } catch (err) {
    if (!isGeweigerd(err)) throw err;
    const zonder = fs.writeBatch(db);
    zonder.update(lidRef(fs, db, planId, ik), { status, reactieOp: fs.serverTimestamp() });
    try {
      await zonder.commit();
    } catch (err2) {
      if (isGeweigerd(err2)) throw new PlanFout('niet-mogelijk', 'Dit kan niet (meer): de uitnodiging is ingetrokken, opgeheven of voorbij.');
      throw err2;
    }
  }
}

/** Eigen "kaarten" in het plan (zichtbaar voor de leden). */
export function zetKaarten({ db, fs, ik, planId, kaarten }) {
  const b = fs.writeBatch(db);
  b.update(lidRef(fs, db, planId, ik), { kaarten: kaarten === true });
  return b.commit();
}

/**
 * Plan opheffen (alleen de organisator), met een bericht aan wie nog
 * uitgenodigd is of meegaat. Weigeren de rules een bericht (blokkade), dan
 * zonder berichten.
 */
export async function hefOp({ db, fs, ik, planId, leden }) {
  const ontvangers = (leden ?? []).filter((l) => l.uid !== ik && ['gaat', 'uitgenodigd'].includes(l.status)).map((l) => l.uid);
  const maak = (metBerichten) => {
    const b = fs.writeBatch(db);
    b.update(planRef(fs, db, planId), { opgeheven: true, gewijzigdOp: fs.serverTimestamp() });
    if (metBerichten) for (const u of ontvangers) b.set(nieuwBericht(fs, db, u), bericht(fs, 'opgeheven', ik, planId));
    return b;
  };
  try {
    await maak(true).commit();
  } catch (err) {
    if (!isGeweigerd(err) || ontvangers.length === 0) throw err;
    await maak(false).commit();
  }
}

/**
 * Plan met leden, of null als je het niet (meer) mag lezen of het niet
 * bestaat. Reads: 1 (plan) + 1 query (leden; 1 per lid).
 */
export async function laadPlan({ db, fs, planId }) {
  let plan;
  try {
    const snap = await fs.getDoc(planRef(fs, db, planId));
    if (!snap.exists()) return null;
    plan = { planId, ...snap.data() };
  } catch (err) {
    if (isGeweigerd(err)) return null;
    throw err;
  }
  const leden = await fs.getDocs(fs.collection(db, 'plannen', planId, 'leden'));
  return { plan, leden: leden.docs.map((d) => d.data()) };
}

const tijdMs = (t) => (typeof t?.toMillis === 'function' ? t.toMillis() : t instanceof Date ? t.getTime() : Number(t));

/** De speeldatum van een plan ('YYYY-MM-DD'). */
const datumVanPlan = (plan) => plan.voorstelling?.datum ?? new Date(tijdMs(plan.speeldag)).toISOString().slice(0, 10);

/** Is het plan voorbij? Na middernacht in Amsterdam (niet UTC). */
export const isPlanVoorbij = (plan, nu = Date.now()) => !isNogTePlannen(datumVanPlan(plan), amsterdamDatum(nu));

/**
 * "Met wie" voor één lid: de anderen die meegaan (met kaarten), en voor de
 * organisator ook wie nog niet reageerde, niet kan of niet meer gaat.
 * `naam(uid)` → '@naam' of 'iemand'.
 */
export function metWie({ plan, leden }, ik, naam) {
  const anderen = leden.filter((l) => l.uid !== ik);
  const gaan = anderen.filter((l) => l.status === 'gaat');
  const uit = {
    gaan: gaan.map((l) => ({ uid: l.uid, naam: naam(l.uid), kaarten: l.kaarten === true, organisator: l.rol === 'organisator' })),
    open: [],
    kanNiet: [],
    weg: [],
  };
  if (plan.eigenaar === ik) {
    for (const l of anderen) {
      if (l.status === 'uitgenodigd') uit.open.push({ uid: l.uid, naam: naam(l.uid) });
      if (l.status === 'kan-niet') uit.kanNiet.push({ uid: l.uid, naam: naam(l.uid) });
      if (l.status === 'weg') uit.weg.push({ uid: l.uid, naam: naam(l.uid) });
    }
  }
  return uit;
}

/** Tekstregels voor "met wie" (gaan eerst; organisator ziet ook de rest). */
export function metWieRegels(w) {
  const regels = [];
  if (w.gaan.length) regels.push(`Met ${w.gaan.map((g) => (g.kaarten ? `${g.naam} (kaarten ✓)` : g.naam)).join(', ')}`);
  const lijst = (xs) => xs.map((x) => x.naam).join(', ');
  if (w.open.length) regels.push(`${lijst(w.open)} ${w.open.length === 1 ? 'heeft' : 'hebben'} nog niet gereageerd`);
  if (w.kanNiet.length) regels.push(`${lijst(w.kanNiet)} ${w.kanNiet.length === 1 ? 'kan' : 'kunnen'} niet`);
  if (w.weg.length) regels.push(`${lijst(w.weg)} ${w.weg.length === 1 ? 'gaat' : 'gaan'} niet meer`);
  return regels;
}

// ---------- Berichten (inbox) ----------

const inbox = (fs, db, uid) => fs.collection(db, 'inbox', uid, 'berichten');

/** Alle eigen berichten, nieuwste eerst. Reads: 1 per bericht (minstens 1). */
export async function laadBerichten({ db, fs, ik }) {
  const snap = await fs.getDocs(fs.query(inbox(fs, db, ik), fs.orderBy('aangemaaktOp', 'desc')));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/** Gelezen zetten (één batch). */
export function markeerGelezen({ db, fs, ik, ids }) {
  if (ids.length === 0) return Promise.resolve();
  const b = fs.writeBatch(db);
  for (const id of ids) b.update(fs.doc(db, 'inbox', ik, 'berichten', id), { gelezen: true });
  return b.commit();
}

/** Berichten ouder dan BERICHT_DAGEN weghalen (één batch). Geeft de overgebleven. */
export async function ruimBerichtenOp({ db, fs, ik, berichten, nu = Date.now() }) {
  const grens = nu - BERICHT_DAGEN * 24 * 3600 * 1000;
  const oud = berichten.filter((b) => tijdMs(b.aangemaaktOp) < grens);
  if (oud.length) {
    const b = fs.writeBatch(db);
    for (const o of oud) b.delete(fs.doc(db, 'inbox', ik, 'berichten', o.id));
    await b.commit();
  }
  return berichten.filter((b) => !oud.includes(b));
}

/**
 * De actuele stand van een uitnodiging voor de ontvanger:
 * 'gaat' | 'kan-niet' | 'weg' | 'open' | 'ingetrokken' | 'opgeheven' | 'verlopen'.
 * `info` = laadPlan(...) of null (niet meer leesbaar: ingetrokken).
 */
export function uitnodigingStand(info, ik, nu = Date.now()) {
  if (!info) return 'ingetrokken';
  const lid = info.leden.find((l) => l.uid === ik);
  if (!lid) return 'ingetrokken';
  if (info.plan.opgeheven) return 'opgeheven';
  if (lid.status === 'gaat') return isPlanVoorbij(info.plan, nu) ? 'verlopen' : 'gaat';
  if (lid.status === 'kan-niet') return 'kan-niet';
  if (lid.status === 'weg') return 'weg';
  return isPlanVoorbij(info.plan, nu) ? 'verlopen' : 'open';
}
