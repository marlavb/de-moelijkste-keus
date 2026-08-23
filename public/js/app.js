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

// Labels voor de theater-filterchips en -kaarten. Overal waar theaters in
// een lijst staan, sorteren we op dit label (Nederlandse locale) — een
// nieuw theater dat hier nog niet in staat valt terug op de volledige naam
// uit shows.json, dus de UI blijft werken zonder deze lijst bij te werken.
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
  krakeling: 'Krakeling',
  mozaiek: 'Mozaïek',
  muziekgebouw: 'Muziekgebouw',
  scala: 'Scala',
  omval: 'De Omval',
  delanding: 'De Landing',
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
  krakeling: { adres: 'Pazzanistraat 15' },
  mozaiek: { adres: 'Bos en Lommerweg 191' },
  muziekgebouw: { adres: 'Piet Heinkade 1' },
  scala: { adres: 'Van Hallstraat 286' },
  omval: { adres: 'Ouddiemerlaan 104' },
  delanding: { adres: 'Uilenstede 106' },
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
  favoritesMigrated: 'podiumagenda:favoritesMigrated',
  sidebarSections: 'podiumagenda:sidebarSections',
};

// Desktop-sidebar accordeon-secties (Stad/Theater/Genre) — standaard allemaal
// open zodat bestaande bezoekers zonder opgeslagen voorkeur niets zien
// veranderen totdat ze zelf iets inklappen.
const SIDEBAR_SECTION_IDS = ['stad', 'theater', 'genre'];

// Standaard tonen we alleen voorstellingen tot 60 dagen vooruit — met 1136+
// voorstellingen tot in 2028 is "alles in één keer" geen bruikbare lijst.
// De gebruiker kan dit met één tik opheffen via de "toon meer"-knop.
const DEFAULT_WINDOW_DAYS = 60;

const state = {
  shows: [],
  // Multi-select filters — een lege Set betekent "geen filter op deze
  // dimensie" (toon alles), net als de oude 'alle'-waarde. Allemaal
  // lokaal-only, net als podiumpasOnly hieronder — niet in
  // localStorage/Firestore.
  selectedCities: new Set(),
  selectedTheaters: new Set(),
  selectedGenres: new Set(),
  podiumpasOnly: false,
  favoritesOnly: false,
  searchQuery: '', // lokaal-only, al lowercased/getrimd — niet in localStorage/Firestore
  searchQueryRaw: '', // ongewijzigde tekst, alleen voor weergave (bv. in de lege-staat-tekst)
  enabledTheaters: loadEnabledTheaters(),
  favorites: loadFavorites(),
  sidebarSections: loadSidebarSections(),
  dateWindowDays: DEFAULT_WINDOW_DAYS,
  user: null, // Firebase User, of null als niet ingelogd (= lokaal-only, zoals voorheen)
  authError: null,
};

const els = {
  subtitle: document.getElementById('subtitle'),
  sheetCityFilters: document.getElementById('sheetCityFilters'),
  sheetTheaterFilters: document.getElementById('sheetTheaterFilters'),
  sheetGenreFilters: document.getElementById('sheetGenreFilters'),
  podiumpasToggle: document.getElementById('podiumpasToggle'),
  favoritesOnlyToggle: document.getElementById('favoritesOnlyToggle'),
  sidebarCityFilters: document.getElementById('sidebarCityFilters'),
  sidebarTheaterFilters: document.getElementById('sidebarTheaterFilters'),
  sidebarGenreFilters: document.getElementById('sidebarGenreFilters'),
  sidebarPodiumpasToggle: document.getElementById('sidebarPodiumpasToggle'),
  sidebarFavoritesOnlyToggle: document.getElementById('sidebarFavoritesOnlyToggle'),
  sidebarSearchInput: document.getElementById('sidebarSearchInput'),
  sidebarAccordionHeaders: {
    stad: document.getElementById('sidebarStadHeader'),
    theater: document.getElementById('sidebarTheaterHeader'),
    genre: document.getElementById('sidebarGenreHeader'),
  },
  sidebarClearFilters: document.getElementById('sidebarClearFilters'),
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
  detailPodiumpasBadge: document.getElementById('detailPodiumpasBadge'),
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
  favoritesList: document.getElementById('favoritesList'),
  favoritesEmpty: document.getElementById('favoritesEmpty'),
  authBox: document.getElementById('authBox'),
  feedbackForm: document.getElementById('feedbackForm'),
  feedbackInput: document.getElementById('feedbackInput'),
  feedbackSubmit: document.getElementById('feedbackSubmit'),
  feedbackStatus: document.getElementById('feedbackStatus'),
};

async function init() {
  const res = await fetch('data/shows.json');
  const shows = await res.json();
  shows.sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
  state.shows = shows;

  migrateFavoritesOnceLocally();

  // Theaters die nog nooit eerder gezien zijn (nieuw in de data) staan
  // standaard aan.
  for (const id of new Set(shows.map((s) => s.theaterId))) {
    if (!(id in state.enabledTheaters)) state.enabledTheaters[id] = true;
  }
  saveEnabledTheaters();

  renderFilters();
  renderFilterBadge();
  renderSubtitle();
  renderAgenda();
  renderSidebarSections();

  els.filterToggle.addEventListener('click', openSheet);
  els.sheetClose.addEventListener('click', closeSheet);
  els.sheetBackdrop.addEventListener('click', closeSheet);
  els.searchToggle.addEventListener('click', openSearch);
  els.searchClose.addEventListener('click', closeSearch);
  els.searchInput.addEventListener('input', onSearchInput);
  els.sidebarSearchInput.addEventListener('input', onSearchInput);
  els.searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeSearch();
  });
  els.podiumpasToggle.addEventListener('click', onPodiumpasToggleClick);
  els.sidebarPodiumpasToggle.addEventListener('click', onPodiumpasToggleClick);
  els.favoritesOnlyToggle.addEventListener('click', onFavoritesToggleClick);
  els.sidebarFavoritesOnlyToggle.addEventListener('click', onFavoritesToggleClick);
  els.clearFilters.addEventListener('click', clearAllFilters);
  els.sidebarClearFilters.addEventListener('click', clearAllFilters);
  for (const id of SIDEBAR_SECTION_IDS) {
    els.sidebarAccordionHeaders[id].addEventListener('click', () => toggleSidebarSection(id));
  }

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

  initFeedbackForm();
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

// Open/dicht-status van de Stad/Theater/Genre-accordeons in de desktop-
// sidebar — lokaal-only (geen Firestore-sync nodig voor zoiets kleins).
// Ontbrekende/onbekende waarden vallen terug op "open", zodat een
// bezoeker zonder opgeslagen voorkeur niets anders ziet dan voorheen.
function loadSidebarSections() {
  let stored = {};
  try {
    stored = JSON.parse(localStorage.getItem(STORAGE_KEYS.sidebarSections)) ?? {};
  } catch {
    stored = {};
  }
  const sections = {};
  for (const id of SIDEBAR_SECTION_IDS) {
    sections[id] = stored[id] === 'closed' ? 'closed' : 'open';
  }
  return sections;
}

function saveSidebarSections() {
  localStorage.setItem(STORAGE_KEYS.sidebarSections, JSON.stringify(state.sidebarSections));
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

// Favorieten worden per productie bewaard (theater + titel), niet per
// specifieke datum/tijd — zelfde groepering als de "andere data"-chips op
// het detailscherm (renderOtherDates), bewust hergebruikt i.p.v. een
// nieuwe groeperingslogica te verzinnen.
function productionKey(show) {
  return `${show.theaterId}::${show.titel}`;
}

// Migratie van het oude per-voorstelling-formaat (favorites bevatte
// show.id's) naar het nieuwe per-productie-formaat. Een opgeslagen waarde
// die matcht met een show.id in de net geladen shows.json is per definitie
// oud-formaat (nieuwe sleutels bevatten geen show.id's meer, die hebben
// een "::" en geen datum/tijd-suffix) — die zetten we om. Een waarde die
// nergens mee matcht laten we ongemoeid: waarschijnlijk al nieuw-formaat,
// of een verlopen voorstelling die niet meer in de data staat en dus toch
// niet meer betrouwbaar te herleiden is.
function migrateFavorites(favorites) {
  const migrated = new Set();
  for (const value of favorites) {
    const oldShow = state.shows.find((s) => s.id === value);
    migrated.add(oldShow ? productionKey(oldShow) : value);
  }
  return migrated;
}

function isFavoritesMigratedLocally() {
  return localStorage.getItem(STORAGE_KEYS.favoritesMigrated) === '1';
}

// Draait één keer (bewaakt met een localStorage-vlag) om de lokale
// favorieten te migreren — voor uitgelogde gebruikers is dit de definitieve
// bron, voor ingelogde gebruikers een onschuldige no-op zodra
// handleAuthChange() de cloud-versie (met eigen, aparte vlag) heeft geladen.
function migrateFavoritesOnceLocally() {
  if (isFavoritesMigratedLocally()) return;
  state.favorites = migrateFavorites(state.favorites);
  saveFavorites();
  localStorage.setItem(STORAGE_KEYS.favoritesMigrated, '1');
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

        if (!data.favoritesMigrated) {
          state.favorites = migrateFavorites(state.favorites);
          await setDoc(ref, { favorites: [...state.favorites], favoritesMigrated: true }, { merge: true });
        }
      } else {
        // Eerste keer inloggen op dit account: neem mee wat er lokaal al
        // stond (migrateFavoritesOnceLocally() heeft dat in init() al naar
        // het nieuwe formaat omgezet), i.p.v. dat stilzwijgend te laten vallen.
        await setDoc(ref, {
          favorites: [...state.favorites],
          enabledTheaters: state.enabledTheaters,
          favoritesMigrated: true,
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
  renderFilters();
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
  els.sidebarSearchInput.value = '';
  state.searchQuery = '';
  state.searchQueryRaw = '';
  els.headerSearch.hidden = true;
  els.headerTitleGroup.hidden = false;
  els.headerActions.hidden = false;
  renderAgenda();
}

// Zowel het mobiele (uitklap-header) als het sidebar-zoekveld (breed
// scherm) roepen dit aan — ze spiegelen elkaars waarde, zodat het bij het
// resizen van het venster over de breakpoint heen nooit uit sync raakt.
function onSearchInput(e) {
  const source = e.target;
  const other = source === els.searchInput ? els.sidebarSearchInput : els.searchInput;
  other.value = source.value;

  clearTimeout(searchDebounceTimer);
  const value = source.value;
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
  const ids = activeTheaterIds();
  const cities = new Set(ids.map((id) => theaterStad(id)).filter(Boolean));
  const theaterCount = ids.length;
  const theaterWoord = theaterCount === 1 ? 'theater' : 'theaters';

  // Bij precies 1 stad noemen we 'm bij naam (leest natuurlijker dan "1
  // stad"); bij meerdere steden tellen we ze op i.p.v. ze allemaal uit te
  // schrijven — dat werd op "Mijn theaters" al onhandelbaar lang zodra er
  // meer dan een paar steden meedoen.
  let cityText = '';
  if (cities.size === 1) {
    cityText = [...cities][0];
  } else if (cities.size > 1) {
    cityText = `${cities.size} steden`;
  }

  els.subtitle.textContent = cityText ? `${theaterCount} ${theaterWoord} in ${cityText}` : `${theaterCount} ${theaterWoord}`;
}

function theaterDisplayName(id) {
  return THEATER_SHORT_NAMES[id] ?? state.shows.find((s) => s.theaterId === id)?.theaterNaam ?? id;
}

function sortTheaterIdsByName(ids) {
  return [...ids].sort((a, b) => theaterDisplayName(a).localeCompare(theaterDisplayName(b), 'nl'));
}

function activeTheaterIds() {
  const ids = sortTheaterIdsByName([...new Set(state.shows.map((s) => s.theaterId))]);
  return ids.filter((id) => state.enabledTheaters[id] !== false);
}

function theaterStad(id) {
  return state.shows.find((s) => s.theaterId === id)?.stad ?? null;
}

function theaterHasPodiumpas(id) {
  return state.shows.find((s) => s.theaterId === id)?.podiumpas === true;
}

/** Podiumpas-only cascadeert net als de stad-selectie: als de toggle aan
 * staat, blijven alleen Podiumpas-theaters over als optie. */
function podiumpasFilteredIds(ids) {
  return state.podiumpasOnly ? ids.filter(theaterHasPodiumpas) : ids;
}

/** Steden van de op dit moment ingeschakelde (en evt. Podiumpas-only
 * gefilterde) theaters, Nederlands gesorteerd — de opties voor het
 * stad-filter. */
function availableCities() {
  const ids = podiumpasFilteredIds(activeTheaterIds());
  const cities = new Set(ids.map((id) => theaterStad(id)).filter(Boolean));
  return [...cities].sort((a, b) => a.localeCompare(b, 'nl'));
}

/** Theater-opties voor het theater-filter, gecascadeerd op zowel
 * Podiumpas-only als de geselecteerde steden (leeg = geen beperking). */
function availableTheaterIds() {
  let ids = podiumpasFilteredIds(activeTheaterIds());
  if (state.selectedCities.size > 0) {
    ids = ids.filter((id) => state.selectedCities.has(theaterStad(id)));
  }
  return ids;
}

function toggleSetMember(set, value) {
  if (set.has(value)) set.delete(value);
  else set.add(value);
}

function onCityToggle(city) {
  const wasSelected = state.selectedCities.has(city);
  toggleSetMember(state.selectedCities, city);
  if (wasSelected) {
    // Stad net uitgezet: theater-selecties in die stad worden anders
    // "onzichtbaar" actief (ze vallen buiten de gecascadeerde lijst maar
    // blijven meetellen in filteredShows), dus meteen mee opruimen.
    for (const id of [...state.selectedTheaters]) {
      if (theaterStad(id) === city) state.selectedTheaters.delete(id);
    }
  }
  renderCityFilters();
  renderTheaterFilters();
  renderFilterBadge();
  renderAgenda();
}

function onTheaterToggle(id) {
  toggleSetMember(state.selectedTheaters, id);
  renderTheaterFilters();
  renderFilterBadge();
  renderAgenda();
}

function onGenreToggle(genre) {
  toggleSetMember(state.selectedGenres, genre);
  renderGenreFilters();
  renderFilterBadge();
  renderAgenda();
}

function onPodiumpasToggleClick() {
  state.podiumpasOnly = !state.podiumpasOnly;
  // renderFilters() cascades into city/theater options (and prunes any
  // now-stale selectedCities/selectedTheaters), same mechanism as when a
  // city gets deselected.
  renderFilters();
  renderFilterBadge();
  renderAgenda();
}

function onFavoritesToggleClick() {
  state.favoritesOnly = !state.favoritesOnly;
  renderFavoritesToggle();
  renderFilterBadge();
  renderAgenda();
}

function clearAllFilters() {
  state.selectedCities.clear();
  state.selectedTheaters.clear();
  state.selectedGenres.clear();
  state.podiumpasOnly = false;
  state.favoritesOnly = false;
  renderFilters();
  renderFilterBadge();
  renderAgenda();
}

function renderCityFilters() {
  const cities = availableCities();
  for (const c of [...state.selectedCities]) {
    if (!cities.includes(c)) state.selectedCities.delete(c);
  }

  for (const container of [els.sidebarCityFilters, els.sheetCityFilters]) {
    container.innerHTML = '';
    for (const city of cities) {
      container.appendChild(makeChip(city, state.selectedCities.has(city), () => onCityToggle(city)));
    }
  }
}

function renderTheaterFilters() {
  const ids = availableTheaterIds();
  for (const id of [...state.selectedTheaters]) {
    if (!ids.includes(id)) state.selectedTheaters.delete(id);
  }

  for (const container of [els.sidebarTheaterFilters, els.sheetTheaterFilters]) {
    container.innerHTML = '';
    for (const id of ids) {
      container.appendChild(
        makeChip(theaterDisplayName(id), state.selectedTheaters.has(id), () => onTheaterToggle(id))
      );
    }
  }
}

function renderGenreFilters() {
  const present = GENRE_CATEGORIES.filter((g) => state.shows.some((s) => s.genre === g));

  for (const container of [els.sidebarGenreFilters, els.sheetGenreFilters]) {
    container.innerHTML = '';
    for (const genre of present) {
      container.appendChild(makeChip(genre, state.selectedGenres.has(genre), () => onGenreToggle(genre)));
    }
  }
}

function renderPodiumpasToggle() {
  for (const btn of [els.podiumpasToggle, els.sidebarPodiumpasToggle]) {
    btn.classList.toggle('is-on', state.podiumpasOnly);
    btn.setAttribute('aria-checked', String(state.podiumpasOnly));
  }
}

function renderFavoritesToggle() {
  for (const btn of [els.favoritesOnlyToggle, els.sidebarFavoritesOnlyToggle]) {
    btn.classList.toggle('is-on', state.favoritesOnly);
    btn.setAttribute('aria-checked', String(state.favoritesOnly));
  }
}

const SIDEBAR_SECTION_CONTENT_ELS = {
  stad: () => els.sidebarCityFilters,
  theater: () => els.sidebarTheaterFilters,
  genre: () => els.sidebarGenreFilters,
};

function applySidebarSectionState(sectionId) {
  const isOpen = state.sidebarSections[sectionId] === 'open';
  const header = els.sidebarAccordionHeaders[sectionId];
  const content = SIDEBAR_SECTION_CONTENT_ELS[sectionId]();
  header.setAttribute('aria-expanded', String(isOpen));
  content.hidden = !isOpen;
}

function renderSidebarSections() {
  for (const id of SIDEBAR_SECTION_IDS) applySidebarSectionState(id);
}

function toggleSidebarSection(sectionId) {
  state.sidebarSections[sectionId] = state.sidebarSections[sectionId] === 'open' ? 'closed' : 'open';
  applySidebarSectionState(sectionId);
  saveSidebarSections();
}

/** Rendert alle filter-UI (sidebar + sheet) in één keer — city eerst,
 * want theater cascadeert erop. */
function renderFilters() {
  renderCityFilters();
  renderTheaterFilters();
  renderGenreFilters();
  renderPodiumpasToggle();
  renderFavoritesToggle();
}

function renderFilterBadge() {
  const count =
    (state.selectedCities.size > 0 ? 1 : 0) +
    (state.selectedTheaters.size > 0 ? 1 : 0) +
    (state.selectedGenres.size > 0 ? 1 : 0) +
    (state.podiumpasOnly ? 1 : 0) +
    (state.favoritesOnly ? 1 : 0);
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

function filteredShows({ ignoreDateWindow = false } = {}) {
  const enabled = new Set(activeTheaterIds());
  const maxDate =
    !ignoreDateWindow && state.dateWindowDays != null
      ? addDaysIso(todayIsoDate(), state.dateWindowDays)
      : null;

  return state.shows.filter((s) => {
    if (!enabled.has(s.theaterId)) return false;
    const cityOk = state.selectedCities.size === 0 || state.selectedCities.has(s.stad);
    const theaterOk = state.selectedTheaters.size === 0 || state.selectedTheaters.has(s.theaterId);
    const genreOk = state.selectedGenres.size === 0 || state.selectedGenres.has(s.genre);
    const podiumpasOk = !state.podiumpasOnly || s.podiumpas === true;
    const favoritesOk = !state.favoritesOnly || state.favorites.has(productionKey(s));
    const dateOk = maxDate == null || s.datum <= maxDate;
    const searchOk =
      !state.searchQuery ||
      s.titel.toLowerCase().includes(state.searchQuery) ||
      s.theaterNaam.toLowerCase().includes(state.searchQuery);
    return cityOk && theaterOk && genreOk && podiumpasOk && favoritesOk && dateOk && searchOk;
  });
}

function formatDateHeading(isoDate) {
  const { day, month } = parseIsoDate(isoDate);
  return `${WEEKDAYS[dateFromIso(isoDate).getDay()]} ${day} ${MONTHS[month - 1]}`.toUpperCase();
}

function emptyStateMessage() {
  const filtersActive =
    state.selectedCities.size > 0 ||
    state.selectedTheaters.size > 0 ||
    state.selectedGenres.size > 0 ||
    state.podiumpasOnly ||
    state.favoritesOnly;
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

  if (show.podiumpas === true) metaRow.appendChild(makePodiumpasIcon());

  const badge = makeStatusBadge(show.beschikbaarheid);
  if (badge) metaRow.appendChild(badge);

  info.append(title, metaRow);

  const chevron = svgIcon('<polyline points="9 6 15 12 9 18" />');
  chevron.classList.add('show-chevron');

  row.append(dot, info, chevron);
  return row;
}

/** Klein, eigen vinkje-icoon dat aangeeft dat dit theater de Podiumpas accepteert. */
function makePodiumpasIcon() {
  const wrap = document.createElement('span');
  wrap.className = 'podiumpas-icon';
  wrap.setAttribute('role', 'img');
  wrap.setAttribute('aria-label', 'Podiumpas geaccepteerd');
  wrap.title = 'Dit theater accepteert de Podiumpas';
  wrap.appendChild(svgIcon('<polyline points="4 12 9 17 20 6" />'));
  return wrap;
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
  els.detailPodiumpasBadge.hidden = show.podiumpas !== true;
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
    const key = productionKey(show);
    if (state.favorites.has(key)) {
      state.favorites.delete(key);
    } else {
      state.favorites.add(key);
    }
    saveFavorites();
    renderFavoriteButton(show);
  };

  els.detailAddCalendar.onclick = () => downloadIcs(show);
}

function renderFavoriteButton(show) {
  const isFavorite = state.favorites.has(productionKey(show));
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

// ---------- Feedback (theater-suggesties) ----------

const FEEDBACK_ENDPOINT = 'https://formspree.io/f/mjybznqd';

function setFeedbackStatus(text, variant) {
  els.feedbackStatus.textContent = text;
  els.feedbackStatus.className = 'feedback-status' + (variant ? ` feedback-status--${variant}` : '');
  els.feedbackStatus.hidden = !text;
}

function initFeedbackForm() {
  els.feedbackInput.addEventListener('input', () => {
    els.feedbackSubmit.disabled = els.feedbackInput.value.trim() === '';
  });

  els.feedbackForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const message = els.feedbackInput.value.trim();
    if (!message) return;

    els.feedbackSubmit.disabled = true;
    els.feedbackSubmit.textContent = 'Versturen...';
    setFeedbackStatus('');

    try {
      const res = await fetch(FEEDBACK_ENDPOINT, {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ message }),
      });

      if (!res.ok) throw new Error(`Formspree respondeerde met ${res.status}`);

      els.feedbackForm.hidden = true;
      setFeedbackStatus('Bedankt! We hebben je bericht ontvangen.', 'success');
    } catch {
      els.feedbackSubmit.disabled = false;
      els.feedbackSubmit.textContent = 'Versturen';
      setFeedbackStatus('Er ging iets mis bij het versturen. Probeer het later opnieuw.', 'error');
    }
  });
}

// ---------- Theaters screen ----------

function buildTheaterCard(id) {
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
    refreshAfterTheaterToggle();
  });

  card.append(info, toggle);
  return card;
}

function refreshAfterTheaterToggle() {
  saveEnabledTheaters();
  renderTheatersScreen();
  renderFilters();
  renderFilterBadge();
  renderSubtitle();
  renderAgenda();
}

/** Knop om alle theaters van één stad tegelijk aan/uit te zetten — bewust
 * een tekst-knop (i.p.v. een switch) zodat 'm duidelijk anders oogt dan de
 * per-theater switches eronder. */
function buildCityToggleButton(stad, cityIds, allOn) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'city-toggle-btn';
  btn.textContent = allOn ? 'Alles uit' : 'Alles aan';
  btn.setAttribute('aria-label', `Alle theaters in ${stad} ${allOn ? 'verbergen' : 'tonen'}`);
  btn.addEventListener('click', () => {
    for (const id of cityIds) state.enabledTheaters[id] = !allOn;
    refreshAfterTheaterToggle();
  });
  return btn;
}

function renderTheatersScreen() {
  const ids = sortTheaterIdsByName([...new Set(state.shows.map((s) => s.theaterId))]);

  const idsByStad = new Map();
  for (const id of ids) {
    const stad = state.shows.find((s) => s.theaterId === id)?.stad ?? '';
    if (!idsByStad.has(stad)) idsByStad.set(stad, []);
    idsByStad.get(stad).push(id);
  }
  const steden = [...idsByStad.keys()].sort((a, b) => a.localeCompare(b, 'nl'));

  els.theatersList.innerHTML = '';
  for (const stad of steden) {
    const cityIds = idsByStad.get(stad);
    const enabledCount = cityIds.filter((id) => state.enabledTheaters[id] !== false).length;
    const allOn = enabledCount === cityIds.length;

    const heading = document.createElement('div');
    heading.className = 'theaters-list-heading';
    const headingLeft = document.createElement('div');
    headingLeft.className = 'theaters-list-heading-left';
    const cityLabel = document.createElement('span');
    cityLabel.textContent = stad.toUpperCase();
    headingLeft.append(cityLabel, buildCityToggleButton(stad, cityIds, allOn));
    const countLabel = document.createElement('span');
    countLabel.textContent = `${enabledCount} van ${cityIds.length}`;
    heading.append(headingLeft, countLabel);
    els.theatersList.appendChild(heading);

    for (const id of cityIds) {
      els.theatersList.appendChild(buildTheaterCard(id));
    }
  }
}

// ---------- Favorieten-scherm ----------

/** Eén rij per favoriete productie i.p.v. per voorstelling-datum. Een
 * productie zonder aankomende voorstelling wordt nog wel getoond (niet
 * stilzwijgend weggelaten), maar dan niet-klikbaar met een duidelijke
 * "geen komende voorstellingen"-tekst — een productie waar zelfs geen
 * enkele match meer voor bestaat in de data laten we wél weg, want daar is
 * geen titel/theater meer voor te tonen. */
function favoriteProductions() {
  const productions = [];
  for (const key of state.favorites) {
    const matches = state.shows.filter((s) => productionKey(s) === key);
    if (matches.length === 0) continue;

    const soonest = matches
      .filter((s) => s.datum >= todayIsoDate())
      .sort((a, b) => sortKey(a).localeCompare(sortKey(b)))[0];
    const sample = matches[0];

    productions.push({
      key,
      titel: sample.titel,
      theaterId: sample.theaterId,
      theaterNaam: sample.theaterNaam,
      podiumpas: sample.podiumpas,
      soonest: soonest ?? null,
    });
  }

  productions.sort((a, b) => {
    const aSort = a.soonest ? sortKey(a.soonest) : null;
    const bSort = b.soonest ? sortKey(b.soonest) : null;
    if (aSort && bSort) return aSort.localeCompare(bSort);
    if (aSort) return -1; // producties zonder komende datum onderaan
    if (bSort) return 1;
    return a.titel.localeCompare(b.titel, 'nl');
  });

  return productions;
}

function renderProductionRow(production) {
  const hasUpcoming = production.soonest != null;
  const row = document.createElement(hasUpcoming ? 'button' : 'div');
  row.className = 'show-row' + (hasUpcoming ? '' : ' show-row--inert');
  if (hasUpcoming) {
    row.type = 'button';
    row.addEventListener('click', () => navigate(`#/show/${encodeURIComponent(production.soonest.id)}`));
  }

  const dot = document.createElement('span');
  dot.className = 'show-dot';
  dot.setAttribute('aria-hidden', 'true');

  const info = document.createElement('span');
  info.className = 'show-info';

  const title = document.createElement('p');
  title.className = 'show-title';
  title.textContent = production.titel;

  const metaRow = document.createElement('div');
  metaRow.className = 'show-meta-row';

  const meta = document.createElement('p');
  meta.className = 'show-meta';
  const theaterNaam = THEATER_SHORT_NAMES[production.theaterId] ?? production.theaterNaam;
  meta.textContent = hasUpcoming ? theaterNaam : `${theaterNaam} · Geen komende voorstellingen`;
  metaRow.appendChild(meta);

  if (production.podiumpas === true) metaRow.appendChild(makePodiumpasIcon());

  info.append(title, metaRow);
  row.append(dot, info);

  if (hasUpcoming) {
    const chevron = svgIcon('<polyline points="9 6 15 12 9 18" />');
    chevron.classList.add('show-chevron');
    row.appendChild(chevron);
  }

  return row;
}

function renderFavoritesScreen() {
  const productions = favoriteProductions();

  if (productions.length === 0) {
    els.favoritesList.innerHTML = '';
    els.favoritesEmpty.hidden = false;
    els.favoritesList.appendChild(els.favoritesEmpty);
    return;
  }
  els.favoritesEmpty.hidden = true;
  els.favoritesList.innerHTML = '';
  for (const production of productions) {
    els.favoritesList.appendChild(renderProductionRow(production));
  }
}

init();
