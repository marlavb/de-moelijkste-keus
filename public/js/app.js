import {
  auth,
  db,
  googleProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
} from './firebase.js';

// Vaste volgorde/labels voor de theater-filterchips en -kaarten. Nieuwe
// theaters die nog niet in deze lijst staan, worden onderaan toegevoegd met
// hun volledige naam — zo blijft de UI werken als er later een stad/theater
// bijkomt.
const THEATER_ORDER = [
  'delamar',
  'bellevue',
  'meervaart',
  'ita',
  'kleinekomedie',
  'frascati',
  'carre',
  'amstelveen',
  'stadsschouwburgutrecht',
  'theaterkikker',
];
const THEATER_SHORT_NAMES = {
  delamar: 'DeLaMar',
  bellevue: 'Bellevue',
  meervaart: 'Meervaart',
  ita: 'ITA',
  kleinekomedie: 'Kleine Komedie',
  frascati: 'Frascati',
  carre: 'Carré',
  amstelveen: 'Amstelveen',
  stadsschouwburgutrecht: 'Stadsschouwburg Utrecht',
  theaterkikker: 'Kikker',
};
// Adressen staan niet in shows.json (dat is per-voorstelling data, niet per
// theater) — vaste, kleine lookup hier is prima voor 3 theaters in 1 stad.
const THEATER_INFO = {
  delamar: { adres: 'Marnixstraat 402' },
  bellevue: { adres: 'Leidsekade 90' },
  meervaart: { adres: 'Meer en Vaart 300' },
  ita: { adres: 'Leidseplein 26' },
  kleinekomedie: { adres: 'Amstel 56-58' },
  frascati: { adres: 'Nes 63' },
  carre: { adres: 'Amstel 115-125' },
  amstelveen: { adres: 'Stadsplein 100' },
  stadsschouwburgutrecht: { adres: 'Lucasbolwerk 24' },
  theaterkikker: { adres: 'Ganzenmarkt 14' },
};

// Alleen "uitverkocht" en "wachtlijst" krijgen een badge — "beschikbaar" is
// de default en verdient geen visuele ruis, en "onbekend" laten we bewust
// leeg in plaats van een misleidende "beschikbaar"-badge te tonen.
const BESCHIKBAARHEID_LABELS = {
  uitverkocht: 'Uitverkocht',
  wachtlijst: 'Wachtlijst',
};

const GENRE_CATEGORIES = [
  'Toneel',
  'Musical',
  'Cabaret',
  'Muziektheater',
  'Dans',
  'Familie & Jeugd',
  'Muziek & Concert',
  'Overig',
];

const WEEKDAYS = ['zo', 'ma', 'di', 'woe', 'do', 'vr', 'za'];
const WEEKDAYS_LONG = ['zondag', 'maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag'];
const MONTHS = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];
const MONTHS_LONG = [
  'januari', 'februari', 'maart', 'april', 'mei', 'juni',
  'juli', 'augustus', 'september', 'oktober', 'november', 'december',
];

const STORAGE_KEYS = {
  enabledTheaters: 'podiumagenda:enabledTheaters',
  favorites: 'podiumagenda:favorites',
};

// Standaard tonen we alleen voorstellingen tot 60 dagen vooruit — met 1136+
// voorstellingen tot in 2028 is "alles in één keer" geen bruikbare lijst.
// De gebruiker kan dit met één tik opheffen via de "toon meer"-knop.
const DEFAULT_WINDOW_DAYS = 60;

const state = {
  shows: [],
  theaterFilter: 'alle',
  genreFilter: 'alle',
  podiumpasOnly: false, // lokaal-only, zelfde behandeling als genreFilter — niet in localStorage/Firestore
  searchQuery: '', // lokaal-only, al lowercased/getrimd — niet in localStorage/Firestore
  searchQueryRaw: '', // ongewijzigde tekst, alleen voor weergave (bv. in de lege-staat-tekst)
  enabledTheaters: loadEnabledTheaters(),
  favorites: loadFavorites(),
  dateWindowDays: DEFAULT_WINDOW_DAYS,
  user: null, // Firebase User, of null als niet ingelogd (= lokaal-only, zoals voorheen)
  authError: null,
};

const els = {
  subtitle: document.getElementById('subtitle'),
  theaterFilters: document.getElementById('theaterFilters'),
  sheetTheaterFilters: document.getElementById('sheetTheaterFilters'),
  sheetGenreFilters: document.getElementById('sheetGenreFilters'),
  podiumpasToggle: document.getElementById('podiumpasToggle'),
  agendaList: document.getElementById('agendaList'),
  emptyState: document.getElementById('emptyState'),
  filterToggle: document.getElementById('filterToggle'),
  filterBadge: document.getElementById('filterBadge'),
  headerTitleGroup: document.getElementById('headerTitleGroup'),
  headerActions: document.getElementById('headerActions'),
  headerSearch: document.getElementById('headerSearch'),
  searchToggle: document.getElementById('searchToggle'),
  searchInput: document.getElementById('searchInput'),
  searchClose: document.getElementById('searchClose'),
  sheet: document.getElementById('filterSheet'),
  sheetBackdrop: document.getElementById('sheetBackdrop'),
  sheetClose: document.getElementById('sheetClose'),
  clearFilters: document.getElementById('clearFilters'),
  bottomNav: document.getElementById('bottomNav'),
  screens: {
    agenda: document.getElementById('screen-agenda'),
    detail: document.getElementById('screen-detail'),
    theaters: document.getElementById('screen-theaters'),
    favorieten: document.getElementById('screen-favorieten'),
  },
  detailBack: document.getElementById('detailBack'),
  detailFavorite: document.getElementById('detailFavorite'),
  detailBanner: document.getElementById('detailBanner'),
  detailGenre: document.getElementById('detailGenre'),
  detailTheater: document.getElementById('detailTheater'),
  detailStatusBadge: document.getElementById('detailStatusBadge'),
  detailTitle: document.getElementById('detailTitle'),
  detailDate: document.getElementById('detailDate'),
  detailTime: document.getElementById('detailTime'),
  detailAddress: document.getElementById('detailAddress'),
  detailDescription: document.getElementById('detailDescription'),
  detailOtherDatesWrap: document.getElementById('detailOtherDatesWrap'),
  detailOtherDates: document.getElementById('detailOtherDates'),
  detailCheckedAt: document.getElementById('detailCheckedAt'),
  detailReserveBtn: document.getElementById('detailReserveBtn'),
  detailReserveLabel: document.getElementById('detailReserveLabel'),
  detailAddCalendar: document.getElementById('detailAddCalendar'),
  theatersBack: document.getElementById('theatersBack'),
  theatersList: document.getElementById('theatersList'),
  theatersCount: document.getElementById('theatersCount'),
  theatersCities: document.getElementById('theatersCities'),
  favoritesList: document.getElementById('favoritesList'),
  favoritesEmpty: document.getElementById('favoritesEmpty'),
  authBox: document.getElementById('authBox'),
};

async function init() {
  const res = await fetch('data/shows.json');
  const shows = await res.json();
  shows.sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
  state.shows = shows;

  // Theaters die nog nooit eerder gezien zijn (nieuw in de data) staan
  // standaard aan.
  for (const id of new Set(shows.map((s) => s.theaterId))) {
    if (!(id in state.enabledTheaters)) state.enabledTheaters[id] = true;
  }
  saveEnabledTheaters();

  renderTheaterFilters();
  renderGenreFilters();
  renderPodiumpasToggle();
  renderFilterBadge();
  renderSubtitle();
  renderAgenda();

  els.filterToggle.addEventListener('click', openSheet);
  els.sheetClose.addEventListener('click', closeSheet);
  els.sheetBackdrop.addEventListener('click', closeSheet);
  els.searchToggle.addEventListener('click', openSearch);
  els.searchClose.addEventListener('click', closeSearch);
  els.searchInput.addEventListener('input', onSearchInput);
  els.searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeSearch();
  });
  els.podiumpasToggle.addEventListener('click', () => {
    state.podiumpasOnly = !state.podiumpasOnly;
    renderPodiumpasToggle();
    renderFilterBadge();
    renderAgenda();
  });
  els.clearFilters.addEventListener('click', () => {
    state.theaterFilter = 'alle';
    state.genreFilter = 'alle';
    state.podiumpasOnly = false;
    renderTheaterFilters();
    renderGenreFilters();
    renderPodiumpasToggle();
    renderFilterBadge();
    renderAgenda();
  });

  els.detailBack.addEventListener('click', () => navigate('#/'));
  els.theatersBack.addEventListener('click', () => navigate('#/'));
  els.bottomNav.addEventListener('click', (e) => {
    const btn = e.target.closest('.nav-item');
    if (!btn) return;
    if (btn.dataset.tab === 'agenda') navigate('#/');
    if (btn.dataset.tab === 'theaters') navigate('#/theaters');
    if (btn.dataset.tab === 'favorieten') navigate('#/favorieten');
  });

  window.addEventListener('hashchange', route);
  route();

  renderAuthBox();
  onAuthStateChanged(auth, handleAuthChange);

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {
      // Offline-ondersteuning is een bonus, geen vereiste — stil negeren.
    });
  }
}

// ---------- Routing ----------

function navigate(hash) {
  if (location.hash === hash) {
    route();
  } else {
    location.hash = hash;
  }
}

function route() {
  const hash = location.hash || '#/';
  closeSheet();

  if (hash.startsWith('#/show/')) {
    const id = decodeURIComponent(hash.slice('#/show/'.length));
    const show = state.shows.find((s) => s.id === id);
    if (show) {
      showScreen('detail');
      renderDetail(show);
      return;
    }
    // Onbekend id (bv. verouderde link) -> terug naar de agenda i.p.v. een lege pagina.
    location.hash = '#/';
    return;
  }

  if (hash === '#/theaters') {
    showScreen('theaters');
    renderTheatersScreen();
    return;
  }

  if (hash === '#/favorieten') {
    showScreen('favorieten');
    renderFavoritesScreen();
    return;
  }

  showScreen('agenda');
}

function showScreen(name) {
  for (const [key, el] of Object.entries(els.screens)) {
    el.hidden = key !== name;
  }
  els.bottomNav.hidden = name === 'detail';
  for (const btn of els.bottomNav.querySelectorAll('.nav-item')) {
    btn.classList.toggle('is-active', btn.dataset.tab === name);
  }
  window.scrollTo(0, 0);
}

// ---------- localStorage ----------

function loadEnabledTheaters() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEYS.enabledTheaters)) ?? {};
  } catch {
    return {};
  }
}

// Ingelogd -> Firestore is de bron van waarheid (sync tussen apparaten).
// Uitgelogd -> gewoon localStorage, zoals voorheen.
function saveEnabledTheaters() {
  if (state.user) {
    setDoc(userDocRef(state.user.uid), { enabledTheaters: state.enabledTheaters }, { merge: true }).catch(
      (err) => console.error('Kon theaterkeuze niet synchroniseren:', err)
    );
    return;
  }
  localStorage.setItem(STORAGE_KEYS.enabledTheaters, JSON.stringify(state.enabledTheaters));
}

function loadFavorites() {
  try {
    return new Set(JSON.parse(localStorage.getItem(STORAGE_KEYS.favorites)) ?? []);
  } catch {
    return new Set();
  }
}

function saveFavorites() {
  if (state.user) {
    setDoc(userDocRef(state.user.uid), { favorites: [...state.favorites] }, { merge: true }).catch((err) =>
      console.error('Kon favorieten niet synchroniseren:', err)
    );
    return;
  }
  localStorage.setItem(STORAGE_KEYS.favorites, JSON.stringify([...state.favorites]));
}

// ---------- Inloggen (optioneel) ----------

function userDocRef(uid) {
  return doc(db, 'users', uid);
}

async function handleAuthChange(user) {
  state.user = user;
  state.authError = null;

  if (user) {
    const ref = userDocRef(user.uid);
    try {
      const snap = await getDoc(ref);
      if (snap.exists()) {
        // Bestaande cloud-data is leidend (bv. al eerder op een ander apparaat ingelogd).
        const data = snap.data();
        state.favorites = new Set(data.favorites ?? []);
        state.enabledTheaters = data.enabledTheaters ?? state.enabledTheaters;
      } else {
        // Eerste keer inloggen op dit account: neem mee wat er lokaal al
        // stond, in plaats van dat stilzwijgend te laten vallen.
        await setDoc(ref, {
          favorites: [...state.favorites],
          enabledTheaters: state.enabledTheaters,
          updatedAt: serverTimestamp(),
        });
      }
    } catch (err) {
      console.error('Kon cloudgegevens niet laden:', err);
    }
  } else {
    state.favorites = loadFavorites();
    state.enabledTheaters = loadEnabledTheaters();
  }

  renderAuthBox();
  renderTheaterFilters();
  renderGenreFilters();
  renderFilterBadge();
  renderSubtitle();
  renderAgenda();

  const hash = location.hash || '#/';
  if (hash === '#/theaters') renderTheatersScreen();
  if (hash === '#/favorieten') renderFavoritesScreen();
  if (hash.startsWith('#/show/')) {
    const id = decodeURIComponent(hash.slice('#/show/'.length));
    const show = state.shows.find((s) => s.id === id);
    if (show) renderFavoriteButton(show);
  }
}

async function handleSignIn() {
  state.authError = null;
  try {
    await signInWithPopup(auth, googleProvider);
    // handleAuthChange wordt door onAuthStateChanged aangeroepen zodra dit slaagt.
  } catch (err) {
    console.error('Inloggen mislukt:', err);
    state.authError = 'Inloggen is niet gelukt. Probeer het opnieuw.';
    renderAuthBox();
  }
}

async function handleSignOut() {
  try {
    await signOut(auth);
  } catch (err) {
    console.error('Uitloggen mislukt:', err);
  }
}

const GOOGLE_ICON_SVG = `<svg width="18" height="18" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"/>
  <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"/>
  <path fill="#FBBC05" d="M3.964 10.706A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.706V4.962H.957A9.001 9.001 0 0 0 0 9c0 1.452.348 2.827.957 4.038l3.007-2.332z"/>
  <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.962L3.964 7.294C4.672 5.167 6.656 3.58 9 3.58z"/>
</svg>`;

function renderAuthBox() {
  if (!els.authBox) return;
  els.authBox.innerHTML = '';

  const box = document.createElement('div');
  box.className = 'auth-box' + (state.user ? ' auth-box--signed-in' : '');

  if (state.user) {
    if (state.user.photoURL) {
      const avatar = document.createElement('img');
      avatar.className = 'auth-avatar';
      avatar.src = state.user.photoURL;
      avatar.alt = '';
      avatar.referrerPolicy = 'no-referrer';
      box.appendChild(avatar);
    }

    const text = document.createElement('div');
    text.className = 'auth-box-text';
    const name = document.createElement('p');
    name.className = 'auth-box-title';
    name.textContent = state.user.displayName || state.user.email || 'Ingelogd';
    const sub = document.createElement('p');
    sub.className = 'auth-box-desc';
    sub.textContent = 'Gesynchroniseerd op al je apparaten.';
    text.append(name, sub);
    box.appendChild(text);

    const signOutBtn = document.createElement('button');
    signOutBtn.type = 'button';
    signOutBtn.className = 'text-btn-small';
    signOutBtn.textContent = 'Uitloggen';
    signOutBtn.addEventListener('click', handleSignOut);
    box.appendChild(signOutBtn);
  } else {
    const text = document.createElement('div');
    text.className = 'auth-box-text';
    const title = document.createElement('p');
    title.className = 'auth-box-title';
    title.textContent = 'Synchroniseer op al je apparaten';
    const desc = document.createElement('p');
    desc.className = 'auth-box-desc';
    desc.textContent = 'Log in om je favorieten en theaterkeuze te bewaren.';
    text.append(title, desc);
    box.appendChild(text);

    const signInBtn = document.createElement('button');
    signInBtn.type = 'button';
    signInBtn.className = 'google-btn';
    signInBtn.innerHTML = GOOGLE_ICON_SVG;
    const label = document.createElement('span');
    label.textContent = 'Inloggen met Google';
    signInBtn.appendChild(label);
    signInBtn.addEventListener('click', handleSignIn);
    box.appendChild(signInBtn);
  }

  els.authBox.appendChild(box);

  if (state.authError) {
    const err = document.createElement('p');
    err.className = 'auth-error';
    err.textContent = state.authError;
    els.authBox.appendChild(err);
  }
}

// ---------- Filter sheet ----------

function openSheet() {
  els.sheet.hidden = false;
  els.sheetBackdrop.hidden = false;
}

function closeSheet() {
  els.sheet.hidden = true;
  els.sheetBackdrop.hidden = true;
}

// ---------- Zoeken ----------

const SEARCH_DEBOUNCE_MS = 250;
let searchDebounceTimer = null;

function openSearch() {
  els.headerTitleGroup.hidden = true;
  els.headerActions.hidden = true;
  els.headerSearch.hidden = false;
  els.searchInput.focus();
}

function closeSearch() {
  clearTimeout(searchDebounceTimer);
  els.searchInput.value = '';
  state.searchQuery = '';
  state.searchQueryRaw = '';
  els.headerSearch.hidden = true;
  els.headerTitleGroup.hidden = false;
  els.headerActions.hidden = false;
  renderAgenda();
}

function onSearchInput() {
  clearTimeout(searchDebounceTimer);
  const value = els.searchInput.value;
  searchDebounceTimer = setTimeout(() => {
    const trimmed = value.trim();
    state.searchQuery = trimmed.toLowerCase();
    state.searchQueryRaw = trimmed;
    renderAgenda();
  }, SEARCH_DEBOUNCE_MS);
}

// ---------- Agenda screen ----------

function sortKey(show) {
  return `${show.datum}T${show.tijd ?? '99:99'}`;
}

function renderSubtitle() {
  const stad = state.shows[0]?.stad ?? 'Amsterdam';
  const theaterCount = Object.values(state.enabledTheaters).filter(Boolean).length;
  els.subtitle.textContent = `${stad} · ${theaterCount} theater${theaterCount === 1 ? '' : 's'}`;
}

function activeTheaterIds() {
  const present = THEATER_ORDER.filter((id) => state.shows.some((s) => s.theaterId === id));
  const extra = [...new Set(state.shows.map((s) => s.theaterId))].filter((id) => !present.includes(id));
  return [...present, ...extra].filter((id) => state.enabledTheaters[id] !== false);
}

function renderTheaterFilters() {
  const ids = activeTheaterIds();
  if (state.theaterFilter !== 'alle' && !ids.includes(state.theaterFilter)) {
    state.theaterFilter = 'alle';
  }

  for (const container of [els.theaterFilters, els.sheetTheaterFilters]) {
    container.innerHTML = '';
    container.appendChild(
      makeChip('Alle', state.theaterFilter === 'alle', () => setFilter('theaterFilter', 'alle'))
    );
    for (const id of ids) {
      const naam = THEATER_SHORT_NAMES[id] ?? state.shows.find((s) => s.theaterId === id)?.theaterNaam ?? id;
      container.appendChild(makeChip(naam, state.theaterFilter === id, () => setFilter('theaterFilter', id)));
    }
  }
}

function renderGenreFilters() {
  const present = GENRE_CATEGORIES.filter((g) => state.shows.some((s) => s.genre === g));

  els.sheetGenreFilters.innerHTML = '';
  els.sheetGenreFilters.appendChild(
    makeChip('Alle genres', state.genreFilter === 'alle', () => setFilter('genreFilter', 'alle'))
  );
  for (const genre of present) {
    els.sheetGenreFilters.appendChild(
      makeChip(genre, state.genreFilter === genre, () => setFilter('genreFilter', genre))
    );
  }
}

function renderPodiumpasToggle() {
  els.podiumpasToggle.classList.toggle('is-on', state.podiumpasOnly);
  els.podiumpasToggle.setAttribute('aria-checked', String(state.podiumpasOnly));
}

function renderFilterBadge() {
  const count =
    (state.theaterFilter !== 'alle' ? 1 : 0) +
    (state.genreFilter !== 'alle' ? 1 : 0) +
    (state.podiumpasOnly ? 1 : 0);
  els.filterBadge.textContent = String(count);
  els.filterBadge.hidden = count === 0;
}

function makeChip(label, active, onClick) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'chip' + (active ? ' is-active' : '');
  btn.textContent = label;
  btn.addEventListener('click', onClick);
  return btn;
}

function setFilter(key, value) {
  state[key] = state[key] === value && value !== 'alle' ? 'alle' : value;
  renderTheaterFilters();
  renderGenreFilters();
  renderFilterBadge();
  renderAgenda();
}

function filteredShows({ ignoreDateWindow = false } = {}) {
  const enabled = new Set(activeTheaterIds());
  const maxDate =
    !ignoreDateWindow && state.dateWindowDays != null
      ? addDaysIso(todayIsoDate(), state.dateWindowDays)
      : null;

  return state.shows.filter((s) => {
    if (!enabled.has(s.theaterId)) return false;
    const theaterOk = state.theaterFilter === 'alle' || s.theaterId === state.theaterFilter;
    const genreOk = state.genreFilter === 'alle' || s.genre === state.genreFilter;
    const podiumpasOk = !state.podiumpasOnly || s.podiumpas === true;
    const dateOk = maxDate == null || s.datum <= maxDate;
    const searchOk =
      !state.searchQuery ||
      s.titel.toLowerCase().includes(state.searchQuery) ||
      s.theaterNaam.toLowerCase().includes(state.searchQuery);
    return theaterOk && genreOk && podiumpasOk && dateOk && searchOk;
  });
}

function formatDateHeading(isoDate) {
  const { day, month } = parseIsoDate(isoDate);
  return `${WEEKDAYS[dateFromIso(isoDate).getDay()]} ${day} ${MONTHS[month - 1]}`.toUpperCase();
}

function emptyStateMessage() {
  const filtersActive = state.theaterFilter !== 'alle' || state.genreFilter !== 'alle' || state.podiumpasOnly;
  const query = state.searchQueryRaw;
  if (query && filtersActive) return `Geen voorstellingen gevonden voor "${query}" met deze filters.`;
  if (query) return `Geen voorstellingen gevonden voor "${query}".`;
  if (filtersActive) return 'Geen voorstellingen gevonden voor deze filters.';
  return 'Geen voorstellingen gevonden.';
}

function renderAgenda() {
  const shows = filteredShows();

  if (shows.length === 0) {
    els.agendaList.innerHTML = '';
    els.emptyState.textContent = emptyStateMessage();
    els.emptyState.hidden = false;
    els.agendaList.appendChild(els.emptyState);
    return;
  }
  els.emptyState.hidden = true;
  renderShowGroups(els.agendaList, shows);

  const totalWithoutWindow = filteredShows({ ignoreDateWindow: true }).length;
  const hiddenCount = totalWithoutWindow - shows.length;
  if (state.dateWindowDays != null && hiddenCount > 0) {
    els.agendaList.appendChild(makeShowMoreButton(hiddenCount));
  }
}

function makeShowMoreButton(hiddenCount) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'show-more-btn';
  btn.textContent = `Toon ${hiddenCount} voorstelling${hiddenCount === 1 ? '' : 'en'} verder in de toekomst`;
  btn.addEventListener('click', () => {
    state.dateWindowDays = null;
    renderAgenda();
  });
  return btn;
}

/** Groepeert shows (al gesorteerd) per datum en zet ze in `container`. */
function renderShowGroups(container, shows) {
  container.innerHTML = '';
  let currentDate = null;
  let groupEl = null;

  for (const show of shows) {
    if (show.datum !== currentDate) {
      currentDate = show.datum;
      groupEl = document.createElement('section');
      groupEl.className = 'date-group';

      const heading = document.createElement('h2');
      heading.className = 'date-heading';
      heading.textContent = formatDateHeading(show.datum);
      groupEl.appendChild(heading);

      container.appendChild(groupEl);
    }

    groupEl.appendChild(renderShowRow(show));
  }
}

function renderShowRow(show) {
  const row = document.createElement('button');
  row.type = 'button';
  row.className = 'show-row';
  row.addEventListener('click', () => navigate(`#/show/${encodeURIComponent(show.id)}`));

  const dot = document.createElement('span');
  dot.className = 'show-dot';
  dot.setAttribute('aria-hidden', 'true');

  const info = document.createElement('span');
  info.className = 'show-info';

  const title = document.createElement('p');
  title.className = 'show-title';
  title.textContent = show.titel;

  const metaRow = document.createElement('div');
  metaRow.className = 'show-meta-row';

  const meta = document.createElement('p');
  meta.className = 'show-meta';
  const theaterNaam = THEATER_SHORT_NAMES[show.theaterId] ?? show.theaterNaam;
  meta.textContent = show.tijd ? `${theaterNaam} · ${show.tijd}` : theaterNaam;
  metaRow.appendChild(meta);

  const badge = makeStatusBadge(show.beschikbaarheid);
  if (badge) metaRow.appendChild(badge);

  info.append(title, metaRow);

  const chevron = svgIcon('<polyline points="9 6 15 12 9 18" />');
  chevron.classList.add('show-chevron');

  row.append(dot, info, chevron);
  return row;
}

/** Geeft een badge-element terug, of null als er niets te tonen valt. */
function makeStatusBadge(beschikbaarheid) {
  const label = BESCHIKBAARHEID_LABELS[beschikbaarheid];
  if (!label) return null;
  const badge = document.createElement('span');
  badge.className = `status-badge status-badge--${beschikbaarheid}`;
  badge.textContent = label;
  return badge;
}

function svgIcon(inner) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.innerHTML = inner;
  return svg;
}

// ---------- Datum-helpers ----------

function parseIsoDate(isoDate) {
  const [year, month, day] = isoDate.split('-').map(Number);
  return { year, month, day };
}

function dateFromIso(isoDate) {
  const { year, month, day } = parseIsoDate(isoDate);
  return new Date(year, month - 1, day);
}

function toIso(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function todayIsoDate() {
  return toIso(new Date());
}

function addDaysIso(isoDate, days) {
  const d = dateFromIso(isoDate);
  d.setDate(d.getDate() + days);
  return toIso(d);
}

function formatDateLong(isoDate) {
  const { year, month, day } = parseIsoDate(isoDate);
  const weekday = WEEKDAYS_LONG[dateFromIso(isoDate).getDay()];
  const weekdayCap = weekday.charAt(0).toUpperCase() + weekday.slice(1);
  return `${weekdayCap} ${day} ${MONTHS_LONG[month - 1]} ${year}`;
}

function formatDateShort(isoDate) {
  const { day, month } = parseIsoDate(isoDate);
  return `${day} ${MONTHS[month - 1]}`;
}

// isoTimestamp is opgehaaldOp, een volledige ISO-datetime (UTC) — new Date()
// zet die vanzelf om naar de lokale tijd van de bezoeker.
function formatCheckedAt(isoTimestamp) {
  const d = new Date(isoTimestamp);
  return `${d.getDate()} ${MONTHS[d.getMonth()]}, ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

// ---------- Detail screen ----------

function renderDetail(show) {
  const genreLabel = show.genre ?? show.theaterNaam;
  els.detailGenre.textContent = genreLabel;
  els.detailTheater.textContent = THEATER_SHORT_NAMES[show.theaterId] ?? show.theaterNaam;
  els.detailTitle.textContent = show.titel;
  els.detailDate.textContent = formatDateLong(show.datum);
  els.detailTime.textContent = show.tijd ? `${show.tijd} uur` : 'Tijd volgt nog';

  const adres = THEATER_INFO[show.theaterId]?.adres;
  els.detailAddress.textContent = adres
    ? `${show.theaterNaam}, ${adres}, ${show.stad}`
    : `${show.theaterNaam}, ${show.stad}`;

  els.detailDescription.textContent = show.beschrijving || 'Nog geen omschrijving beschikbaar.';

  const statusLabel = BESCHIKBAARHEID_LABELS[show.beschikbaarheid];
  if (statusLabel) {
    els.detailStatusBadge.textContent = statusLabel;
    els.detailStatusBadge.className = `status-badge status-badge--${show.beschikbaarheid}`;
    els.detailStatusBadge.hidden = false;
  } else {
    els.detailStatusBadge.hidden = true;
  }

  els.detailCheckedAt.textContent = `Laatst gecontroleerd: ${formatCheckedAt(show.opgehaaldOp)}`;

  els.detailReserveLabel.textContent = `Reserveer op ${hostnameOf(show.reserverenUrl)}`;
  els.detailReserveBtn.href = show.reserverenUrl;

  renderFavoriteButton(show);
  renderOtherDates(show);

  els.detailFavorite.onclick = () => {
    if (state.favorites.has(show.id)) {
      state.favorites.delete(show.id);
    } else {
      state.favorites.add(show.id);
    }
    saveFavorites();
    renderFavoriteButton(show);
  };

  els.detailAddCalendar.onclick = () => downloadIcs(show);
}

function renderFavoriteButton(show) {
  const isFavorite = state.favorites.has(show.id);
  els.detailFavorite.classList.toggle('is-favorite', isFavorite);
  els.detailFavorite.querySelector('svg').setAttribute('fill', isFavorite ? 'currentColor' : 'none');
}

function renderOtherDates(show) {
  const related = state.shows
    .filter((s) => s.titel === show.titel && s.theaterId === show.theaterId)
    .sort((a, b) => sortKey(a).localeCompare(sortKey(b)));

  if (related.length <= 1) {
    els.detailOtherDatesWrap.hidden = true;
    return;
  }

  els.detailOtherDatesWrap.hidden = false;
  els.detailOtherDates.innerHTML = '';
  for (const s of related) {
    const label = s.tijd ? `${formatDateShort(s.datum)}, ${s.tijd}` : formatDateShort(s.datum);
    els.detailOtherDates.appendChild(
      makeChip(label, s.id === show.id, () => navigate(`#/show/${encodeURIComponent(s.id)}`))
    );
  }
}

function hostnameOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function icsEscape(text) {
  return String(text ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;')
    .replace(/\n/g, '\\n');
}

function buildIcs(show) {
  const { year, month, day } = parseIsoDate(show.datum);
  const [startHour, startMinute] = (show.tijd ?? '20:00').split(':').map(Number);
  const start = new Date(year, month - 1, day, startHour, startMinute);
  const end = new Date(start.getTime() + 2 * 60 * 60 * 1000); // aanname: 2 uur speelduur

  const stamp = (d) =>
    `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}T${pad2(d.getHours())}${pad2(d.getMinutes())}00`;

  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Podiumagenda//NL',
    'BEGIN:VEVENT',
    `UID:${show.id}@podiumagenda`,
    `DTSTAMP:${stamp(new Date())}`,
    `DTSTART:${stamp(start)}`,
    `DTEND:${stamp(end)}`,
    `SUMMARY:${icsEscape(show.titel)}`,
    `DESCRIPTION:${icsEscape(show.beschrijving)}`,
    `LOCATION:${icsEscape(`${show.theaterNaam}, ${THEATER_INFO[show.theaterId]?.adres ?? ''}`)}`,
    `URL:${icsEscape(show.reserverenUrl)}`,
    'END:VEVENT',
    'END:VCALENDAR',
    '',
  ].join('\r\n');
}

function downloadIcs(show) {
  const blob = new Blob([buildIcs(show)], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${show.id}.ics`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ---------- Theaters screen ----------

function renderTheatersScreen() {
  const ids = [...new Set(state.shows.map((s) => s.theaterId))].sort(
    (a, b) => THEATER_ORDER.indexOf(a) - THEATER_ORDER.indexOf(b)
  );
  const enabledCount = ids.filter((id) => state.enabledTheaters[id] !== false).length;
  els.theatersCount.textContent = `${enabledCount} van ${ids.length}`;
  const steden = [...new Set(ids.map((id) => state.shows.find((s) => s.theaterId === id)?.stad).filter(Boolean))];
  els.theatersCities.textContent = steden.join(' & ').toUpperCase();

  els.theatersList.innerHTML = '';
  for (const id of ids) {
    const theaterShow = state.shows.find((s) => s.theaterId === id);
    const naam = theaterShow?.theaterNaam ?? id;
    const adres = THEATER_INFO[id]?.adres ?? '';
    const heeftPodiumpas = theaterShow?.podiumpas === true;
    const isOn = state.enabledTheaters[id] !== false;

    const card = document.createElement('div');
    card.className = 'theater-card';

    const info = document.createElement('div');
    const nameEl = document.createElement('p');
    nameEl.className = 'theater-card-name';
    nameEl.textContent = naam;
    const addressEl = document.createElement('p');
    addressEl.className = 'theater-card-address';
    addressEl.textContent = adres;
    const podiumpasEl = document.createElement('span');
    podiumpasEl.className = 'podiumpas-badge' + (heeftPodiumpas ? '' : ' podiumpas-badge--no');
    podiumpasEl.textContent = heeftPodiumpas ? 'Podiumpas' : 'Geen Podiumpas';
    info.append(nameEl, addressEl, podiumpasEl);

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'switch' + (isOn ? ' is-on' : '');
    toggle.setAttribute('role', 'switch');
    toggle.setAttribute('aria-checked', String(isOn));
    toggle.setAttribute('aria-label', `${naam} in agenda tonen`);
    toggle.addEventListener('click', () => {
      state.enabledTheaters[id] = !isOn;
      saveEnabledTheaters();
      renderTheatersScreen();
      renderTheaterFilters();
      renderFilterBadge();
      renderSubtitle();
      renderAgenda();
    });

    card.append(info, toggle);
    els.theatersList.appendChild(card);
  }
}

// ---------- Favorieten-scherm ----------

function renderFavoritesScreen() {
  const favShows = state.shows
    .filter((s) => state.favorites.has(s.id))
    .sort((a, b) => sortKey(a).localeCompare(sortKey(b)));

  if (favShows.length === 0) {
    els.favoritesList.innerHTML = '';
    els.favoritesEmpty.hidden = false;
    els.favoritesList.appendChild(els.favoritesEmpty);
    return;
  }
  els.favoritesEmpty.hidden = true;
  renderShowGroups(els.favoritesList, favShows);
}

init();
