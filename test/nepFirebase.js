// Nep-versie van public/js/firebase.js voor de UI-tests (Playwright): geen
// netwerk, Firestore in het geheugen. Standaard uitgelogd, zoals de tests
// vóór de vrienden-functie. Met `gebruiker` ingelogd; `docs` = beginstand
// ({ 'pad/naar/doc': data }). In de pagina:
//   window.__nepFirestore  de Map met documenten;
//   window.__nepOffline    true → elke lees- of schrijfactie faalt zoals offline;
//   window.__nepWeiger     functie (pad) → true: schrijven naar dat pad wordt
//                          geweigerd zoals door de rules (permission-denied);
//   window.__nepSchrijf    lijst van alle geslaagde schrijfacties ['set'|'delete', pad].
// Queries: alleen gelijkheid (where(veld, '==', waarde)) op directe kinderen.

export function nepFirebase({ gebruiker = null, docs = {} } = {}) {
  return `
const opslag = new Map(Object.entries(${JSON.stringify(docs)}));
window.__nepFirestore = opslag;
window.__nepSchrijf = [];
const offline = () => {
  if (window.__nepOffline) throw Object.assign(new Error('Failed to get document because the client is offline.'), { code: 'unavailable' });
};
const weiger = (pad) => {
  if (window.__nepWeiger?.(pad)) throw Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' });
};
const snap = (pad) => ({ id: pad.split('/').pop(), exists: () => opslag.has(pad), data: () => structuredClone(opslag.get(pad)) });
const kinderen = (q) => [...opslag.keys()]
  .filter((pad) => pad.startsWith(q.path + '/') && !pad.slice(q.path.length + 1).includes('/'))
  .filter((pad) => (q.waar ?? []).every((w) => opslag.get(pad)?.[w.veld] === w.waarde));
export const auth = {}, db = {}, googleProvider = {};
export const onAuthStateChanged = (_a, cb) => setTimeout(() => cb(${JSON.stringify(gebruiker)}), 0);
export const signInWithPopup = async () => {}, signOut = async () => {};
export const doc = (_db, ...pad) => ({ path: pad.join('/') });
export const collection = (_db, ...pad) => ({ path: pad.join('/') });
export const where = (veld, _op, waarde) => ({ veld, waarde });
export const query = (col, ...waar) => ({ path: col.path, waar });
export const getDoc = async (ref) => { offline(); return snap(ref.path); };
export const getDocs = async (q) => { offline(); const docs = kinderen(q).map(snap); return { docs, size: docs.length, empty: docs.length === 0 }; };
export const getCountFromServer = async (q) => { offline(); const n = kinderen(q).length; return { data: () => ({ count: n }) }; };
export const setDoc = async (ref, data, opties) => {
  offline();
  weiger(ref.path);
  opslag.set(ref.path, structuredClone(opties?.merge ? { ...(opslag.get(ref.path) ?? {}), ...data } : data));
  window.__nepSchrijf.push(['set', ref.path]);
};
export const deleteDoc = async (ref) => { offline(); weiger(ref.path); opslag.delete(ref.path); window.__nepSchrijf.push(['delete', ref.path]); };
export const writeBatch = () => {
  const stappen = [];
  return {
    set: (ref, data) => { stappen.push(['set', ref.path, data]); },
    delete: (ref) => { stappen.push(['delete', ref.path]); },
    commit: async () => {
      offline();
      for (const [, pad] of stappen) weiger(pad);
      for (const [soort, pad, data] of stappen) {
        soort === 'set' ? opslag.set(pad, structuredClone(data)) : opslag.delete(pad);
        window.__nepSchrijf.push([soort, pad]);
      }
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
