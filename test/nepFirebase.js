// Nep-versie van public/js/firebase.js voor de UI-tests (Playwright): geen
// netwerk, Firestore in het geheugen. Standaard uitgelogd, zoals de tests
// vóór de vrienden-functie. Met `gebruiker` ingelogd; `docs` = beginstand
// ({ 'pad/naar/doc': data }). In de pagina:
//   window.__nepFirestore  de Map met documenten;
//   window.__nepOffline    true → elke lees- of schrijfactie faalt zoals offline;
//   window.__nepWeiger     functie (pad) → true: schrijven naar dat pad wordt
//                          geweigerd zoals door de rules (permission-denied);
//   window.__nepSchrijf    lijst van alle geslaagde schrijfacties ['set'|'delete', pad];
//   window.__nepLees       aantal leesacties (getDoc, getDocs, getCountFromServer).
// Queries: alleen gelijkheid (where(veld, '==', waarde)) en orderBy op directe
// kinderen. doc(collectie) zonder pad geeft een nieuw id; onSnapshot geeft
// de stand meteen en na elke schrijfactie opnieuw.

export function nepFirebase({ gebruiker = null, docs = {} } = {}) {
  return `
const opslag = new Map(Object.entries(${JSON.stringify(docs)}));
window.__nepFirestore = opslag;
window.__nepSchrijf = [];
window.__nepLees = 0;
const offline = () => {
  if (window.__nepOffline) throw Object.assign(new Error('Failed to get document because the client is offline.'), { code: 'unavailable' });
};
const weiger = (pad) => {
  if (window.__nepWeiger?.(pad)) throw Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' });
};
const snap = (pad) => ({ id: pad.split('/').pop(), exists: () => opslag.has(pad), data: () => structuredClone(opslag.get(pad)) });
const tijd = (w) => (w instanceof Date ? w.getTime() : typeof w === 'string' && /^\\d{4}-/.test(w) ? Date.parse(w) : Number(w));
const kinderen = (q) => {
  const paden = [...opslag.keys()]
    .filter((pad) => pad.startsWith(q.path + '/') && !pad.slice(q.path.length + 1).includes('/'))
    .filter((pad) => (q.waar ?? []).every((w) => opslag.get(pad)?.[w.veld] === w.waarde));
  if (q.volgorde) {
    const { veld, richting } = q.volgorde;
    paden.sort((a, b) => (tijd(opslag.get(a)?.[veld]) - tijd(opslag.get(b)?.[veld])) * (richting === 'desc' ? -1 : 1));
  }
  return paden;
};
let teller = 0;
const luisteraars = new Set();
const meld = () => { for (const l of luisteraars) l(); };
export const auth = {}, db = {}, googleProvider = {};
export const onAuthStateChanged = (_a, cb) => setTimeout(() => cb(${JSON.stringify(gebruiker)}), 0);
export const signInWithPopup = async () => {}, signOut = async () => {};
export const doc = (a, ...pad) => {
  if (a?.path !== undefined && pad.length === 0) {
    const id = 'auto' + String(++teller).padStart(4, '0');
    return { path: a.path + '/' + id, id };
  }
  return { path: pad.join('/'), id: pad[pad.length - 1] };
};
export const collection = (_db, ...pad) => ({ path: pad.join('/') });
export const where = (veld, _op, waarde) => ({ soort: 'waar', veld, waarde });
export const orderBy = (veld, richting = 'asc') => ({ soort: 'volgorde', veld, richting });
export const query = (col, ...delen) => ({
  path: col.path,
  waar: delen.filter((d) => d.soort === 'waar'),
  volgorde: delen.find((d) => d.soort === 'volgorde') ?? null,
});
export const onSnapshot = (q, volgende, fout) => {
  const stuur = () => {
    try {
      offline();
      const docs = kinderen(q).map(snap);
      volgende({ docs, size: docs.length, empty: docs.length === 0 });
    } catch (e) {
      fout?.(e);
    }
  };
  luisteraars.add(stuur);
  setTimeout(stuur, 0);
  return () => luisteraars.delete(stuur);
};
export const getDoc = async (ref) => { offline(); window.__nepLees++; return snap(ref.path); };
export const getDocs = async (q) => { offline(); window.__nepLees++; const docs = kinderen(q).map(snap); return { docs, size: docs.length, empty: docs.length === 0 }; };
export const getCountFromServer = async (q) => { offline(); window.__nepLees++; const n = kinderen(q).length; return { data: () => ({ count: n }) }; };
export const setDoc = async (ref, data, opties) => {
  offline();
  weiger(ref.path);
  opslag.set(ref.path, structuredClone(opties?.merge ? { ...(opslag.get(ref.path) ?? {}), ...data } : data));
  window.__nepSchrijf.push(['set', ref.path]);
  meld();
};
export const deleteDoc = async (ref) => { offline(); weiger(ref.path); opslag.delete(ref.path); window.__nepSchrijf.push(['delete', ref.path]); meld(); };
export const writeBatch = () => {
  const stappen = [];
  return {
    set: (ref, data) => { stappen.push(['set', ref.path, data]); },
    update: (ref, data) => { stappen.push(['update', ref.path, data]); },
    delete: (ref) => { stappen.push(['delete', ref.path]); },
    commit: async () => {
      offline();
      for (const [, pad] of stappen) weiger(pad);
      for (const [soort, pad] of stappen) {
        if (soort === 'update' && !opslag.has(pad)) throw Object.assign(new Error('No document to update'), { code: 'not-found' });
      }
      for (const [soort, pad, data] of stappen) {
        if (soort === 'set') opslag.set(pad, structuredClone(data));
        else if (soort === 'update') opslag.set(pad, { ...opslag.get(pad), ...structuredClone(data) });
        else opslag.delete(pad);
        window.__nepSchrijf.push([soort, pad]);
      }
      meld();
    },
  };
};
export const serverTimestamp = () => Date.now();
export const runTransaction = async (_db, fn) => {
  offline();
  const schrijf = [];
  const uit = await fn({
    get: async (ref) => snap(ref.path),
    set: (ref, data) => schrijf.push(() => opslag.set(ref.path, structuredClone(data))),
    delete: (ref) => schrijf.push(() => opslag.delete(ref.path)),
  });
  offline();
  for (const f of schrijf) f();
  return uit;
};
`;
}
