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

// Verhuisde theaters: favorieten van theater `van` horen bij `naar`.
//
// Waarom: Schouwburg Amstelveen is dicht wegens verbouwing (heropening
// december 2027, zie config.js); alle voorstellingen staan in Theater De
// Landing. Tot sep 2026 stond elke voorstelling bij allebei, dus favorieten
// kunnen `amstelveen::…` zijn voor een productie die nu `delanding::…` is.
//
// Datagestuurd i.p.v. een einddatum: een sleutel wordt alleen omgezet als
// de productie in de huidige data níet bij `van` bestaat en wél bij `naar`.
// Speelt de Schouwburg na de heropening een eigen productie X, dan blijft
// `amstelveen::X` gewoon staan. Zonder geladen data wordt niets omgezet.
export const THEATER_MOVES = [{ van: 'amstelveen', naar: 'delanding' }];

/**
 * Zet favorieten van verhuisde theaters om. `productionKeys` is de Set van
 * theaterId::titel uit de huidige shows.json. Idempotent, zonder vlag; staan
 * oud en nieuw er allebei, dan verdwijnt alleen de oude.
 */
export function applyTheaterMoves(favorites, productionKeys, moves = THEATER_MOVES) {
  const result = new Set(favorites);
  let changed = false;
  if (!productionKeys || productionKeys.size === 0) return { favorites: result, changed };
  for (const key of favorites) {
    const move = moves.find((m) => key.startsWith(`${m.van}::`));
    if (!move) continue;
    const titel = key.slice(move.van.length + 2);
    const newKey = `${move.naar}::${titel}`;
    if (productionKeys.has(key) || !productionKeys.has(newKey)) continue;
    result.delete(key);
    result.add(newKey);
    changed = true;
  }
  return { favorites: result, changed };
}

/**
 * applyFavoriteRenames + applyTheaterMoves + opslaan, maar alléén als er
 * iets veranderd is. `persist` krijgt de nieuwe Set (localStorage of
 * Firestore, aan de caller); `productionKeys` komt uit de geladen data.
 */
export function renameFavoritesAndPersist(favorites, persist, productionKeys = new Set()) {
  const renamed = applyFavoriteRenames(favorites);
  const moved = applyTheaterMoves(renamed.favorites, productionKeys);
  if (renamed.changed || moved.changed) persist(moved.favorites);
  return moved.favorites;
}
