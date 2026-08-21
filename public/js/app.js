// Vaste volgorde/labels voor de theater-filterchips en -kaarten. Nieuwe
// theaters die nog niet in deze lijst staan, worden onderaan toegevoegd met
// hun volledige naam — zo blijft de UI werken als er later een stad/theater
// bijkomt.
const THEATER_ORDER = ['delamar', 'bellevue', 'meervaart'];
const THEATER_SHORT_NAMES = {
  delamar: 'DeLaMar',
  bellevue: 'Bellevue',
  meervaart: 'Meervaart',
};
// Adressen staan niet in shows.json (dat is per-voorstelling data, niet per
// theater) — vaste, kleine lookup hier is prima voor 3 theaters in 1 stad.
const THEATER_INFO = {
  delamar: { adres: 'Marnixstraat 402' },
  bellevue: { adres: 'Leidsekade 90' },
  meervaart: { adres: 'Meer en Vaart 300' },
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
  enabledTheaters: loadEnabledTheaters(),
  favorites: loadFavorites(),
  dateWindowDays: DEFAULT_WINDOW_DAYS,
};

const els = {
  subtitle: document.getElementById('subtitle'),
  theaterFilters: document.getElementById('theaterFilters'),
  sheetTheaterFilters: document.getElementById('sheetTheaterFilters'),
  sheetGenreFilters: document.getElementById('sheetGenreFilters'),
  agendaList: document.getElementById('agendaList'),
  emptyState: document.getElementById('emptyState'),
  filterToggle: document.getElementById('filterToggle'),
  filterBadge: document.getElementById('filterBadge'),
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
  detailTitle: document.getElementById('detailTitle'),
  detailDate: document.getElementById('detailDate'),
  detailTime: document.getElementById('detailTime'),
  detailAddress: document.getElementById('detailAddress'),
  detailDescription: document.getElementById('detailDescription'),
  detailOtherDatesWrap: document.getElementById('detailOtherDatesWrap'),
  detailOtherDates: document.getElementById('detailOtherDates'),
  detailReserveBtn: document.getElementById('detailReserveBtn'),
  detailReserveLabel: document.getElementById('detailReserveLabel'),
  detailAddCalendar: document.getElementById('detailAddCalendar'),
  theatersBack: document.getElementById('theatersBack'),
  theatersList: document.getElementById('theatersList'),
  theatersCount: document.getElementById('theatersCount'),
  favoritesList: document.getElementById('favoritesList'),
  favoritesEmpty: document.getElementById('favoritesEmpty'),
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
  renderFilterBadge();
  renderSubtitle();
  renderAgenda();

  els.filterToggle.addEventListener('click', openSheet);
  els.sheetClose.addEventListener('click', closeSheet);
  els.sheetBackdrop.addEventListener('click', closeSheet);
  els.clearFilters.addEventListener('click', () => {
    state.theaterFilter = 'alle';
    state.genreFilter = 'alle';
    renderTheaterFilters();
    renderGenreFilters();
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

function saveEnabledTheaters() {
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
  localStorage.setItem(STORAGE_KEYS.favorites, JSON.stringify([...state.favorites]));
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

function renderFilterBadge() {
  const count = (state.theaterFilter !== 'alle' ? 1 : 0) + (state.genreFilter !== 'alle' ? 1 : 0);
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
    const dateOk = maxDate == null || s.datum <= maxDate;
    return theaterOk && genreOk && dateOk;
  });
}

function formatDateHeading(isoDate) {
  const { day, month } = parseIsoDate(isoDate);
  return `${WEEKDAYS[dateFromIso(isoDate).getDay()]} ${day} ${MONTHS[month - 1]}`.toUpperCase();
}

function renderAgenda() {
  const shows = filteredShows();

  if (shows.length === 0) {
    els.agendaList.innerHTML = '';
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

  const meta = document.createElement('p');
  meta.className = 'show-meta';
  const theaterNaam = THEATER_SHORT_NAMES[show.theaterId] ?? show.theaterNaam;
  meta.textContent = show.tijd ? `${theaterNaam} · ${show.tijd}` : theaterNaam;

  info.append(title, meta);

  const chevron = svgIcon('<polyline points="9 6 15 12 9 18" />');
  chevron.classList.add('show-chevron');

  row.append(dot, info, chevron);
  return row;
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

  els.theatersList.innerHTML = '';
  for (const id of ids) {
    const naam = state.shows.find((s) => s.theaterId === id)?.theaterNaam ?? id;
    const adres = THEATER_INFO[id]?.adres ?? '';
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
    info.append(nameEl, addressEl);

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
