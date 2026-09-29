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
import { getGenreBucket } from './genre.js';
import { getOtherTheaterShows } from './productions.js';
import { renameFavoritesAndPersist, THEATER_MOVES } from './favorites.js';
import { laadWatchlist, bekendeSleutels, legeWatchlist, watchlistSleutel, voegToe, verwijder } from './watchlist.js';
import {
  laadGepland,
  legeGepland,
  planIn,
  zetStatus,
  haalUitPlanning,
  koppel,
  indexeerShows,
  zelfdeAvond,
  komendePlannen,
} from './gepland.js';

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
  zaantheater: { adres: 'Nicolaasstraat 3' },
  bijlmerparktheater: { adres: 'Anton de Komplein 240' },
  ccamstel: { adres: 'Dora Tamanaplein 1' },
  marionettentheater: { adres: 'Nieuwe Jonkerstraat 8' },
  griffioen: { adres: 'De Boelelaan 1111' },
  pleintheater: { adres: 'Sajetplein 39' },
  karavaan: { adres: 'Marconistraat 5' },
  schuur: { adres: 'Lange Begijnestraat 9' },
  bostheater: { adres: 'De Duizendmeterweg 7' },
  hogewoerd: { adres: 'Hoge Woerdplein 1' },
  flint: { adres: 'Coninckstraat 60' },
  aandeslinger: { adres: 'De Slinger 40' },
  corrosia: { adres: 'Markt 43' },
  kunstlinie: { adres: 'Esplanade 10' },
};

// Alleen "uitverkocht" en "wachtlijst" krijgen een badge — "beschikbaar" is
// de default en verdient geen visuele ruis, en "onbekend" laten we bewust
// leeg in plaats van een misleidende "beschikbaar"-badge te tonen.
// Oude of andere namen waarop een theater gevonden moet blijven (kleine
// letters). ITA heet sinds 30 sep 2026 "Stadsschouwburg Amsterdam".
const THEATER_ZOEKALIASSEN = {
  ita: ['ita', 'internationaal theater amsterdam'],
};

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
  watchlist: 'podiumagenda:watchlist',
  gepland: 'podiumagenda:gepland',
  sidebarSections: 'podiumagenda:sidebarSections',
  theaterCitySections: 'podiumagenda:theaterCitySections',
  filters: 'podiumagenda:filters',
};

// Provincie-indeling voor het "Mijn theaters"-scherm, zoals op
// podiumpas.nl/waar-te-besteden — bewust een kale UI-constante hier (i.p.v.
// een veld in config.js) omdat dit puur presentatie is, geen deel van het
// gescrapete databaseschema. PROVINCE_ORDER bepaalt de volgorde van de
// provincie-koppen; een stad die niet in de map staat belandt in de
// PROVINCE_FALLBACK-sectie zodat een nieuwe stad nooit stilzwijgend
// verdwijnt.
const PROVINCE_ORDER = ['Noord-Holland', 'Zuid-Holland', 'Utrecht', 'Flevoland'];
const PROVINCE_FALLBACK = 'Overig';
const PROVINCE_BY_CITY = {
  Amsterdam: 'Noord-Holland',
  Amstelveen: 'Noord-Holland',
  Diemen: 'Noord-Holland',
  Alkmaar: 'Noord-Holland',
  Haarlem: 'Noord-Holland',
  Zaandam: 'Noord-Holland',
  Utrecht: 'Utrecht',
  Houten: 'Utrecht',
  Amersfoort: 'Utrecht',
  Almere: 'Flevoland',
  'Den Haag': 'Zuid-Holland',
  Rotterdam: 'Zuid-Holland',
  Maassluis: 'Zuid-Holland',
  Leiden: 'Zuid-Holland',
  Vlaardingen: 'Zuid-Holland',
  Spijkenisse: 'Zuid-Holland',
  'Capelle aan den IJssel': 'Zuid-Holland',
  Barendrecht: 'Zuid-Holland',
};

// Desktop-sidebar accordeon-secties (Stad/Theater/Genre) — standaard allemaal
// open zodat bestaande bezoekers zonder opgeslagen voorkeur niets zien
// veranderen totdat ze zelf iets inklappen.
const SIDEBAR_SECTION_IDS = ['stad', 'theater', 'genre'];

// Standaard tonen we alleen voorstellingen tot 30 dagen vooruit — met 1136+
// voorstellingen tot in 2028 is "alles in één keer" geen bruikbare lijst.
// De gebruiker kan dit met één tik opheffen via de "toon meer"-knop.
const DEFAULT_WINDOW_DAYS = 30;

// Herstelde filterstate uit localStorage (zie loadFilters()/saveFilters()
// verderop) — vóór het state-object opgehaald zodat elk veld hieronder
// meteen met de juiste startwaarde geïnitialiseerd kan worden, i.p.v. pas
// na een asynchrone stap. Een opgeslagen stad/theater/genre die niet meer
// in de data voorkomt wordt vanzelf opgeruimd zodra renderFilters() na het
// laden van shows.json draait (zie de pruning in renderCityFilters()/
// renderTheaterFilters()) — hier dus geen aparte validatie nodig.
const savedFilters = loadFilters();

const state = {
  shows: [],
  // Per theater uit data/theaters.json (o.a. podiumpasReserveren). Leeg als
  // het bestand (nog) niet bestaat — de app werkt dan gewoon zoals voorheen.
  theaterInfo: {},
  // Multi-select filters — een lege Set betekent "geen filter op deze
  // dimensie" (toon alles), net als de oude 'alle'-waarde. Lokaal-only
  // (localStorage via loadFilters()/saveFilters()) — geen Firestore-sync,
  // dit is bewust hetzelfde niveau als de sidebar-accordion-state
  // (sidebarSections hieronder), niet het cross-device-niveau van
  // favorites/enabledTheaters.
  selectedCities: savedFilters.selectedCities,
  selectedTheaters: savedFilters.selectedTheaters,
  selectedGenres: savedFilters.selectedGenres,
  // De 3 toggles hieronder (podiumpasOnly/watchlistOnly/hideFullOnly) waren
  // vroeger bewust session-only (nooit opgeslagen), zodat ze bij elk bezoek
  // weer op de standaardstand "uit" stonden — dat is op expliciet verzoek
  // omgedraaid: ze worden nu net als de multi-select filters hierboven
  // onthouden in localStorage.
  podiumpasOnly: savedFilters.podiumpasOnly,
  watchlistOnly: savedFilters.watchlistOnly,
  hideFullOnly: savedFilters.hideFullOnly,
  // Bewaard als de ongewijzigde tekst (searchQueryRaw, ook gebruikt om het
  // zoekveld bij het laden weer te vullen) plus de al lowercased/getrimde
  // matchvorm (searchQuery) — lokaal-only, zie loadFilters()/saveFilters().
  searchQuery: savedFilters.searchQueryRaw.trim().toLowerCase(),
  searchQueryRaw: savedFilters.searchQueryRaw.trim(),
  enabledTheaters: loadEnabledTheaters(),
  favorites: loadFavorites(),
  // { watchlist, watchlistVerwijderd }, zie watchlist.js. Lokaal uit
  // localStorage, ingelogd uit Firestore (samengevoegd met de lokale).
  watchlist: loadWatchlistLocal(),
  // Watchlist-velden uit het Firestore-document zoals laatst gelezen; null
  // zolang die nog niet binnen zijn (dan schrijven we niets naar de cloud).
  cloudWatchlist: null,
  // { gepland, geplandVerwijderd }, zie gepland.js; zelfde opzet als hierboven.
  gepland: loadGeplandLocal(),
  cloudGepland: null,
  sidebarSections: loadSidebarSections(),
  theaterCitySections: loadTheaterCitySections(),
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
  watchlistOnlyToggle: document.getElementById('watchlistOnlyToggle'),
  hideFullToggle: document.getElementById('hideFullToggle'),
  sidebarCityFilters: document.getElementById('sidebarCityFilters'),
  sidebarTheaterFilters: document.getElementById('sidebarTheaterFilters'),
  sidebarGenreFilters: document.getElementById('sidebarGenreFilters'),
  sidebarPodiumpasToggle: document.getElementById('sidebarPodiumpasToggle'),
  sidebarWatchlistOnlyToggle: document.getElementById('sidebarWatchlistOnlyToggle'),
  sidebarHideFullToggle: document.getElementById('sidebarHideFullToggle'),
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
    profiel: document.getElementById('screen-profiel'),
  },
  detailBack: document.getElementById('detailBack'),
  detailWatchIcon: document.getElementById('detailWatchIcon'),
  detailWatchBtn: document.getElementById('detailWatchBtn'),
  detailWatchLabel: document.getElementById('detailWatchLabel'),
  detailPlanBtn: document.getElementById('detailPlanBtn'),
  detailPlanBar: document.getElementById('detailPlanBar'),
  detailStatusGepland: document.getElementById('detailStatusGepland'),
  detailStatusKaarten: document.getElementById('detailStatusKaarten'),
  detailUnplan: document.getElementById('detailUnplan'),
  detailPlanChange: document.getElementById('detailPlanChange'),
  detailPlanConflict: document.getElementById('detailPlanConflict'),
  geplandList: document.getElementById('geplandList'),
  geplandEmpty: document.getElementById('geplandEmpty'),
  geplandCount: document.getElementById('geplandCount'),
  detailBanner: document.getElementById('detailBanner'),
  detailGenre: document.getElementById('detailGenre'),
  detailTheater: document.getElementById('detailTheater'),
  detailStatusBadge: document.getElementById('detailStatusBadge'),
  detailPodiumpasBadge: document.getElementById('detailPodiumpasBadge'),
  detailTitle: document.getElementById('detailTitle'),
  detailMaker: document.getElementById('detailMaker'),
  detailDate: document.getElementById('detailDate'),
  detailTime: document.getElementById('detailTime'),
  detailAddress: document.getElementById('detailAddress'),
  detailDescription: document.getElementById('detailDescription'),
  detailOtherDatesWrap: document.getElementById('detailOtherDatesWrap'),
  detailOtherDates: document.getElementById('detailOtherDates'),
  detailRelatedTheatersWrap: document.getElementById('detailRelatedTheatersWrap'),
  detailRelatedTheaters: document.getElementById('detailRelatedTheaters'),
  detailCheckedAt: document.getElementById('detailCheckedAt'),
  detailReserveBtn: document.getElementById('detailReserveBtn'),
  detailReserveLabel: document.getElementById('detailReserveLabel'),
  detailPodiumpasNotice: document.getElementById('detailPodiumpasNotice'),
  detailAddCalendar: document.getElementById('detailAddCalendar'),
  theatersList: document.getElementById('theatersList'),
  favoritesList: document.getElementById('favoritesList'),
  favoritesEmpty: document.getElementById('favoritesEmpty'),
  authBox: document.getElementById('authBox'),
  feedbackForm: document.getElementById('feedbackForm'),
  feedbackInput: document.getElementById('feedbackInput'),
  feedbackSubmit: document.getElementById('feedbackSubmit'),
  feedbackStatus: document.getElementById('feedbackStatus'),
};

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

// Meteen toepassen (i.p.v. pas na de shows.json-fetch in init() hieronder)
// zodat de sidebar-accordeons niet eerst kort de verkeerde (statische
// HTML-)stand laten zien voordat het netwerkverzoek klaar is.
renderSidebarSections();

async function init() {
  const theaterInfoPromise = loadTheaterInfo();
  const res = await fetch('data/shows.json');
  const shows = await res.json();
  state.theaterInfo = await theaterInfoPromise;
  shows.sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
  state.shows = shows;

  migrateFavoritesOnceLocally();
  renameFavoritesForCurrentUser();
  syncProfielForCurrentUser();

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

  // Herstelde zoekopdracht (zie savedFilters bij het state-object) in
  // beide zoekvelden zetten; op mobiel ook meteen de zoekbalk tonen i.p.v.
  // 'm verborgen te laten terwijl er stilletjes al op gefilterd wordt —
  // zonder focus() (dat zou ongevraagd het toetsenbord openen).
  if (state.searchQueryRaw) {
    els.searchInput.value = state.searchQueryRaw;
    els.sidebarSearchInput.value = state.searchQueryRaw;
    els.headerTitleGroup.hidden = true;
    els.headerActions.hidden = true;
    els.headerSearch.hidden = false;
  }

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
  els.watchlistOnlyToggle.addEventListener('click', onWatchlistToggleClick);
  els.sidebarWatchlistOnlyToggle.addEventListener('click', onWatchlistToggleClick);
  els.hideFullToggle.addEventListener('click', onHideFullToggleClick);
  els.sidebarHideFullToggle.addEventListener('click', onHideFullToggleClick);
  els.clearFilters.addEventListener('click', clearAllFilters);
  els.sidebarClearFilters.addEventListener('click', clearAllFilters);
  for (const id of SIDEBAR_SECTION_IDS) {
    els.sidebarAccordionHeaders[id].addEventListener('click', () => toggleSidebarSection(id));
  }

  els.detailBack.addEventListener('click', () => navigate('#/'));
  els.bottomNav.addEventListener('click', (e) => {
    const btn = e.target.closest('.nav-item');
    if (!btn) return;
    if (btn.dataset.tab === 'agenda') navigate('#/');
    if (btn.dataset.tab === 'theaters') navigate('#/theaters');
    if (btn.dataset.tab === 'profiel') navigate('#/profiel');
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

  // #/favorieten was tot 28 sep 2026 de tab met favorieten (oude links/bladwijzers).
  if (hash === '#/favorieten') {
    location.replace('#/profiel');
    return;
  }

  if (hash === '#/profiel') {
    showScreen('profiel');
    renderProfielScreen();
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
// Ontbrekende/onbekende waarden vallen terug op "closed" (de sidebar
// oogt anders al snel druk met ~16 theaters over 4 steden) — een
// expliciet opgeslagen "open" blijft gewoon open.
function loadSidebarSections() {
  let stored = {};
  try {
    stored = JSON.parse(localStorage.getItem(STORAGE_KEYS.sidebarSections)) ?? {};
  } catch {
    stored = {};
  }
  const sections = {};
  for (const id of SIDEBAR_SECTION_IDS) {
    sections[id] = stored[id] === 'open' ? 'open' : 'closed';
  }
  return sections;
}

function saveSidebarSections() {
  localStorage.setItem(STORAGE_KEYS.sidebarSections, JSON.stringify(state.sidebarSections));
}

// Per-stad open/dicht-status van de accordeons in "Mijn theaters" — net als
// sidebarSections hierboven, maar keyed op stadsnaam i.p.v. een vaste lijst
// van section-ids, want welke steden er zijn hangt af van de scrapete data.
// Een stad zonder opgeslagen voorkeur is standaard dicht.
function loadTheaterCitySections() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEYS.theaterCitySections)) ?? {};
  } catch {
    return {};
  }
}

function saveTheaterCitySections() {
  localStorage.setItem(STORAGE_KEYS.theaterCitySections, JSON.stringify(state.theaterCitySections));
}

// Agenda-filters (stad/theater/genre-selecties, de 3 toggles, zoekopdracht)
// — lokaal-only, zie de toelichting bij het state-object hierboven.
// Ontbrekende/ongeldige velden (eerste bezoek, of een oudere opgeslagen
// vorm) vallen terug op de lege/uit-stand in plaats van te crashen.
function loadFilters() {
  let stored = {};
  try {
    stored = JSON.parse(localStorage.getItem(STORAGE_KEYS.filters)) ?? {};
  } catch {
    stored = {};
  }
  return {
    selectedCities: new Set(Array.isArray(stored.selectedCities) ? stored.selectedCities : []),
    selectedTheaters: new Set(Array.isArray(stored.selectedTheaters) ? stored.selectedTheaters : []),
    selectedGenres: new Set(Array.isArray(stored.selectedGenres) ? stored.selectedGenres : []),
    podiumpasOnly: stored.podiumpasOnly === true,
    // Heette tot 28 sep 2026 favoritesOnly.
    watchlistOnly: (stored.watchlistOnly ?? stored.favoritesOnly) === true,
    hideFullOnly: stored.hideFullOnly === true,
    searchQueryRaw: typeof stored.searchQuery === 'string' ? stored.searchQuery : '',
  };
}

function saveFilters() {
  localStorage.setItem(
    STORAGE_KEYS.filters,
    JSON.stringify({
      selectedCities: [...state.selectedCities],
      selectedTheaters: [...state.selectedTheaters],
      selectedGenres: [...state.selectedGenres],
      podiumpasOnly: state.podiumpasOnly,
      watchlistOnly: state.watchlistOnly,
      hideFullOnly: state.hideFullOnly,
      searchQuery: state.searchQueryRaw,
    })
  );
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

// Hernoemde titels (zie favorites.js): bij elke keer laden toepassen, en
// alleen opslaan als er echt een oude sleutel is vervangen. Bewust los van
// migrateFavorites() en de favoritesMigrated-vlag.
function renameFavoritesLocally() {
  state.favorites = renameFavoritesAndPersist(
    state.favorites,
    (renamed) => localStorage.setItem(STORAGE_KEYS.favorites, JSON.stringify([...renamed])),
    currentProductionKeys()
  );
}

// theaterId::titel van alle voorstellingen in de geladen data — leeg zolang
// shows.json nog niet binnen is, en dan verhuist applyTheaterMoves niets.
function currentProductionKeys() {
  return new Set(state.shows.map(productionKey));
}

function renameFavoritesInCloud(ref) {
  state.favorites = renameFavoritesAndPersist(
    state.favorites,
    (renamed) =>
      setDoc(ref, { favorites: [...renamed] }, { merge: true }).catch((err) =>
        console.error('Kon hernoemde favorieten niet synchroniseren:', err)
      ),
    currentProductionKeys()
  );
}

// Na het laden van de data: de hernoemingen die van de data afhangen
// (verhuisde theaters) opnieuw toepassen, voor wie ingelogd is in de cloud.
// Nodig als het inloggen al klaar was voordat shows.json binnen was.
function renameFavoritesForCurrentUser() {
  if (state.user) renameFavoritesInCloud(userDocRef(state.user.uid));
  else renameFavoritesLocally();
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

// ---------- Watchlist (zie watchlist.js) ----------

function loadWatchlistLocal() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEYS.watchlist)) ?? legeWatchlist();
  } catch {
    return legeWatchlist();
  }
}

function saveWatchlistLocal(profiel) {
  localStorage.setItem(STORAGE_KEYS.watchlist, JSON.stringify(profiel));
}

// Bij elke keer laden (zonder vlag, idempotent): oude favorieten omzetten
// en samenvoegen, en alleen schrijven als er iets veranderd is. Wacht op de
// data (om oude slugs aan een bestaande titel te koppelen) en, ingelogd, op
// het Firestore-document. Het favorites-veld zelf blijft onaangeroerd.
// Ingelogd: cloud + wat er lokaal (uitgelogd) bij kwam, voor watchlist én
// planning; de laatste actie wint (tijdstempels, zie watchlist.js/gepland.js).
function syncProfielForCurrentUser() {
  if (state.shows.length === 0) return;
  const bekend = bekendeSleutels(state.shows);
  const lokaal = laadWatchlist({ opgeslagen: loadWatchlistLocal(), favorieten: [...loadFavorites()], bekend });
  if (lokaal.gewijzigd) saveWatchlistLocal(lokaal.profiel);
  const showIndex = indexeerShows(state.shows);
  const lokaalGepland = laadGepland({ opgeslagen: loadGeplandLocal(), index: showIndex });
  if (lokaalGepland.gewijzigd) saveGeplandLocal(lokaalGepland.profiel);

  if (!state.user) {
    state.watchlist = lokaal.profiel;
    state.gepland = lokaalGepland.profiel;
    logOudeSlugs(lokaal);
    return;
  }
  if (!state.cloudWatchlist || !state.cloudGepland) return;
  const ref = userDocRef(state.user.uid);

  const cloud = laadWatchlist({
    opgeslagen: state.cloudWatchlist,
    favorieten: [...state.favorites],
    extra: lokaal.profiel,
    bekend,
  });
  state.watchlist = cloud.profiel;
  logOudeSlugs(cloud);
  if (cloud.gewijzigd) {
    state.cloudWatchlist = cloud.profiel;
    setDoc(ref, cloud.profiel, { merge: true }).catch((err) => console.error('Kon de watchlist niet synchroniseren:', err));
  }

  const cloudGepland = laadGepland({ opgeslagen: state.cloudGepland, extra: lokaalGepland.profiel, index: showIndex });
  state.gepland = cloudGepland.profiel;
  if (cloudGepland.gewijzigd) {
    state.cloudGepland = cloudGepland.profiel;
    setDoc(ref, cloudGepland.profiel, { merge: true }).catch((err) =>
      console.error('Kon de planning niet synchroniseren:', err)
    );
  }
}

function logOudeSlugs({ log, gewijzigd }) {
  if (!gewijzigd || log.oudeSlugs.length === 0) return;
  const inData = log.oudeSlugs.filter((s) => s.inData).length;
  console.info(
    `[watchlist] ${log.oudeSlugs.length} oude slug(s) omgezet, ${inData} gekoppeld aan een titel in de agenda:`,
    log.oudeSlugs.map((s) => `${s.van} → ${s.naar} (${s.variant})`)
  );
}

const BLADWIJZER = '<path d="M6 3h12v18l-6-4-6 4z" />';

// Sleutels van wat nu op de watchlist staat; opnieuw opgebouwd als
// state.watchlist een ander object wordt (elke wijziging maakt een nieuw).
let watchlistSleutelsVoor = null;
let watchlistSleutelsCache = new Set();
function watchlistSleutels() {
  if (watchlistSleutelsVoor !== state.watchlist) {
    watchlistSleutelsVoor = state.watchlist;
    watchlistSleutelsCache = new Set((state.watchlist?.watchlist ?? []).map((i) => i.sleutel));
  }
  return watchlistSleutelsCache;
}

// De sleutel per voorstelling onthouden: het filter vraagt hem bij elke
// render voor alle ~7000 voorstellingen op.
const showSleutels = new WeakMap();
function showSleutel(show) {
  let k = showSleutels.get(show);
  if (k === undefined) {
    k = watchlistSleutel(show.titel, show.theaterId);
    showSleutels.set(show, k);
  }
  return k;
}

function isOpWatchlist(show) {
  return watchlistSleutels().has(showSleutel(show));
}

// Aan/uit via voegToe/verwijder: met tijdstempel, zodat bij samenvoegen
// met een ander apparaat de laatste actie wint (zie watchlist.js).
function toggleWatchlist(show) {
  const sleutel = showSleutel(show);
  state.watchlist = isOpWatchlist(show)
    ? verwijder(state.watchlist, sleutel)
    : voegToe(state.watchlist, { titel: show.titel, theaterId: show.theaterId });
  saveWatchlist();
  renderWatchButtons(show);
  renderAgenda();
}

function saveWatchlist() {
  // Ingelogd maar het Firestore-document nog niet binnen: lokaal bewaren;
  // syncProfielForCurrentUser() voegt het straks samen met de cloud.
  if (state.user && state.cloudWatchlist) {
    state.cloudWatchlist = state.watchlist;
    setDoc(userDocRef(state.user.uid), state.watchlist, { merge: true }).catch((err) =>
      console.error('Kon de watchlist niet synchroniseren:', err)
    );
    return;
  }
  saveWatchlistLocal(state.watchlist);
}

// ---------- Gepland (zie gepland.js) ----------

function loadGeplandLocal() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEYS.gepland)) ?? legeGepland();
  } catch {
    return legeGepland();
  }
}

function saveGeplandLocal(profiel) {
  localStorage.setItem(STORAGE_KEYS.gepland, JSON.stringify(profiel));
}

// Theaternaam voor een plan: de actuele naam (config via theaters.json, dan
// de agenda), en alleen als het theater niet meer bestaat de naam uit de
// momentopname. Zo tonen oude plannen ook een nieuwe naam.
function planTheaterNaam(item) {
  return (
    state.theaterInfo[item.theaterId]?.naam ??
    state.shows.find((s) => s.theaterId === item.theaterId)?.theaterNaam ??
    item.theaterNaam
  );
}

function saveGepland() {
  if (state.user && state.cloudGepland) {
    state.cloudGepland = state.gepland;
    setDoc(userDocRef(state.user.uid), state.gepland, { merge: true }).catch((err) =>
      console.error('Kon de planning niet synchroniseren:', err)
    );
    return;
  }
  saveGeplandLocal(state.gepland);
}

// Welke voorstelling in de huidige agenda bij elk plan hoort (koppel() in
// gepland.js), per plansleutel en per show.id. Opnieuw berekend als de
// planning of de data een ander object wordt.
let koppelingVoor = { gepland: null, shows: null };
let koppeling = { perSleutel: new Map(), perShow: new Map() };
function planKoppeling() {
  if (koppelingVoor.gepland !== state.gepland || koppelingVoor.shows !== state.shows) {
    koppelingVoor = { gepland: state.gepland, shows: state.shows };
    const index = indexeerShows(state.shows);
    koppeling = { perSleutel: new Map(), perShow: new Map() };
    for (const item of state.gepland?.gepland ?? []) {
      const r = koppel(item, index);
      koppeling.perSleutel.set(item.sleutel, r);
      if (r.show) koppeling.perShow.set(r.show.id, { item, soort: r.soort });
    }
  }
  return koppeling;
}

/** { item, soort } als deze voorstelling gepland is, anders undefined. */
function planVoor(show) {
  return planKoppeling().perShow.get(show.id);
}

function wijzigPlanning(nieuw, show) {
  state.gepland = nieuw;
  saveGepland();
  if (show) renderPlanControls(show);
  renderAgenda();
}

/** "Gepland" of "Kaarten ✓" in een agendaregel. */
function makePlanTag(status) {
  const tag = document.createElement('span');
  tag.className = `status-badge status-badge--${status === 'kaarten' ? 'kaarten' : 'gepland'}`;
  tag.textContent = status === 'kaarten' ? 'Kaarten ✓' : 'Gepland';
  return tag;
}

function renderPlanControls(show) {
  const plan = planVoor(show);
  els.detailPlanBtn.hidden = Boolean(plan);
  els.detailPlanBar.hidden = !plan;
  els.detailPlanBtn.onclick = () => wijzigPlanning(planIn(state.gepland, show), show);
  if (!plan) return;

  const { item, soort } = plan;
  els.detailStatusGepland.setAttribute('aria-pressed', String(item.status === 'gepland'));
  els.detailStatusKaarten.setAttribute('aria-pressed', String(item.status === 'kaarten'));
  els.detailStatusGepland.onclick = () => wijzigPlanning(zetStatus(state.gepland, item.sleutel, 'gepland'), show);
  els.detailStatusKaarten.onclick = () => wijzigPlanning(zetStatus(state.gepland, item.sleutel, 'kaarten'), show);
  els.detailUnplan.onclick = () => wijzigPlanning(haalUitPlanning(state.gepland, item.sleutel), show);

  const wijziging =
    soort === 'tijd'
      ? `Je plande dit om ${item.tijd ?? 'een onbekende tijd'}; het theater geeft nu ${show.tijd ?? 'nog geen tijd'} op.`
      : soort === 'titel'
        ? `Je plande dit als "${item.titel}"; het theater noemt het nu anders.`
        : '';
  els.detailPlanChange.textContent = wijziging;
  els.detailPlanChange.hidden = !wijziging;

  const anderen = zelfdeAvond(item, state.gepland.gepland);
  els.detailPlanConflict.textContent = anderen.length
    ? `Die dag heb je ook ${anderen.map((o) => `${o.titel} gepland (${o.tijd ?? 'tijd volgt'}, ${planTheaterNaam(o)})`).join(' en ')}.`
    : '';
  els.detailPlanConflict.hidden = anderen.length === 0;
}

function renderGeplandList() {
  const komend = komendePlannen(state.gepland?.gepland ?? [], todayIsoDate());
  els.geplandList.innerHTML = '';
  els.geplandEmpty.hidden = komend.length > 0;
  els.geplandCount.textContent = komend.length ? `${komend.length} voorstelling${komend.length === 1 ? '' : 'en'}` : '';
  const { perSleutel } = planKoppeling();
  for (const item of komend) {
    els.geplandList.appendChild(renderPlanRow(item, perSleutel.get(item.sleutel) ?? { show: null, soort: 'weg' }));
  }
}

const SOORT_LABELS = { tijd: 'Tijd gewijzigd', titel: 'Titel gewijzigd', weg: 'Niet meer in de agenda' };

function renderPlanRow(item, { show, soort }) {
  const row = document.createElement('div');
  row.className = 'plan-row' + (soort === 'weg' ? ' plan-row--weg' : '');

  const { day, month } = parseIsoDate(item.datum);
  const when = document.createElement('div');
  when.className = 'plan-when';
  when.innerHTML = `<b>${day}</b><small>${MONTHS[month - 1].slice(0, 3)}</small>`;
  when.setAttribute('aria-label', formatDateLong(item.datum));

  const info = document.createElement(show ? 'button' : 'div');
  info.className = 'plan-info';
  if (show) {
    info.type = 'button';
    info.addEventListener('click', () => navigate(`#/show/${encodeURIComponent(show.id)}`));
  }
  const title = document.createElement('span');
  title.className = 'plan-title';
  title.textContent = item.titel;
  const meta = document.createElement('span');
  meta.className = 'plan-meta';
  const tijd = show?.tijd ?? item.tijd;
  const theaterNaam = planTheaterNaam(item);
  meta.textContent = tijd ? `${theaterNaam} · ${tijd}` : theaterNaam;
  info.append(title, meta);
  const notes = [];
  if (soort === 'tijd') notes.push(`${SOORT_LABELS.tijd} (was ${item.tijd ?? 'onbekend'})`);
  else if (soort !== 'exact') notes.push(SOORT_LABELS[soort]);
  const anderen = zelfdeAvond(item, state.gepland.gepland);
  if (anderen.length) notes.push(`Zelfde dag als ${anderen.map((o) => o.titel).join(', ')}`);
  if (notes.length) {
    const note = document.createElement('span');
    note.className = 'plan-flag';
    note.textContent = notes.join(' · ');
    info.appendChild(note);
  }

  const actions = document.createElement('div');
  actions.className = 'plan-actions';
  const status = document.createElement('button');
  status.type = 'button';
  status.className = `plan-status plan-status--${item.status}`;
  status.textContent = item.status === 'kaarten' ? 'Kaarten ✓' : 'Gepland';
  const volgende = item.status === 'kaarten' ? 'gepland' : 'kaarten';
  status.setAttribute(
    'aria-label',
    `Status: ${item.status === 'kaarten' ? 'kaarten geregeld' : 'gepland'}. Wissel naar ${volgende === 'kaarten' ? 'kaarten geregeld' : 'gepland'}.`
  );
  status.addEventListener('click', () => {
    state.gepland = zetStatus(state.gepland, item.sleutel, volgende);
    saveGepland();
    renderGeplandList();
    renderAgenda();
  });
  const ics = document.createElement('button');
  ics.type = 'button';
  ics.className = 'plan-ics';
  ics.textContent = '.ics';
  ics.setAttribute('aria-label', `${item.titel} in je eigen agenda zetten (.ics)`);
  ics.addEventListener('click', () =>
    downloadIcs(show ?? { ...item, theaterNaam: planTheaterNaam(item), id: item.sleutel, beschrijving: '' }, item.sleutel)
  );
  actions.append(status, ics);

  row.append(when, info, actions);
  return row;
}

// ---------- Inloggen (optioneel) ----------

function userDocRef(uid) {
  return doc(db, 'users', uid);
}

async function handleAuthChange(user) {
  state.user = user;
  state.authError = null;
  state.cloudWatchlist = null;
  state.cloudGepland = null;

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
        renameFavoritesInCloud(ref);
        state.cloudWatchlist = { watchlist: data.watchlist ?? [], watchlistVerwijderd: data.watchlistVerwijderd ?? [] };
        state.cloudGepland = { gepland: data.gepland ?? [], geplandVerwijderd: data.geplandVerwijderd ?? [] };
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
        state.cloudWatchlist = legeWatchlist();
        state.cloudGepland = legeGepland();
      }
      syncProfielForCurrentUser();
    } catch (err) {
      console.error('Kon cloudgegevens niet laden:', err);
    }
  } else {
    state.favorites = loadFavorites();
    renameFavoritesLocally();
    state.enabledTheaters = loadEnabledTheaters();
    syncProfielForCurrentUser();
  }

  renderAuthBox();
  renderFilters();
  renderFilterBadge();
  renderSubtitle();
  renderAgenda();

  const hash = location.hash || '#/';
  if (hash === '#/theaters') renderTheatersScreen();
  if (hash === '#/profiel') renderProfielScreen();
  if (hash.startsWith('#/show/')) {
    const id = decodeURIComponent(hash.slice('#/show/'.length));
    const show = state.shows.find((s) => s.id === id);
    if (show) {
      renderWatchButtons(show);
      renderPlanControls(show);
    }
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
    sub.textContent = 'Je watchlist, planning en theaterkeuze staan op al je apparaten.';
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
    title.textContent = 'Niet ingelogd';
    const desc = document.createElement('p');
    desc.className = 'auth-box-desc';
    desc.textContent = 'Je watchlist en planning staan nu alleen op dit apparaat. Log in om ze overal te hebben.';
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
  saveFilters();
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
    saveFilters();
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
  return state.shows.find((s) => s.theaterId === id)?.theaterNaam ?? state.theaterInfo[id]?.naam ?? id;
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

// .some() i.p.v. de eerste match pakken: bij de meeste theaters is
// podiumpas nog steeds gewoon aan-of-uit voor de hele locatie, maar bij
// Bostheater (theatervoorstellingen wel, concerten niet) zou "eerste show"
// willekeurig zijn en verschuiven naarmate de speellijst opschuift.
function theaterHasPodiumpas(id) {
  return state.shows.some((s) => s.theaterId === id && s.podiumpas === true);
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
  saveFilters();
}

function onTheaterToggle(id) {
  toggleSetMember(state.selectedTheaters, id);
  renderTheaterFilters();
  renderFilterBadge();
  renderAgenda();
  saveFilters();
}

function onGenreToggle(genre) {
  toggleSetMember(state.selectedGenres, genre);
  renderGenreFilters();
  renderFilterBadge();
  renderAgenda();
  saveFilters();
}

function onPodiumpasToggleClick() {
  state.podiumpasOnly = !state.podiumpasOnly;
  // renderFilters() cascades into city/theater options (and prunes any
  // now-stale selectedCities/selectedTheaters), same mechanism as when a
  // city gets deselected.
  renderFilters();
  renderFilterBadge();
  renderAgenda();
  saveFilters();
}

function onWatchlistToggleClick() {
  state.watchlistOnly = !state.watchlistOnly;
  renderWatchlistToggle();
  renderFilterBadge();
  renderAgenda();
  saveFilters();
}

function onHideFullToggleClick() {
  state.hideFullOnly = !state.hideFullOnly;
  renderHideFullToggle();
  renderFilterBadge();
  renderAgenda();
  saveFilters();
}

function clearAllFilters() {
  state.selectedCities.clear();
  state.selectedTheaters.clear();
  state.selectedGenres.clear();
  state.podiumpasOnly = false;
  state.watchlistOnly = false;
  state.hideFullOnly = false;
  renderFilters();
  renderFilterBadge();
  renderAgenda();
  saveFilters();
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
  const present = GENRE_CATEGORIES.filter((g) => state.shows.some((s) => getGenreBucket(s) === g));

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

function renderWatchlistToggle() {
  for (const btn of [els.watchlistOnlyToggle, els.sidebarWatchlistOnlyToggle]) {
    btn.classList.toggle('is-on', state.watchlistOnly);
    btn.setAttribute('aria-checked', String(state.watchlistOnly));
  }
}

function renderHideFullToggle() {
  for (const btn of [els.hideFullToggle, els.sidebarHideFullToggle]) {
    btn.classList.toggle('is-on', state.hideFullOnly);
    btn.setAttribute('aria-checked', String(state.hideFullOnly));
  }
}

/** Rendert alle filter-UI (sidebar + sheet) in één keer — city eerst,
 * want theater cascadeert erop. */
function renderFilters() {
  renderCityFilters();
  renderTheaterFilters();
  renderGenreFilters();
  renderPodiumpasToggle();
  renderWatchlistToggle();
  renderHideFullToggle();
}

function renderFilterBadge() {
  const count =
    (state.selectedCities.size > 0 ? 1 : 0) +
    (state.selectedTheaters.size > 0 ? 1 : 0) +
    (state.selectedGenres.size > 0 ? 1 : 0) +
    (state.podiumpasOnly ? 1 : 0) +
    (state.watchlistOnly ? 1 : 0) +
    (state.hideFullOnly ? 1 : 0);
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
  const minDate = todayIsoDate();
  // Een actieve zoekopdracht heft de 30-dagen-grens op — anders is zoeken
  // naar een favoriete productie onbruikbaar zodra de eerstvolgende datum
  // verder in de toekomst ligt dan het venster (zie "Teckel"-voorbeeld:
  // pas vanaf januari, dus onvindbaar binnen de standaard 30 dagen).
  const maxDate =
    !ignoreDateWindow && !state.searchQuery && state.dateWindowDays != null
      ? addDaysIso(todayIsoDate(), state.dateWindowDays)
      : null;

  return state.shows.filter((s) => {
    if (!enabled.has(s.theaterId)) return false;
    const cityOk = state.selectedCities.size === 0 || state.selectedCities.has(s.stad);
    const theaterOk = state.selectedTheaters.size === 0 || state.selectedTheaters.has(s.theaterId);
    const genreOk = state.selectedGenres.size === 0 || state.selectedGenres.has(getGenreBucket(s));
    const podiumpasOk = !state.podiumpasOnly || s.podiumpas === true;
    const watchlistOk = !state.watchlistOnly || isOpWatchlist(s);
    // 'onbekend' blijft altijd zichtbaar — we weten domweg niet of die vol
    // is, en dat is iets anders dan bevestigd vol (uitverkocht/wachtlijst).
    const fullOk =
      !state.hideFullOnly || (s.beschikbaarheid !== 'uitverkocht' && s.beschikbaarheid !== 'wachtlijst');
    // Ondergrens geldt altijd, ook met ignoreDateWindow (dat heft alleen de
    // voorwaartse 30-dagen-grens op via "toon meer" — verleden tijd tonen we
    // nooit, dat is geen "meer", dat is gewoon verlopen data).
    const dateOk = s.datum >= minDate && (maxDate == null || s.datum <= maxDate);
    const searchOk =
      !state.searchQuery ||
      s.titel.toLowerCase().includes(state.searchQuery) ||
      s.theaterNaam.toLowerCase().includes(state.searchQuery) ||
      (THEATER_ZOEKALIASSEN[s.theaterId] ?? []).some((alias) => alias.includes(state.searchQuery));
    return cityOk && theaterOk && genreOk && podiumpasOk && watchlistOk && fullOk && dateOk && searchOk;
  });
}

function formatDateHeading(isoDate) {
  const { day, month } = parseIsoDate(isoDate);
  const weekdag = WEEKDAYS[dateFromIso(isoDate).getDay()];
  // "Di 29 sep": in Fraunces rustiger dan hoofdletters.
  return `${weekdag.charAt(0).toUpperCase()}${weekdag.slice(1)} ${day} ${MONTHS[month - 1]}`;
}

function emptyStateMessage() {
  const filtersActive =
    state.selectedCities.size > 0 ||
    state.selectedTheaters.size > 0 ||
    state.selectedGenres.size > 0 ||
    state.podiumpasOnly ||
    state.watchlistOnly ||
    state.hideFullOnly;
  const query = state.searchQueryRaw;
  if (query && filtersActive) return `Geen voorstellingen gevonden voor "${query}" met deze filters.`;
  if (query) return `Geen voorstellingen gevonden voor "${query}".`;
  if (filtersActive) return 'Geen voorstellingen gevonden voor deze filters.';
  return 'Geen voorstellingen gevonden.';
}

function renderAgenda() {
  const shows = filteredShows();
  const totalWithoutWindow = filteredShows({ ignoreDateWindow: true }).length;
  const hiddenCount = totalWithoutWindow - shows.length;

  if (shows.length === 0) {
    els.agendaList.innerHTML = '';
    // Niets binnen het datumvenster, maar wel later (vaak bij "Toon alleen
    // watchlist"): zeg dat, en laat de knop naar verder in de toekomst staan.
    els.emptyState.textContent =
      state.dateWindowDays != null && hiddenCount > 0
        ? `Geen voorstellingen in de komende ${state.dateWindowDays} dagen.`
        : emptyStateMessage();
    els.emptyState.hidden = false;
    els.agendaList.appendChild(els.emptyState);
    if (state.dateWindowDays != null && hiddenCount > 0) els.agendaList.appendChild(makeShowMoreButton(hiddenCount));
    return;
  }
  els.emptyState.hidden = true;
  renderShowGroups(els.agendaList, shows);

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

  // Tijd links in een vaste kolom; zonder tijd een streepje.
  const time = document.createElement('span');
  time.className = 'show-time';
  time.textContent = show.tijd ?? '–';

  const info = document.createElement('span');
  info.className = 'show-info';

  const title = document.createElement('p');
  title.className = 'show-title';
  const titleText = document.createElement('span');
  titleText.className = 'show-title-text';
  titleText.textContent = show.maker ? `${show.titel} - ${show.maker}` : show.titel;
  title.appendChild(titleText);

  const meta = document.createElement('p');
  meta.className = 'show-meta';
  meta.textContent = show.stad ? `${show.theaterNaam} · ${show.stad}` : show.theaterNaam;

  // Genre en badges op één regel.
  const tagsRow = document.createElement('div');
  tagsRow.className = 'show-meta-row';

  const genreTag = document.createElement('span');
  genreTag.className = 'show-genre-tag';
  genreTag.textContent = getGenreBucket(show);
  tagsRow.appendChild(genreTag);

  if (show.podiumpas === true) tagsRow.appendChild(makePodiumpasIcon());

  const badge = makeStatusBadge(show.beschikbaarheid);
  if (badge) tagsRow.appendChild(badge);

  const plan = planVoor(show);
  if (plan) tagsRow.appendChild(makePlanTag(plan.item.status));

  info.append(title, meta, tagsRow);

  row.append(time, info);
  // Alleen watchlist-items krijgen rechts een (gevulde) bladwijzer.
  if (isOpWatchlist(show)) row.appendChild(makeWatchlistIcon());
  return row;
}

/** Gevulde bladwijzer achter de titel van een voorstelling op je watchlist. */
function makeWatchlistIcon() {
  const wrap = document.createElement('span');
  wrap.className = 'watchlist-icon';
  wrap.setAttribute('role', 'img');
  wrap.setAttribute('aria-label', 'Op je watchlist');
  wrap.title = 'Op je watchlist';
  const svg = svgIcon(BLADWIJZER);
  svg.setAttribute('fill', 'currentColor');
  wrap.appendChild(svg);
  return wrap;
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

async function loadTheaterInfo() {
  try {
    const res = await fetch('data/theaters.json');
    if (!res.ok) return {};
    return (await res.json()).theaters ?? {};
  } catch {
    return {};
  }
}

// Melding boven de "Reserveer"-knop bij theaters waar je met de Podiumpas
// niet online kunt reserveren — alleen bij podiumpas: true, zodat er bij
// andere voorstellingen niets verandert. Opgebouwd met DOM-elementen (geen
// innerHTML): de gegevens komen uit config.js, maar zo blijft het veilig.
function renderPodiumpasNotice(show) {
  const info = show.podiumpas === true ? state.theaterInfo[show.theaterId]?.podiumpasReserveren : null;
  const box = els.detailPodiumpasNotice;
  box.replaceChildren();
  box.hidden = !info;
  if (!info) return false;

  const title = document.createElement('strong');
  title.textContent = 'Met je Podiumpas reserveer je hier niet online';
  box.append(title);

  const link = (href, label) => {
    const a = document.createElement('a');
    a.href = href;
    a.textContent = label;
    return a;
  };
  const ways = [];
  if (info.telefoon) ways.push(['bel ', link(`tel:${info.telefoon.replace(/[^\d+]/g, '')}`, info.telefoon)]);
  if (info.email) ways.push(['mail ', link(`mailto:${info.email}`, info.email)]);
  if (info.formulier) {
    const a = link(info.formulier, 'het Podiumpas-formulier');
    a.target = '_blank';
    a.rel = 'noopener';
    ways.push(['gebruik ', a]);
  }
  const line = document.createElement('span');
  ways.forEach(([verb, a], i) => {
    if (i > 0) line.append(i === ways.length - 1 ? ' of ' : ', ');
    line.append(i === 0 ? verb[0].toUpperCase() + verb.slice(1) : verb, a);
  });
  line.append('.');
  box.append(line);

  if (info.toelichting) {
    const extra = document.createElement('span');
    extra.className = 'podiumpas-notice__toelichting';
    extra.textContent = info.toelichting;
    box.append(extra);
  }
  return true;
}

function renderDetail(show) {
  els.detailGenre.textContent = getGenreBucket(show);
  els.detailTheater.textContent = show.theaterNaam;
  els.detailPodiumpasBadge.hidden = show.podiumpas !== true;
  els.detailTitle.textContent = show.titel;
  els.detailMaker.textContent = show.maker ?? '';
  els.detailMaker.hidden = !show.maker;
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

  const offlinePodiumpas = renderPodiumpasNotice(show);
  els.detailReserveLabel.textContent = offlinePodiumpas
    ? 'Kaarten (zonder Podiumpas)'
    : `Reserveer op ${hostnameOf(show.reserverenUrl)}`;
  els.detailReserveBtn.href = show.reserverenUrl;

  renderWatchButtons(show);
  renderPlanControls(show);
  renderOtherDates(show);
  renderRelatedTheaters(show);

  els.detailWatchIcon.onclick = () => toggleWatchlist(show);
  els.detailWatchBtn.onclick = () => toggleWatchlist(show);

  els.detailAddCalendar.onclick = () => downloadIcs(show);
}

function renderWatchButtons(show) {
  const op = isOpWatchlist(show);
  const label = op ? 'Van watchlist halen' : 'Op watchlist zetten';
  for (const btn of [els.detailWatchIcon, els.detailWatchBtn]) {
    btn.classList.toggle('is-on', op);
    btn.setAttribute('aria-pressed', String(op));
    btn.querySelector('svg').setAttribute('fill', op ? 'currentColor' : 'none');
  }
  els.detailWatchIcon.setAttribute('aria-label', label);
  els.detailWatchIcon.title = label;
  els.detailWatchLabel.textContent = op ? 'Op je watchlist' : 'Op watchlist';
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

function renderRelatedTheaters(show) {
  const byTheater = getOtherTheaterShows(show, state.shows);

  if (byTheater.size === 0) {
    els.detailRelatedTheatersWrap.hidden = true;
    return;
  }

  els.detailRelatedTheatersWrap.hidden = false;
  els.detailRelatedTheaters.innerHTML = '';

  const theaterIds = [...byTheater.keys()].sort((a, b) =>
    (state.shows.find((s) => s.theaterId === a)?.theaterNaam ?? a).localeCompare(
      state.shows.find((s) => s.theaterId === b)?.theaterNaam ?? b
    )
  );

  for (const theaterId of theaterIds) {
    const shows = byTheater.get(theaterId);

    const group = document.createElement('div');
    group.className = 'related-theater-group';

    const name = document.createElement('h4');
    name.className = 'related-theater-name';
    name.textContent = shows[0].theaterNaam;
    group.appendChild(name);

    const row = document.createElement('div');
    row.className = 'filter-row filter-row--wrap';
    row.setAttribute('role', 'group');
    row.setAttribute('aria-label', shows[0].theaterNaam);
    for (const s of shows) {
      const label = s.tijd ? `${formatDateShort(s.datum)}, ${s.tijd}` : formatDateShort(s.datum);
      row.appendChild(makeChip(label, false, () => navigate(`#/show/${encodeURIComponent(s.id)}`)));
    }
    group.appendChild(row);

    els.detailRelatedTheaters.appendChild(group);
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

function buildIcs(show, uid = show.id) {
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
    `UID:${String(uid).replace(/[^a-z0-9-]+/gi, '-')}@podiumagenda`,
    `DTSTAMP:${stamp(new Date())}`,
    `DTSTART:${stamp(start)}`,
    `DTEND:${stamp(end)}`,
    `SUMMARY:${icsEscape(show.titel)}`,
    `DESCRIPTION:${icsEscape(show.beschrijving)}`,
    `LOCATION:${icsEscape([show.theaterNaam, THEATER_INFO[show.theaterId]?.adres, show.stad].filter(Boolean).join(', '))}`,
    `URL:${icsEscape(show.reserverenUrl)}`,
    'END:VEVENT',
    'END:VCALENDAR',
    '',
  ].join('\r\n');
}

function downloadIcs(show, uid = show.id) {
  const blob = new Blob([buildIcs(show, uid)], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${String(show.id).replace(/[^a-z0-9-]+/gi, '-')}.ics`;
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
  const naam = theaterShow?.theaterNaam ?? state.theaterInfo[id]?.naam ?? id;
  const melding = state.theaterInfo[id]?.melding ?? null;
  const adres = THEATER_INFO[id]?.adres ?? '';
  // .some() i.p.v. de eerste match: bij een gemengd theater (bv.
  // Bostheater, waar podiumpas per show verschilt) zou "eerste show" hier
  // willekeurig zijn — zelfde afweging als theaterHasPodiumpas() bij de
  // sidebar-filterchip.
  const heeftPodiumpas = theaterHasPodiumpas(id);
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
  info.append(nameEl, addressEl);
  // Zonder voorstellingen valt er niets aan/uit te zetten en zegt het
  // Podiumpas-label niets — dan alleen naam en melding.
  if (theaterShow) info.append(podiumpasEl);
  if (melding) {
    const meldingEl = document.createElement('p');
    meldingEl.className = 'theater-card-melding';
    meldingEl.textContent = melding;
    const meldingLink = state.theaterInfo[id]?.meldingLink;
    if (meldingLink) {
      const a = document.createElement('a');
      a.href = meldingLink;
      a.target = '_blank';
      a.rel = 'noopener';
      a.textContent = `Naar de agenda van ${naam}`;
      meldingEl.append(document.createElement('br'), a);
    }
    info.append(meldingEl);
  }
  const hint = buildMoveHint(id);
  if (hint) info.append(hint);

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

  card.append(info);
  if (theaterShow) card.append(toggle);
  return card;
}

// Verhuisd theater (THEATER_MOVES, bv. Schouwburg Amstelveen → De Landing):
// wie het oude theater aan heeft maar het nieuwe uit, ziet de voorstellingen
// niet meer. Geen automatische wijziging (die zou zich bij elk bezoek
// herhalen), maar een knop die precies doet wat de schakelaar van het nieuwe
// theater doet. Datagestuurd: alleen zolang het oude theater geen
// voorstellingen heeft en het nieuwe wel; na de klik verdwijnt de hint.
function buildMoveHint(id) {
  const move = THEATER_MOVES.find((m) => m.van === id);
  if (!move) return null;
  const heeftShows = (tid) => state.shows.some((s) => s.theaterId === tid);
  const aan = (tid) => state.enabledTheaters[tid] !== false;
  if (!aan(move.van) || aan(move.naar) || heeftShows(move.van) || !heeftShows(move.naar)) return null;

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'theater-card-hint';
  btn.textContent = `Zet ${theaterDisplayName(move.naar)} aan`;
  btn.addEventListener('click', () => {
    state.enabledTheaters[move.naar] = true;
    refreshAfterTheaterToggle();
  });
  return btn;
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
 * per-theater switches eronder. Zit genest in de klikbare accordeon-header
 * (zie buildCitySection), dus stopPropagation om te voorkomen dat een klik
 * hier ook de accordeon dichtklapt. */
function buildCityToggleButton(stad, cityIds, allOn) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'city-toggle-btn';
  btn.textContent = allOn ? 'Alles uit' : 'Alles aan';
  btn.setAttribute('aria-label', `Alle theaters in ${stad} ${allOn ? 'verbergen' : 'tonen'}`);
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    for (const id of cityIds) state.enabledTheaters[id] = !allOn;
    refreshAfterTheaterToggle();
  });
  return btn;
}

/** Zelfde chevron-markup als de .filter-accordion-header-knoppen in de
 * sidebar (zie index.html), maar hier dynamisch opgebouwd omdat elke stad
 * zijn eigen accordeon-instantie krijgt. */
function buildChevronSvg() {
  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('class', 'filter-accordion-chevron');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  const polyline = document.createElementNS(svgNS, 'polyline');
  polyline.setAttribute('points', '6 9 12 15 18 9');
  svg.appendChild(polyline);
  return svg;
}

function toggleTheaterCitySection(stad, header, content) {
  const isOpen = state.theaterCitySections[stad] === 'open';
  state.theaterCitySections[stad] = isOpen ? 'closed' : 'open';
  header.setAttribute('aria-expanded', String(!isOpen));
  content.hidden = isOpen;
  saveTheaterCitySections();
}

/** Eén stad-sectie binnen een provincie: een inklapbare header (zelfde
 * accordeon-mechaniek/opslag-patroon als de sidebar's Stad/Theater/Genre-
 * secties, maar per stad in plaats van een vaste lijst van section-ids) met
 * daaronder de theater-kaarten. Standaard dicht, tenzij eerder opengeklapt. */
function buildCitySection(stad, cityIds) {
  // Telling en "alles aan/uit" alleen over theaters mét voorstellingen; een
  // gesloten theater (alleen een melding) staat er wel, maar telt niet mee.
  const toggleIds = cityIds.filter((id) => state.shows.some((s) => s.theaterId === id));
  const enabledCount = toggleIds.filter((id) => state.enabledTheaters[id] !== false).length;
  const allOn = enabledCount === toggleIds.length;
  const isOpen = state.theaterCitySections[stad] === 'open';

  const section = document.createElement('div');
  section.className = 'theaters-city-section';

  const header = document.createElement('div');
  header.className = 'theaters-list-heading theaters-city-header';
  header.setAttribute('role', 'button');
  header.setAttribute('tabindex', '0');
  header.setAttribute('aria-expanded', String(isOpen));

  const headingLeft = document.createElement('div');
  headingLeft.className = 'theaters-list-heading-left';
  const cityLabel = document.createElement('span');
  cityLabel.textContent = stad.toUpperCase();
  headingLeft.append(buildChevronSvg(), cityLabel);
  // Een stad met alleen gesloten/gepauzeerde theaters: niets aan of uit te zetten.
  if (toggleIds.length > 0) headingLeft.append(buildCityToggleButton(stad, toggleIds, allOn));

  const countLabel = document.createElement('span');
  countLabel.textContent = toggleIds.length > 0 ? `${enabledCount} van ${toggleIds.length}` : 'geen agenda';
  header.append(headingLeft, countLabel);

  const content = document.createElement('div');
  content.className = 'theaters-city-content';
  content.hidden = !isOpen;
  for (const id of cityIds) content.appendChild(buildTheaterCard(id));

  const toggle = () => toggleTheaterCitySection(stad, header, content);
  header.addEventListener('click', toggle);
  header.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      toggle();
    }
  });

  section.append(header, content);
  return section;
}

/** "Mijn theaters"-scherm, gegroepeerd per provincie (altijd uitgeklapt,
 * vaste volgorde) en daaronder per stad (inklapbaar, standaard dicht) —
 * zelfde indeling als podiumpas.nl/waar-te-besteden. Een stad die niet in
 * PROVINCE_BY_CITY voorkomt belandt zichtbaar in de PROVINCE_FALLBACK-sectie
 * i.p.v. stilzwijgend te verdwijnen. */
function renderTheatersScreen() {
  // Ook theaters zonder voorstellingen, als theaters.json er een melding
  // voor heeft (bv. tijdelijk gesloten) — anders verdwijnen ze stil.
  const metMelding = Object.keys(state.theaterInfo).filter((id) => state.theaterInfo[id]?.melding);
  const ids = sortTheaterIdsByName([...new Set([...state.shows.map((s) => s.theaterId), ...metMelding])]);

  const idsByStad = new Map();
  for (const id of ids) {
    const stad = state.shows.find((s) => s.theaterId === id)?.stad ?? state.theaterInfo[id]?.stad ?? '';
    if (!idsByStad.has(stad)) idsByStad.set(stad, []);
    idsByStad.get(stad).push(id);
  }
  const steden = [...idsByStad.keys()].sort((a, b) => a.localeCompare(b, 'nl'));

  const stedenByProvincie = new Map();
  for (const stad of steden) {
    const provincie = PROVINCE_BY_CITY[stad] ?? PROVINCE_FALLBACK;
    if (!stedenByProvincie.has(provincie)) stedenByProvincie.set(provincie, []);
    stedenByProvincie.get(provincie).push(stad);
  }
  const provincies = [...PROVINCE_ORDER, PROVINCE_FALLBACK].filter((p) => stedenByProvincie.has(p));

  els.theatersList.innerHTML = '';
  for (const provincie of provincies) {
    const heading = document.createElement('h2');
    heading.className = 'theaters-province-heading';
    heading.textContent = provincie;
    els.theatersList.appendChild(heading);

    for (const stad of stedenByProvincie.get(provincie)) {
      els.theatersList.appendChild(buildCitySection(stad, idsByStad.get(stad)));
    }
  }
}

// ---------- Profiel: watchlist ----------

/** Eén rij per watchlist-item, met de eerstvolgende voorstelling over alle
 * theaters heen. Staat een item niet (meer) in de agenda, dan tonen we het
 * niet-klikbaar met "Geen komende voorstellingen" — nooit stil weglaten. */
function watchlistProductions() {
  const vandaag = todayIsoDate();
  const perSleutel = new Map();
  for (const s of state.shows) {
    const k = showSleutel(s);
    if (!watchlistSleutels().has(k)) continue;
    if (!perSleutel.has(k)) perSleutel.set(k, []);
    perSleutel.get(k).push(s);
  }
  const productions = [];
  for (const item of state.watchlist?.watchlist ?? []) {
    const komend = (perSleutel.get(item.sleutel) ?? [])
      .filter((s) => s.datum >= vandaag)
      .sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
    const soonest = komend[0] ?? null;
    const theaters = new Set(komend.map((s) => s.theaterId));
    productions.push({
      key: item.sleutel,
      titel: soonest?.titel ?? item.titel,
      theaterNaam: soonest
        ? theaters.size > 1
          ? `${soonest.theaterNaam} en ${theaters.size - 1} ander${theaters.size === 2 ? '' : 'e'} theater${theaters.size === 2 ? '' : 's'}`
          : soonest.theaterNaam
        : item.theaterId ? theaterDisplayName(item.theaterId) : '',
      podiumpas: soonest?.podiumpas,
      soonest,
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
  const theaterNaam = production.theaterNaam;
  const wanneer = hasUpcoming ? `${formatDateShort(production.soonest.datum)} · ` : '';
  meta.textContent = hasUpcoming
    ? `${wanneer}${theaterNaam}`
    : [theaterNaam, 'Geen komende voorstellingen'].filter(Boolean).join(' · ');
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

function renderProfielScreen() {
  renderGeplandList();
  const productions = watchlistProductions();

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
