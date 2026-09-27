// Hernoemde favorieten-sleutels (theaterId::titel).
//
// Waarom: in sep 2026 is de ITA-site vernieuwd. De oude agendapagina kapte
// lange titels af ("…Achievemen..."), de nieuwe geeft de volledige titel —
// en bij GONE juist een kortere. Favorieten hangen aan de titel, dus zonder
// deze hernoeming zouden favorieten op deze 7 producties stil verdwijnen.
//
// Weg mag: zodra de laatste van deze producties voorbij is — Saskia
// Belleman e.a., laatste voorstelling 10 mei 2027. Daarna staat geen van
// deze titels nog in de data en doet de hernoeming niets meer.
export const RENAMED_FAVORITE_KEYS = new Map([
  ['ita::Black Renaissance(s) - Opening Black Achievemen...', 'ita::Black Renaissance(s) - Opening Black Achievement Month'], // t/m 2026-10-01
  ['ita::Openbare rondleiding in samenwerking met Amster...', 'ita::Openbare rondleiding in samenwerking met Amsterdam Museum'], // t/m 2026-11-21
  ['ita::Rooted in Culture: UK Sounds influencing House ...', 'ita::Rooted in Culture: UK Sounds influencing House culture'], // t/m 2026-10-24
  ['ita::EN NOU GAAN WE EVEN HELEMAAL UIT ONZE PLAAT (ee...', 'ita::EN NOU GAAN WE EVEN HELEMAAL UIT ONZE PLAAT (een topshow) (6+)'], // t/m 2027-01-20
  ['ita::GONE -  Inspired by Benjamin Clementine', 'ita::GONE'], // t/m 2027-03-19
  ['ita::Geert Mak - een helder theatercollege over de h...', 'ita::Geert Mak - een helder theatercollege over de huidige situatie in de wereld'], // t/m 2027-04-19
  ['ita::Saskia Belleman, Petra Urban & Wilson Boldewijn...', 'ita::Saskia Belleman, Petra Urban & Wilson Boldewijn - Naakt voor de rechter'], // t/m 2027-05-10
]);

/**
 * Vervangt oude sleutels door hun nieuwe naam. Idempotent en zonder
 * "al gedaan"-vlag: bij elke keer laden opnieuw toepasbaar. Staan oud én
 * nieuw er allebei in, dan verdwijnt alleen de oude. Geeft een nieuwe Set
 * terug plus of er iets veranderd is (alleen dan hoeft er iets opgeslagen).
 */
export function applyFavoriteRenames(favorites, renames = RENAMED_FAVORITE_KEYS) {
  const result = new Set(favorites);
  let changed = false;
  for (const [oldKey, newKey] of renames) {
    if (!result.has(oldKey)) continue;
    result.delete(oldKey);
    result.add(newKey);
    changed = true;
  }
  return { favorites: result, changed };
}

/**
 * applyFavoriteRenames + opslaan, maar alléén als er iets veranderd is.
 * `persist` krijgt de nieuwe Set (localStorage of Firestore, aan de caller).
 */
export function renameFavoritesAndPersist(favorites, persist) {
  const { favorites: renamed, changed } = applyFavoriteRenames(favorites);
  if (changed) persist(renamed);
  return renamed;
}
