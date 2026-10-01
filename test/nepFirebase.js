// Nep-versie van public/js/firebase.js voor de UI-tests (Playwright): geen
// netwerk, Firestore in het geheugen. Standaard uitgelogd, zoals de tests
// vóór de vrienden-functie. Met `gebruiker` ingelogd; `docs` = beginstand
// ({ 'pad/naar/doc': data }). In de pagina: window.__nepFirestore (de Map
// met documenten) en window.__nepOffline = true (elke lees- of schrijfactie
// faalt zoals offline).

export function nepFirebase({ gebruiker = null, docs = {} } = {}) {
  return `
const opslag = new Map(Object.entries(${JSON.stringify(docs)}));
window.__nepFirestore = opslag;
const offline = () => {
  if (window.__nepOffline) throw Object.assign(new Error('Failed to get document because the client is offline.'), { code: 'unavailable' });
};
const snap = (pad) => ({ exists: () => opslag.has(pad), data: () => structuredClone(opslag.get(pad)) });
export const auth = {}, db = {}, googleProvider = {};
export const onAuthStateChanged = (_a, cb) => setTimeout(() => cb(${JSON.stringify(gebruiker)}), 0);
export const signInWithPopup = async () => {}, signOut = async () => {};
export const doc = (_db, ...pad) => ({ path: pad.join('/') });
export const getDoc = async (ref) => { offline(); return snap(ref.path); };
export const setDoc = async (ref, data, opties) => {
  offline();
  opslag.set(ref.path, structuredClone(opties?.merge ? { ...(opslag.get(ref.path) ?? {}), ...data } : data));
};
export const serverTimestamp = () => 'NU';
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
