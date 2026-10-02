// Profiel: gebruikersnaam en volledige naam (vrienden, stap 1, okt 2026).
// Zonder imports: de Firestore-functies komen als argument binnen, zodat de
// app (CDN) en de rules-tests (npm, emulator) dezelfde code gebruiken.
//
// Datamodel (alleen ingelogd; uitgelogd bestaat er geen profiel):
//   profielen/{uid}:        { gebruikersnaam, gebruikersnaamLaag, naam,
//                             aangemaaktOp, gewijzigdOp, v }
//   usernames/{laag}:       { uid, gebruikersnaam, naam }
// usernames/{laag} maakt de naam uniek (hoofdletterongevoelig: de id is de
// kleine-lettervorm). Kiezen en wijzigen gaat in één transactie: nieuwe naam
// vastleggen, profiel bijwerken, oude naam vrijgeven. firestore.rules dwingt
// af dat profiel en usernames bij elkaar passen.
// Gebruikersnaam: 3–20 tekens, letters a–z, cijfers, punt en liggend
// streepje; begint en eindigt met een letter of cijfer, geen twee leestekens
// achter elkaar. Hoofdletters blijven zichtbaar ("MarlaVB"), maar "marlavb"
// is dezelfde naam.

export const PROFIEL_VERSIE = 1;
export const GEBRUIKERSNAAM_MIN = 3;
export const GEBRUIKERSNAAM_MAX = 20;
export const NAAM_MAX = 60;

const VORM = /^[A-Za-z0-9]+(?:[._][A-Za-z0-9]+)*$/;

// Gereserveerd (exact), plus alles met "podiumagenda" of "podiumpas" erin.
// Dezelfde lijst staat in firestore.rules (gereserveerd()); een test houdt
// ze gelijk.
export const GERESERVEERDE_NAMEN = [
  'admin', 'administrator', 'anoniem', 'beheer', 'beheerder', 'berichten', 'bot',
  'contact', 'help', 'helpdesk', 'iedereen', 'info', 'moderator', 'null', 'profiel',
  'root', 'support', 'system', 'systeem', 'team', 'theater', 'theaters', 'undefined',
  'vrienden',
];
const GERESERVEERD_DEEL = /podiumagenda|podiumpas/;

export const GEBRUIKERSNAAM_UITLEG =
  '3 tot 20 tekens: letters, cijfers, punt of liggend streepje. Hiermee kunnen vrienden je vinden.';

export class ProfielFout extends Error {
  constructor(code, bericht) {
    super(bericht);
    this.code = code;
  }
}

/**
 * Controleert een ingetypte gebruikersnaam. Spaties eromheen en een "@" aan
 * het begin vallen weg. Geeft { ok, weergave, laag } of { ok: false, fout }.
 */
export function controleerGebruikersnaam(invoer) {
  const weergave = String(invoer ?? '').trim().replace(/^@/, '');
  if (weergave.length === 0) return { ok: false, fout: 'Kies een gebruikersnaam.' };
  if (weergave.length < GEBRUIKERSNAAM_MIN) return { ok: false, fout: `Een gebruikersnaam heeft minstens ${GEBRUIKERSNAAM_MIN} tekens.` };
  if (weergave.length > GEBRUIKERSNAAM_MAX) return { ok: false, fout: `Een gebruikersnaam heeft hooguit ${GEBRUIKERSNAAM_MAX} tekens.` };
  if (/\s/.test(weergave)) return { ok: false, fout: 'Een gebruikersnaam heeft geen spaties.' };
  if (!/^[A-Za-z0-9._]+$/.test(weergave)) {
    return { ok: false, fout: 'Gebruik alleen letters zonder accent, cijfers, een punt of een liggend streepje.' };
  }
  if (!VORM.test(weergave)) {
    return { ok: false, fout: 'Begin en eindig met een letter of cijfer, en zet geen twee leestekens achter elkaar.' };
  }
  const laag = weergave.toLowerCase();
  if (GERESERVEERDE_NAMEN.includes(laag) || GERESERVEERD_DEEL.test(laag)) {
    return { ok: false, fout: 'Deze gebruikersnaam is niet beschikbaar.' };
  }
  return { ok: true, weergave, laag };
}

/** Volledige naam: spaties samengevoegd, 1 tot NAAM_MAX tekens, geen stuurtekens. */
export function controleerNaam(invoer) {
  const naam = String(invoer ?? '').replace(/\s+/g, ' ').trim();
  if (naam.length === 0) return { ok: false, fout: 'Vul je naam in.' };
  if (naam.length > NAAM_MAX) return { ok: false, fout: `Je naam heeft hooguit ${NAAM_MAX} tekens.` };
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(naam)) return { ok: false, fout: 'Je naam bevat een ongeldig teken.' };
  return { ok: true, naam };
}

/** Een voorstel voor een gebruikersnaam uit de Google-naam ("Marla van B." → "marla.van.b"). */
export function voorstelGebruikersnaam(naam) {
  const basis = String(naam ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.+|\.+$/g, '')
    .slice(0, GEBRUIKERSNAAM_MAX)
    .replace(/\.+$/, '');
  return controleerGebruikersnaam(basis).ok ? basis : '';
}

/** Het profiel van `uid`, of null als er (nog) geen is. Gooit bij een netwerk- of rechtenfout. */
export async function laadProfiel({ db, fs, uid }) {
  const snap = await fs.getDoc(fs.doc(db, 'profielen', uid));
  return snap.exists() ? snap.data() : null;
}

/**
 * Kiest of wijzigt gebruikersnaam en naam in één transactie: is de naam van
 * een ander, dan ProfielFout('bezet'); anders profiel en usernames-document
 * schrijven en een eventuele oude naam vrijgeven. `fs` = { runTransaction,
 * doc, serverTimestamp }. Ongeldige invoer: ProfielFout('ongeldig').
 * Netwerkfouten komen ongewijzigd door (de app toont dan een eigen melding).
 */
export async function bewaarProfiel({ db, fs, uid, gebruikersnaam, naam }) {
  const g = controleerGebruikersnaam(gebruikersnaam);
  if (!g.ok) throw new ProfielFout('ongeldig', g.fout);
  const n = controleerNaam(naam);
  if (!n.ok) throw new ProfielFout('ongeldig', n.fout);

  return fs.runTransaction(db, async (tx) => {
    const profielRef = fs.doc(db, 'profielen', uid);
    const naamRef = fs.doc(db, 'usernames', g.laag);
    const huidig = await tx.get(profielRef);
    const bezet = await tx.get(naamRef);
    if (bezet.exists() && bezet.data().uid !== uid) {
      throw new ProfielFout('bezet', 'Deze gebruikersnaam is al bezet. Kies een andere.');
    }
    const oud = huidig.exists() ? huidig.data() : null;
    const profiel = {
      gebruikersnaam: g.weergave,
      gebruikersnaamLaag: g.laag,
      naam: n.naam,
      aangemaaktOp: oud?.aangemaaktOp ?? fs.serverTimestamp(),
      gewijzigdOp: fs.serverTimestamp(),
      v: PROFIEL_VERSIE,
    };
    tx.set(profielRef, profiel);
    tx.set(naamRef, { uid, gebruikersnaam: g.weergave, naam: n.naam });
    if (oud?.gebruikersnaamLaag && oud.gebruikersnaamLaag !== g.laag) {
      tx.delete(fs.doc(db, 'usernames', oud.gebruikersnaamLaag));
    }
    return { gebruikersnaam: g.weergave, gebruikersnaamLaag: g.laag, naam: n.naam };
  });
}
