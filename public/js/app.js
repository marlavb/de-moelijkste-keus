import {
  auth,
  db,
  googleProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  doc,
  getDoc,
  getDocs,
  setDoc,
  deleteDoc,
  writeBatch,
  collection,
  query,
  where,
  orderBy,
  onSnapshot,
  getCountFromServer,
  runTransaction,
  serverTimestamp,
} from './firebase.js';
import {
  bewaarProfiel,
  laadProfiel,
  controleerGebruikersnaam,
  controleerNaam,
  voorstelGebruikersnaam,
  ProfielFout,
  GEBRUIKERSNAAM_UITLEG,
} from './profiel.js';
import {
  zoekGebruiker,
  stuurVerzoek,
  accepteer,
  haalVerzoekWeg,
  verbreek,
  blokkeer,
  deblokkeer,
  laadVriendenScherm,
  telInkomend,
  maakLink,
  trekLinkIn,
  bekijkLink,
  gebruikLink,
  linkUrl,
  linkVerlooptOp,
  VriendFout,
} from './vrienden.js';
import {
  ONDERDELEN,
  STANDAARD_INSTELLING,
  kopieWatchlist,
  kopieGezien,
  standVan,
  laadEigenDelen,
  zetInstelling,
  schrijfKopie,
  laadVriendDelen,
  sorteerKopieGezien,
  sorteerKopieWatchlist,
} from './gedeeld.js';
import { getGenreBucket, getGenres, matchtGenreFilter } from './genre.js';
import { getOtherTheaterShows } from './productions.js';
import { weergaveTitel, makerStaatInTitel, isVervallen, isVol, VERVALLEN_LABELS, watchlistStand } from './weergave.js';
import { renameFavoritesAndPersist, THEATER_MOVES } from './favorites.js';
import { laadWatchlist, bekendeSleutels, legeWatchlist, watchlistSleutel, voegToe, verwijder, NORMALISATIE_VERSIE, samenvoegMapping, groepeerWatchlist } from './watchlist.js';
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
  koppelPlan,
  zetMetWie,
  geplandSleutel,
} from './gepland.js';
import {
  MAX_GENODIGDEN,
  STATUS_LABELS,
  PlanFout,
  nodigUit,
  trekIn,
  zetMijnStatus,
  zetKaarten,
  hefOp,
  laadPlan,
  metWie,
  metWieRegels,
  laadBerichten,
  markeerGelezen,
  ruimBerichtenOp,
  uitnodigingStand,
  isNogTePlannen,
} from './plannen.js';
import {
  laadGezien,
  legeGezien,
  zetGezien,
  haalUitGezien,
  gezienSleutels as gezienSleutelsVan,
  verwerkVoorbijePlannen,
  laatsteBezoek,
  sorteerGezien,
  isVoorbij,
  bezoekUitShow,
  zetBeoordeling,
  beoordelingTekst,
  infoPerSleutel,
  gezienVeld,
} from './gezien.js';
import { maakSterren } from './sterren.js';

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
  // Uit de voettekst van dok6.eu/theater (30 sep 2026).
  dok6: { adres: 'Raadhuisplein 6' },
  // Uit de agenda van cpunt.nl (1 okt 2026).
  cpunt: { adres: 'Raadhuisplein 3-9' },
};

// Alleen "uitverkocht" en "wachtlijst" krijgen een badge — "beschikbaar" is
// de default en verdient geen visuele ruis, en "onbekend" laten we bewust
// leeg in plaats van een misleidende "beschikbaar"-badge te tonen.
// Oude of andere namen waarop een theater gevonden moet blijven (kleine
// letters). ITA heet sinds 30 sep 2026 "Stadsschouwburg Amsterdam".
const THEATER_ZOEKALIASSEN = {
  ita: ['ita', 'internationaal theater amsterdam'],
  dok6: ['dok6 theater'],
  kattendans: ['kattendans bergeijk'],
  paradox: ['muziekpodium paradox', 'paradox tilburg'],
  delink: ['nieuwe muziek tilburg', 'cenakel'],
  smet: ['smet', 's.m.e.t.', 'kamermuziek tilburg', 'cenakel'],
  markant: ['markant', 'maashorst', 'markant uden'],
  speelhuis: ['speelhuis helmond'],
  schouwburgconcertzaal: ['schouwburg tilburg', 'concertzaal tilburg', 'theaters tilburg'],
  willemtwee: ['willem twee', 'w2', 'toonzaal', 'den bosch'],
  theateraandeparade: ['parade', 'theater aan de parade', 'den bosch'],
  denieuwevorst: ['nieuwe vorst', 'de nieuwe vorst'],
  hofnar: ['hofnar', 'hofnar valkenswaard'],
  parktheater: ['parktheater', 'pand p'],
  vrijthof: ['vrijthof', 'theater vrijthof', 'tahv'],
  ainsi: ['ainsi theater', 'ainsi maastricht'],
  pltheerlen: ['plt', 'parkstad', 'parkstad limburg theaters', 'plt heerlen'],
  pltkerkrade: ['plt', 'parkstad', 'plt kerkrade'],
  pltsittard: ['plt', 'toon hermans', 'plt sittard'],
  oranjerie: ['oranjerie', 'theater roermond'],
  munttheater: ['munt', 'munttheater weert'],
  orpheus: ['orpheus', 'theater orpheus apeldoorn', 'apeldoorn'],
  agnietenhof: ['agnietenhof', 'schouwburg tiel', 'cultuurbedrijf tiel', 'tiel'],
  oostpool: ['oostpool', 'theater oostpool', 'huis oostpool arnhem', 'arnhem'],
  musis: ['musis', 'musis sacrum', 'musis en stadstheater', 'arnhem'],
  stadstheater: ['stadstheater arnhem', 'musis en stadstheater', 'arnhem'],
};

const BESCHIKBAARHEID_LABELS = {
  uitverkocht: 'Uitverkocht',
  wachtlijst: 'Wachtlijst',
  // Gaat op deze datum niet door (zie src/lib/beschikbaarheid.js).
  ...VERVALLEN_LABELS,
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
  gezien: 'podiumagenda:gezien',
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
const PROVINCE_ORDER = ['Noord-Holland', 'Zuid-Holland', 'Utrecht', 'Flevoland', 'Gelderland', 'Limburg', 'Noord-Brabant'];
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
  Beverwijk: 'Noord-Holland',
  Hoofddorp: 'Noord-Holland',
  Venlo: 'Limburg',
  Panningen: 'Limburg',
  Maastricht: 'Limburg',
  Heerlen: 'Limburg',
  Kerkrade: 'Limburg',
  Sittard: 'Limburg',
  Roermond: 'Limburg',
  Weert: 'Limburg',
  "'s-Hertogenbosch": 'Noord-Brabant',
  Eindhoven: 'Noord-Brabant',
  Helmond: 'Noord-Brabant',
  Tilburg: 'Noord-Brabant',
  Uden: 'Noord-Brabant',
  Valkenswaard: 'Noord-Brabant',
  Bergeijk: 'Noord-Brabant',
  Arnhem: 'Gelderland',
  Apeldoorn: 'Gelderland',
  Barneveld: 'Gelderland',
  Tiel: 'Gelderland',
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
  // "Verberg gezien" (standaard uit), zie gezien.js.
  hideGezien: savedFilters.hideGezien,
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
  // { gezien, gezienVerwijderd }, zie gezien.js; zelfde opzet als hierboven.
  gezien: loadGezienLocal(),
  cloudGezien: null,
  sidebarSections: loadSidebarSections(),
  theaterCitySections: loadTheaterCitySections(),
  dateWindowDays: DEFAULT_WINDOW_DAYS,
  user: null, // Firebase User, of null als niet ingelogd (= lokaal-only, zoals voorheen)
  authError: null,
  // Of onAuthStateChanged al één keer is gevuurd (daarvoor weten we niet of
  // iemand ingelogd is).
  authBekend: false,
  // Profiel (gebruikersnaam en naam, zie profiel.js), alleen ingelogd.
  // undefined = nog niet geladen, null = (nog) geen profiel. profielFout:
  // laden mislukt (bv. offline). profielGevraagd: de eenmalige vraag na
  // inloggen is al gesteld (onthouden in users/{uid}, dus op elk apparaat).
  profiel: undefined,
  profielFout: false,
  profielGevraagd: false,
  // Vrienden (stap 2, zie vrienden.js): geladen bij het openen van het
  // scherm, niet live. vrienden = { vrienden, inkomend, uitgaand,
  // geblokkeerd, links } of null; vriendenStatus 'leeg' | 'laden' | 'klaar'
  // | 'fout'; inkomendAantal voor de tegel in Profiel (null = onbekend).
  vrienden: null,
  vriendenStatus: 'leeg',
  inkomendAantal: null,
  // Geopende uitnodigingslink: { token, status: 'leeg'|'laden'|'klaar'|'fout'
  // |'bezig'|'gelukt', uitkomst } (uitkomst van bekijkLink).
  vriendLink: null,
  // Delen met vrienden (stap 3, zie gedeeld.js): undefined = nog niet
  // geladen, null = nog niet gekozen (eenmalige melding), anders
  // { gezien, watchlist }. delenFout: laden mislukt.
  delen: undefined,
  delenFout: false,
  // Berichten (stap 4b): aantal ongelezen (live, de enige listener), null = onbekend.
  ongelezen: null,
  // Mail bij uitnodigingen (stap 5): undefined = niet geladen, anders true/false.
  mailAan: undefined,
  mailFout: false,
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
  hideGezienToggle: document.getElementById('hideGezienToggle'),
  sidebarHideGezienToggle: document.getElementById('sidebarHideGezienToggle'),
  detailGezienBtn: document.getElementById('detailGezienBtn'),
  detailGezienLabel: document.getElementById('detailGezienLabel'),
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
    // Kan ontbreken bij een oudere index.html (zie showScreen).
    gezien: document.getElementById('screen-gezien'),
    watchlist: document.getElementById('screen-watchlist'),
    profielInstellen: document.getElementById('screen-profiel-instellen'),
    vrienden: document.getElementById('screen-vrienden'),
    vriendLink: document.getElementById('screen-vriendlink'),
    delen: document.getElementById('screen-delen'),
    vriend: document.getElementById('screen-vriend'),
    vriendItem: document.getElementById('screen-vrienditem'),
    uitnodigen: document.getElementById('screen-uitnodigen'),
    berichten: document.getElementById('screen-berichten'),
    mail: document.getElementById('screen-mail'),
  },
  detailGezienBlok: document.getElementById('detailGezienBlok'),
  detailGezienBezoeken: document.getElementById('detailGezienBezoeken'),
  gezienBack: document.getElementById('gezienBack'),
  gezienGenre: document.getElementById('gezienGenre'),
  gezienTitel: document.getElementById('gezienTitel'),
  gezienMaker: document.getElementById('gezienMaker'),
  gezienBezoeken: document.getElementById('gezienBezoeken'),
  gezienLink: document.getElementById('gezienLink'),
  watchlistItemBack: document.getElementById('watchlistItemBack'),
  watchlistItemIcon: document.getElementById('watchlistItemIcon'),
  watchlistItemGenre: document.getElementById('watchlistItemGenre'),
  watchlistItemTitel: document.getElementById('watchlistItemTitel'),
  watchlistItemMaker: document.getElementById('watchlistItemMaker'),
  watchlistItemTheater: document.getElementById('watchlistItemTheater'),
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
  detailVervallenNotice: document.getElementById('detailVervallenNotice'),
  detailReserveLabel: document.getElementById('detailReserveLabel'),
  detailPodiumpasNotice: document.getElementById('detailPodiumpasNotice'),
  detailAddCalendar: document.getElementById('detailAddCalendar'),
  theatersList: document.getElementById('theatersList'),
  favoritesList: document.getElementById('favoritesList'),
  favoritesEmpty: document.getElementById('favoritesEmpty'),
  // Gezien (30 sep 2026). Kan ontbreken bij een oudere index.html naast een
  // nieuwere app.js (na een deploy): overal met ?. gebruiken.
  gezienList: document.getElementById('gezienList'),
  gezienEmpty: document.getElementById('gezienEmpty'),
  gezienCount: document.getElementById('gezienCount'),
  authBox: document.getElementById('authBox'),
  // Profiel instellen (vrienden, stap 1, okt 2026). Kan ontbreken bij een
  // oudere index.html: overal met ?. gebruiken.
  profielBack: document.getElementById('profielInstellenBack'),
  profielTitel: document.getElementById('profielInstellenTitel'),
  profielSub: document.getElementById('profielInstellenSub'),
  profielLaden: document.getElementById('profielInstellenLaden'),
  profielLaadFout: document.getElementById('profielInstellenLaadFout'),
  profielOpnieuw: document.getElementById('profielInstellenOpnieuw'),
  profielForm: document.getElementById('profielForm'),
  profielGebruikersnaam: document.getElementById('profielGebruikersnaam'),
  profielGebruikersnaamUitleg: document.getElementById('profielGebruikersnaamUitleg'),
  profielGebruikersnaamFout: document.getElementById('profielGebruikersnaamFout'),
  profielNaam: document.getElementById('profielNaam'),
  profielNaamFout: document.getElementById('profielNaamFout'),
  profielStatus: document.getElementById('profielStatus'),
  profielOpslaan: document.getElementById('profielOpslaan'),
  profielLater: document.getElementById('profielLater'),
  // Vrienden (stap 2). Kan ontbreken bij een oudere index.html.
  profielTegels: document.getElementById('profielTegels'),
  vriendenBack: document.getElementById('vriendenBack'),
  vriendToevoegen: document.getElementById('vriendToevoegen'),
  vriendZoekForm: document.getElementById('vriendZoekForm'),
  vriendZoekInput: document.getElementById('vriendZoekInput'),
  vriendZoekResultaat: document.getElementById('vriendZoekResultaat'),
  vriendenInhoud: document.getElementById('vriendenInhoud'),
  vriendLinkBlok: document.getElementById('vriendLinkBlok'),
  vriendLinkMaak: document.getElementById('vriendLinkMaak'),
  vriendLinkResultaat: document.getElementById('vriendLinkResultaat'),
  vriendLinkLijst: document.getElementById('vriendLinkLijst'),
  vriendLinkBack: document.getElementById('vriendLinkBack'),
  vriendLinkInhoud: document.getElementById('vriendLinkInhoud'),
  delenBack: document.getElementById('delenBack'),
  delenInhoud: document.getElementById('delenInhoud'),
  vriendBack: document.getElementById('vriendBack'),
  vriendTitel: document.getElementById('vriendTitel'),
  vriendSub: document.getElementById('vriendSub'),
  vriendInhoud: document.getElementById('vriendInhoud'),
  vriendItemBack: document.getElementById('vriendItemBack'),
  vriendItemGenre: document.getElementById('vriendItemGenre'),
  vriendItemTitel: document.getElementById('vriendItemTitel'),
  vriendItemMaker: document.getElementById('vriendItemMaker'),
  vriendItemOordeel: document.getElementById('vriendItemOordeel'),
  // Gedeelde plannen (stap 4). Kan ontbreken bij een oudere index.html.
  detailPlanSamen: document.getElementById('detailPlanSamen'),
  uitnodigenBack: document.getElementById('uitnodigenBack'),
  uitnodigenSub: document.getElementById('uitnodigenSub'),
  uitnodigenInhoud: document.getElementById('uitnodigenInhoud'),
  berichtenBack: document.getElementById('berichtenBack'),
  mailBack: document.getElementById('mailBack'),
  mailInhoud: document.getElementById('mailInhoud'),
  berichtenInhoud: document.getElementById('berichtenInhoud'),
  profielBadge: document.getElementById('profielBadge'),
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

// Hoogtes van de vaste agendakop en de onderste navigatie als CSS-variabelen,
// voor de sticky filtersidebar op desktop (styles.css: .filter-sidebar). Met
// een ResizeObserver, zodat het klopt als het lettertype laadt of de kop
// verandert (zoekveld open).
volgHoogtes();
function volgHoogtes() {
  const kop = document.querySelector('#screen-agenda .app-header');
  const nav = els.bottomNav;
  if (!kop || !nav || typeof ResizeObserver === 'undefined') return;
  const zet = () => {
    if (kop.offsetHeight) document.documentElement.style.setProperty('--agenda-kop', `${kop.offsetHeight}px`);
    if (nav.offsetHeight) document.documentElement.style.setProperty('--nav-hoogte', `${nav.offsetHeight}px`);
  };
  const obs = new ResizeObserver(zet);
  obs.observe(kop);
  obs.observe(nav);
  zet();
}

async function init() {
  // De navigatie als allereerste koppelen: gaat verderop iets mis (bv. een
  // element dat in een nieuwere index.html niet meer bestaat, terwijl de
  // browser nog een oudere app.js heeft — 30 sep 2026 werkten Theaters en
  // Profiel daardoor niet), dan blijven de tabs het toch doen.
  els.bottomNav.addEventListener('click', (e) => {
    const btn = e.target.closest('.nav-item');
    if (!btn) return;
    if (btn.dataset.tab === 'agenda') navigate('#/');
    if (btn.dataset.tab === 'theaters') navigate('#/theaters');
    if (btn.dataset.tab === 'profiel') navigate('#/profiel');
  });
  // Terug (knop in de app, browser, vegen): popstate; hashchange voor een
  // met de hand getypte link. Zie navigate() en terug().
  window.addEventListener('popstate', naGeschiedenis);
  window.addEventListener('hashchange', naGeschiedenis);
  if (!history.state?.id) history.replaceState(navState({ diepte: 0 }), '');

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
  // zonder focus() (dat zou ongevraagd het toetsenbord openen). Op desktop
  // doet de class niets (zie zetZoekbalkOpen).
  if (state.searchQueryRaw) {
    els.searchInput.value = state.searchQueryRaw;
    els.sidebarSearchInput.value = state.searchQueryRaw;
    zetZoekbalkOpen(true);
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
  els.hideGezienToggle?.addEventListener('click', onHideGezienToggleClick);
  els.sidebarHideGezienToggle?.addEventListener('click', onHideGezienToggleClick);
  els.clearFilters.addEventListener('click', clearAllFilters);
  els.sidebarClearFilters.addEventListener('click', clearAllFilters);
  for (const id of SIDEBAR_SECTION_IDS) {
    els.sidebarAccordionHeaders[id].addEventListener('click', () => toggleSidebarSection(id));
  }

  els.detailBack.addEventListener('click', () => terug('#/'));
  els.gezienBack?.addEventListener('click', () => terug('#/profiel'));
  els.watchlistItemBack?.addEventListener('click', () => terug('#/profiel'));
  els.profielBack?.addEventListener('click', () => terug('#/profiel'));
  els.profielLater?.addEventListener('click', () => terug('#/profiel'));
  els.profielOpnieuw?.addEventListener('click', opnieuwProfielLaden);
  els.profielForm?.addEventListener('submit', onProfielOpslaan);
  els.vriendenBack?.addEventListener('click', () => terug('#/profiel'));
  els.vriendZoekForm?.addEventListener('submit', onVriendZoeken);
  els.vriendLinkMaak?.addEventListener('click', onLinkMaken);
  els.vriendLinkBack?.addEventListener('click', () => terug('#/profiel'));
  els.delenBack?.addEventListener('click', () => terug('#/profiel'));
  els.vriendBack?.addEventListener('click', () => terug('#/vrienden'));
  els.vriendItemBack?.addEventListener('click', () => terug(vriendItemTerug));
  els.uitnodigenBack?.addEventListener('click', () => terug('#/profiel'));
  els.berichtenBack?.addEventListener('click', () => terug('#/profiel'));
  els.mailBack?.addEventListener('click', () => terug('#/profiel'));
  if (els.profielGebruikersnaamUitleg) els.profielGebruikersnaamUitleg.textContent = GEBRUIKERSNAAM_UITLEG;
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

// Navigatie met eigen geschiedenis (1 okt 2026): elke stap is een
// history-entry met een diepte en, bij vertrek, de scrollpositie. Terug (in
// de app, browser of vegen) gaat naar waar je vandaan kwam, op dezelfde
// plek: Profiel, Theaters, Agenda of het vorige detailscherm. Een directe
// link (diepte 0) gaat met de terugknop naar de Agenda. Een andere datum
// van dezelfde voorstelling is geen stap (vervang, zie datumChip).
let navTeller = 0;
function navState(extra = {}) {
  return { id: `${Date.now()}-${++navTeller}`, ...extra };
}

function navigate(hash) {
  if (location.hash === hash || (hash === '#/' && !location.hash)) {
    route();
    return;
  }
  history.replaceState({ ...(history.state ?? {}), scroll: window.scrollY }, '');
  history.pushState(navState({ diepte: (history.state?.diepte ?? 0) + 1 }), '', hash);
  route();
}

// Huidige entry vervangen (doorverwijzing binnen route), met behoud van diepte.
function vervang(hash) {
  history.replaceState({ ...(history.state ?? {}), id: navState().id, scroll: undefined }, '', hash);
  route();
}

function terug(zonderGeschiedenis = '#/') {
  if ((history.state?.diepte ?? 0) > 0) {
    history.back();
    return;
  }
  history.replaceState(navState({ diepte: 0 }), '', zonderGeschiedenis);
  route();
}

let laatsteRoute = null;
function naGeschiedenis() {
  if (`${location.hash}|${history.state?.id ?? ''}` === laatsteRoute) return;
  route();
}

function route() {
  laatsteRoute = `${location.hash}|${history.state?.id ?? ''}`;
  // Een open bevestiging (gedeeld plan) hoort bij het vorige scherm.
  planBevestig = null;
  const hash = location.hash || '#/';
  closeSheet();
  routeNaar(hash);
  // Terug naar een eerder bezochte entry: dezelfde scrollpositie (één keer;
  // een latere herberekening op dezelfde plek springt niet opnieuw).
  const y = history.state?.scroll;
  window.scrollTo(0, typeof y === 'number' ? y : 0);
  if (typeof y === 'number') history.replaceState({ ...history.state, scroll: undefined }, '');
}

function routeNaar(hash) {
  if (hash.startsWith('#/show/')) {
    const id = decodeURIComponent(hash.slice('#/show/'.length));
    const show = state.shows.find((s) => s.id === id);
    if (show) {
      showScreen('detail');
      renderDetail(show);
      // Een gedeeld plan vers laden: anderen kunnen intussen gereageerd hebben.
      const plan = planVoor(show);
      if (plan?.item.planId && magVrienden()) laadPlanInfo(plan.item.planId, { opnieuw: true }).then(() => naPlanLaden());
      return;
    }
    // Onbekend id (bv. verouderde link) -> terug naar de agenda i.p.v. een lege pagina.
    vervang('#/');
    return;
  }

  // Een gezien voorstelling: staat hij nog in de agenda, dan het gewone
  // detailscherm (met het blok Gezien); anders een eenvoudig scherm uit de
  // bewaarde gegevens.
  if (hash.startsWith('#/gezien/')) {
    const sleutel = decodeURIComponent(hash.slice('#/gezien/'.length));
    const item = (state.gezien?.gezien ?? []).find((i) => i.sleutel === sleutel);
    if (!item) {
      vervang('#/profiel');
      return;
    }
    const live = state.shows.filter((s) => showSleutel(s) === sleutel && s.datum >= todayIsoDate()).sort((a, b) => sortKey(a).localeCompare(sortKey(b)))[0];
    if (live) {
      vervang(`#/show/${encodeURIComponent(live.id)}`);
      return;
    }
    if (!els.screens.gezien) {
      vervang('#/profiel');
      return;
    }
    showScreen('gezien');
    renderGezienDetail(item);
    return;
  }

  // Een watchlist-item: staat het (weer) in de agenda, dan het gewone
  // detailscherm; anders een eenvoudig scherm met de bladwijzer om het weg
  // te halen (ook als het al van de watchlist af is: dan weer toe te voegen).
  if (hash.startsWith('#/watchlist/')) {
    const sleutel = decodeURIComponent(hash.slice('#/watchlist/'.length));
    const item = (state.watchlist?.watchlist ?? []).find((i) => i.sleutel === sleutel) ?? (watchlistSchermItem?.sleutel === sleutel ? watchlistSchermItem : null);
    if (!item || !els.screens.watchlist) {
      vervang('#/profiel');
      return;
    }
    const stand = watchlistStand(state.shows.filter((s) => showSleutel(s) === sleutel), todayIsoDate());
    if (stand.eerste) {
      vervang(`#/show/${encodeURIComponent(stand.eerste.id)}`);
      return;
    }
    showScreen('watchlist');
    renderWatchlistScherm(item);
    return;
  }

  if (hash === '#/theaters') {
    showScreen('theaters');
    renderTheatersScreen();
    return;
  }

  // #/favorieten was tot 28 sep 2026 de tab met favorieten (oude links/bladwijzers).
  if (hash === '#/favorieten') {
    vervang('#/profiel');
    return;
  }

  // Gebruikersnaam en naam kiezen of wijzigen; alleen ingelogd.
  if (hash === '#/profiel/instellen') {
    if (!els.screens.profielInstellen || (state.authBekend && !state.user)) {
      vervang('#/profiel');
      return;
    }
    showScreen('profielInstellen');
    profielFormulierGevuld = false;
    renderProfielInstellen();
    return;
  }

  // Profiel van een vriend, en een voorstelling daaruit die niet in de agenda staat.
  if (hash.startsWith('#/vriend/')) {
    let delen;
    try {
      delen = hash.slice('#/vriend/'.length).split('/').map(decodeURIComponent);
    } catch {
      // Kapotte link (bv. een losse %): naar Vrienden in plaats van een fout.
      vervang('#/vrienden');
      return;
    }
    const [uid, soort, onderdeel, sleutel] = delen;
    if (!els.screens.vriend || (state.authBekend && !state.user)) {
      vervang('#/profiel');
      return;
    }
    if (soort === 'titel') {
      const item = vriendProfielCache.get(uid)?.data?.[onderdeel]?.find((i) => i.sleutel === sleutel);
      if (!item || !els.screens.vriendItem) {
        vervang(`#/vriend/${encodeURIComponent(uid)}`);
        return;
      }
      showScreen('vriendItem');
      renderVriendItem(vriendProfielCache.get(uid).data, onderdeel, item);
      return;
    }
    showScreen('vriend');
    laadVriendProfiel(uid);
    return;
  }

  // Ook uitgelogd: de link in elke mail komt hier ("eerst inloggen").
  if (hash === '#/profiel/mail') {
    if (!els.screens.mail) {
      vervang('#/profiel');
      return;
    }
    showScreen('mail');
    mailMelding = null;
    laadMail();
    return;
  }

  if (hash === '#/berichten') {
    if (!els.screens.berichten || (state.authBekend && !state.user)) {
      vervang('#/profiel');
      return;
    }
    showScreen('berichten');
    openBerichten();
    return;
  }

  // Vrienden uitnodigen voor een eigen geplande voorstelling.
  if (hash.startsWith('#/uitnodigen/')) {
    let sleutel;
    try {
      sleutel = decodeURIComponent(hash.slice('#/uitnodigen/'.length));
    } catch {
      vervang('#/profiel');
      return;
    }
    if (!els.screens.uitnodigen || (state.authBekend && !state.user)) {
      vervang('#/profiel');
      return;
    }
    showScreen('uitnodigen');
    openUitnodigen(sleutel);
    return;
  }

  if (hash === '#/profiel/delen') {
    if (!els.screens.delen || (state.authBekend && !state.user)) {
      vervang('#/profiel');
      return;
    }
    showScreen('delen');
    delenKeuze = null;
    delenMelding = null;
    renderDelenScherm();
    return;
  }

  // Een uitnodigingslink: ook uitgelogd (dan eerst inloggen).
  if (hash.startsWith('#/vriend-link/')) {
    if (!els.screens.vriendLink) {
      vervang('#/');
      return;
    }
    const token = decodeURIComponent(hash.slice('#/vriend-link/'.length));
    showScreen('vriendLink');
    if (state.vriendLink?.token !== token || !['bezig', 'gelukt'].includes(state.vriendLink.status)) {
      state.vriendLink = { token, status: 'leeg', uitkomst: null };
    }
    laadVriendLink();
    return;
  }

  if (hash === '#/vrienden') {
    if (!els.screens.vrienden || (state.authBekend && !state.user)) {
      vervang('#/profiel');
      return;
    }
    showScreen('vrienden');
    vriendMenu = null;
    vriendenMelding = null;
    // Een vriendenprofiel wordt vers geladen als je het vanuit de lijst
    // opent; terug van een detailscherm naar het profiel gebruikt de
    // geladen versie (zelfde scrollpositie).
    vriendProfielCache.clear();
    zetZoekResultaat(null);
    zetLinkResultaat(null);
    laadVrienden();
    return;
  }

  if (hash === '#/profiel') {
    showScreen('profiel');
    renderProfielScreen();
    vraagProfielEenmalig();
    vernieuwVriendenTeller();
    // Elke keer vers: reacties van anderen ("kan niet", kaarten) zie je dan
    // als je terugkomt op Profiel.
    laadEigenPlannen({ opnieuw: true });
    return;
  }

  showScreen('agenda');
}

function showScreen(name) {
  for (const [key, el] of Object.entries(els.screens)) {
    if (el) el.hidden = key !== name;
  }
  els.bottomNav.hidden = ['detail', 'gezien', 'watchlist', 'profielInstellen', 'vrienden', 'vriendLink', 'delen', 'vriend', 'vriendItem', 'uitnodigen', 'berichten', 'mail'].includes(name);
  for (const btn of els.bottomNav.querySelectorAll('.nav-item')) {
    btn.classList.toggle('is-active', btn.dataset.tab === name);
  }
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
    hideGezien: stored.hideGezien === true,
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
      hideGezien: state.hideGezien,
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
  // Watchlist- en Gezien-items zonder maker of genre aanvullen uit de agenda (nooit overschrijven).
  const info = infoPerSleutel(state.shows);
  // Samengevoegde producties (titelBron → titel): oude sleutels gaan mee.
  const samenvoeging = samenvoegMapping(state.shows);
  const lokaal = laadWatchlist({ opgeslagen: loadWatchlistLocal(), favorieten: [...loadFavorites()], bekend, info, samenvoeging });
  if (lokaal.gewijzigd) saveWatchlistLocal(lokaal.profiel);
  const showIndex = indexeerShows(state.shows);
  const lokaalGepland = laadGepland({ opgeslagen: loadGeplandLocal(), index: showIndex });
  if (lokaalGepland.gewijzigd) saveGeplandLocal(lokaalGepland.profiel);

  const lokaalGezien = laadGezien({ opgeslagen: loadGezienLocal(), info, bekend, samenvoeging });
  if (lokaalGezien.gewijzigd) saveGezienLocal(lokaalGezien.profiel);

  if (!state.user) {
    state.watchlist = lokaal.profiel;
    state.gepland = lokaalGepland.profiel;
    state.gezien = lokaalGezien.profiel;
    logOudeSlugs(lokaal);
    verwerkPlannen(showIndex);
    return;
  }
  if (!state.cloudWatchlist || !state.cloudGepland || !state.cloudGezien) return;
  const ref = userDocRef(state.user.uid);

  const cloud = laadWatchlist({
    opgeslagen: state.cloudWatchlist,
    favorieten: [...state.favorites],
    extra: lokaal.profiel,
    bekend,
    info,
    samenvoeging,
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

  const cloudGezien = laadGezien({ opgeslagen: state.cloudGezien, extra: lokaalGezien.profiel, info, bekend, samenvoeging });
  state.gezien = cloudGezien.profiel;
  if (cloudGezien.gewijzigd) {
    state.cloudGezien = cloudGezien.profiel;
    setDoc(ref, cloudGezien.profiel, { merge: true }).catch((err) => console.error('Kon Gezien niet synchroniseren:', err));
  }
  verwerkPlannen(showIndex);
  planKopie();
}

// Voorbije plannen verwerken (zie gezien.js): na de speeldag naar Gezien,
// afgelast of verplaatst → weg. Na elke laadronde; idempotent, dus twee keer (of op twee apparaten)
// kan geen kwaad. Zonder melding: dit gebeurt vanzelf.
function verwerkPlannen(showIndex = indexeerShows(state.shows)) {
  const r = verwerkVoorbijePlannen(
    { gepland: state.gepland, gezien: state.gezien, watchlist: state.watchlist },
    { index: showIndex }
  );
  if (!r.gewijzigd) return;
  const watchlistAnders = r.watchlist !== state.watchlist;
  const gezienAnders = r.gezien !== state.gezien;
  state.gepland = r.gepland;
  state.gezien = r.gezien;
  state.watchlist = r.watchlist;
  saveGepland();
  if (gezienAnders) saveGezien();
  if (watchlistAnders) saveWatchlist();
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
    : voegToe(state.watchlist, watchlistGegevens(show));
  saveWatchlist();
  renderWatchButtons(show);
  renderAgenda();
}

// Wat een nieuw watchlist-item onthoudt (maker en genre voor het eenvoudige scherm).
function watchlistGegevens(show) {
  return { titel: show.titel, theaterId: show.theaterId, maker: show.maker ?? null, genre: show.genre ?? null };
}

// Van de watchlist halen vanuit Profiel of het eenvoudige scherm, met
// "Ongedaan maken". Via verwijder() (tombstone) en saveWatchlist(): dat
// synchroniseert met Firestore en werkt de kopie voor vrienden bij.
// `item` mag ook een lijst zijn: een regel met meerdere items (groepeerWatchlist).
function haalVanWatchlist(item, naAfloop = () => {}) {
  const items = Array.isArray(item) ? item : [item];
  for (const i of items) state.watchlist = verwijder(state.watchlist, i.sleutel);
  saveWatchlist();
  toonMelding('Van je watchlist gehaald', () => {
    // Samen terug, met één tijdstip: dan blijven ze ook samen op één regel.
    const nu = Date.now();
    for (const i of items) state.watchlist = voegToe(state.watchlist, { titel: i.titel, theaterId: i.theaterId, maker: i.maker ?? null, genre: i.genre ?? null }, nu);
    saveWatchlist();
    renderAgenda();
    naAfloop();
  });
  renderAgenda();
  naAfloop();
}

function saveWatchlist() {
  // Ingelogd maar het Firestore-document nog niet binnen: lokaal bewaren;
  // syncProfielForCurrentUser() voegt het straks samen met de cloud.
  if (state.user && state.cloudWatchlist) {
    state.cloudWatchlist = state.watchlist;
    planKopie();
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

// ---------- Gezien (zie gezien.js) ----------

function loadGezienLocal() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEYS.gezien)) ?? legeGezien();
  } catch {
    return legeGezien();
  }
}

function saveGezienLocal(profiel) {
  localStorage.setItem(STORAGE_KEYS.gezien, JSON.stringify(profiel));
}

function saveGezien() {
  if (state.user && state.cloudGezien) {
    state.cloudGezien = state.gezien;
    planKopie();
    setDoc(userDocRef(state.user.uid), state.gezien, { merge: true }).catch((err) =>
      console.error('Kon Gezien niet synchroniseren:', err)
    );
    return;
  }
  saveGezienLocal(state.gezien);
}

let gezienSleutelsVoor = null;
let gezienSleutelsCache = new Set();
function gezienSleutels() {
  if (gezienSleutelsVoor !== state.gezien) {
    gezienSleutelsVoor = state.gezien;
    gezienSleutelsCache = gezienSleutelsVan(state.gezien);
  }
  return gezienSleutelsCache;
}

function isGezien(show) {
  return gezienSleutels().has(showSleutel(show));
}

// Weergavenaam van een theater, nooit het id: config (theaters.json), dan
// de agenda; onbekend → null.
function theaterNaamVan(id) {
  return state.theaterInfo[id]?.naam ?? state.shows.find((s) => s.theaterId === id)?.theaterNaam ?? null;
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

/** "Gezien" in een agendaregel: de sleutel staat op Gezien. */
function makeGezienTag(show) {
  const tag = document.createElement('span');
  tag.className = 'status-badge status-badge--gezien';
  const cijfer = beoordelingTekst(gezienItemVan(show)?.beoordeling);
  tag.textContent = cijfer ? `Gezien · ★ ${cijfer}` : 'Gezien';
  return tag;
}

function gezienItemVan(show) {
  const k = showSleutel(show);
  return (state.gezien?.gezien ?? []).find((i) => i.sleutel === k) ?? null;
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
  // Een afgelaste voorstelling plan je niet meer; een bestaand plan blijft.
  els.detailPlanBtn.hidden = Boolean(plan) || isVervallen(show);
  els.detailPlanBar.hidden = !plan;
  els.detailPlanBtn.onclick = () => wijzigPlanning(planIn(state.gepland, show), show);
  if (!plan) {
    if (els.detailPlanSamen) els.detailPlanSamen.hidden = true;
    return;
  }

  const { item, soort } = plan;
  if (item.planId && !planCache.has(item.planId)) laadPlanInfo(item.planId).then(() => naPlanLaden());
  els.detailStatusGepland.setAttribute('aria-pressed', String(item.status === 'gepland'));
  els.detailStatusKaarten.setAttribute('aria-pressed', String(item.status === 'kaarten'));
  els.detailStatusGepland.onclick = () => {
    wijzigPlanning(zetStatus(state.gepland, item.sleutel, 'gepland'), show);
    deelKaarten(item, false);
  };
  els.detailStatusKaarten.onclick = () => {
    wijzigPlanning(zetStatus(state.gepland, item.sleutel, 'kaarten'), show);
    deelKaarten(item, true);
  };
  // Bij een gedeeld plan: een gast meldt zich af, de organisator heft op.
  // Bij een gedeeld plan eerst een bevestiging (zie bevestigPlan).
  els.detailUnplan.onclick = () => {
    if (gedeeldPlan(item)) {
      vraagPlanBevestiging(item, 'uit');
      return;
    }
    wijzigPlanning(haalUitPlanning(state.gepland, item.sleutel), show);
  };
  renderPlanSamen(item);

  const wijziging = isVervallen(show)
    ? `Deze voorstelling is ${show.beschikbaarheid}. Je plan blijft staan tot je het zelf uit je planning haalt.`
    : soort === 'tijd'
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

// ---------- Gezien in Profiel ----------

// Nieuwe stand (planning, Gezien, watchlist) overnemen en alleen bewaren
// wat veranderd is.
function pasStandToe(r) {
  if (r.gepland !== state.gepland) {
    state.gepland = r.gepland;
    saveGepland();
  }
  if (r.gezien && r.gezien !== state.gezien) {
    state.gezien = r.gezien;
    saveGezien();
  }
  if (r.watchlist && r.watchlist !== state.watchlist) {
    state.watchlist = r.watchlist;
    saveWatchlist();
  }
}

function huidigeStand() {
  return { gepland: state.gepland, gezien: state.gezien, watchlist: state.watchlist };
}

// "zaterdag 26 september 2026": altijd met het jaartal.
function formatDatumVolledig(isoDate) {
  const { year, month, day } = parseIsoDate(isoDate);
  return `${WEEKDAYS_LONG[dateFromIso(isoDate).getDay()]} ${day} ${MONTHS_LONG[month - 1]} ${year}`;
}

// Eén bezoek als regel: "zaterdag 26 september 2026 · 20:15 · DeLaMar,
// Amsterdam · Theater De Garage". Theaternaam en stad live via theaterId
// (config/agenda); alleen als het theater er niet meer is de bewaarde naam.
function bezoekDelen(b) {
  const naam = theaterNaamVan(b.theaterId) ?? b.theaterNaam ?? null;
  const stad = state.theaterInfo[b.theaterId]?.stad ?? b.stad ?? null;
  const plek = b.locatie ? b.locatie.split('|')[0].trim() : b.zaal ?? null;
  return { voor: [formatDatumVolledig(b.datum), b.tijd].filter(Boolean), theater: [naam, stad].filter(Boolean).join(', ') || null, na: plek };
}

function bezoekRegel(b) {
  const { voor, theater, na } = bezoekDelen(b);
  return [...voor, theater, na].filter(Boolean).join(' · ');
}

// Alle bezoeken van een Gezien-item als <li>'s, nieuwste eerst; zonder
// bezoek: "Zelf als gezien aangevinkt op …".
function vulBezoekLijst(ul, item, { podiumpas = false } = {}) {
  ul.replaceChildren();
  const bezoeken = [...(item.bezoeken ?? [])].sort((a, b) => `${b.datum} ${b.tijd ?? ''}`.localeCompare(`${a.datum} ${a.tijd ?? ''}`));
  if (bezoeken.length === 0) {
    const li = document.createElement('li');
    li.className = 'bezoek bezoek--zelf';
    const d = new Date(item.toegevoegdOp ?? Date.now());
    li.textContent = `Zelf als gezien aangevinkt op ${d.getDate()} ${MONTHS_LONG[d.getMonth()]} ${d.getFullYear()}`;
    ul.appendChild(li);
    return;
  }
  for (const b of bezoeken) {
    const li = document.createElement('li');
    li.className = 'bezoek';
    // Detailschermen: vinkje direct achter de theaternaam als het bewaarde
    // bezoek Podiumpas had.
    if (podiumpas && b.podiumpas === true) {
      const { voor, theater, na } = bezoekDelen(b);
      li.classList.add('bezoek--podiumpas');
      li.append([...voor, theater].filter(Boolean).join(' · '), makePodiumpasIcon(), na ? ` · ${na}` : '');
    } else {
      li.textContent = bezoekRegel(b);
    }
    // Met wie je ging (gedeeld plan; alleen voor jezelf, niet voor vrienden).
    if (Array.isArray(b.metWie) && b.metWie.length) li.append(` · met ${b.metWie.join(', ')}`);
    ul.appendChild(li);
  }
}

// Genre van een Gezien-item: live, anders van het nieuwste bezoek dat het weet.
function gezienGenre(item, liveShow) {
  if (liveShow) return getGenreBucket(liveShow);
  return gezienVeld(item, 'genre');
}

// Eerste voorstelling per sleutel in de agenda (voor de live weergavetitel).
function showsPerSleutel() {
  const map = new Map();
  for (const s of state.shows) {
    const k = showSleutel(s);
    if (!map.has(k)) map.set(k, s);
  }
  return map;
}

// "Sorteer op beoordeling": per apparaat onthouden (localStorage).
let gezienOpBeoordeling = (() => {
  try {
    return localStorage.getItem('podiumagenda:gezienSortering') === 'beoordeling';
  } catch {
    return false;
  }
})();

function sorteerGezienLijst(items) {
  const opBezoek = sorteerGezien(items);
  if (!gezienOpBeoordeling) return opBezoek;
  // Hoogste beoordeling eerst; gelijk of zonder beoordeling: op laatste bezoek.
  return opBezoek
    .map((item, i) => ({ item, i }))
    .sort((a, b) => (b.item.beoordeling ?? 0) - (a.item.beoordeling ?? 0) || a.i - b.i)
    .map((x) => x.item);
}

function renderGezienSorteerknop(items) {
  const kop = els.gezienList?.closest('section')?.querySelector('.section-head');
  if (!kop) return;
  let knop = kop.querySelector('.gezien-sorteer');
  if (!knop) {
    knop = document.createElement('button');
    knop.type = 'button';
    knop.className = 'link-btn gezien-sorteer';
    knop.addEventListener('click', () => {
      gezienOpBeoordeling = !gezienOpBeoordeling;
      try {
        localStorage.setItem('podiumagenda:gezienSortering', gezienOpBeoordeling ? 'beoordeling' : 'bezoek');
      } catch {
        // geen opslag: alleen voor deze keer
      }
      renderGezienList();
    });
    kop.appendChild(knop);
  }
  knop.textContent = gezienOpBeoordeling ? 'Sorteer op laatste bezoek' : 'Sorteer op beoordeling';
  knop.setAttribute('aria-pressed', String(gezienOpBeoordeling));
  knop.hidden = !items.some((i) => i.beoordeling);
}

function renderGezienList() {
  if (!els.gezienList) return;
  const items = sorteerGezienLijst(state.gezien?.gezien ?? []);
  renderGezienSorteerknop(items);
  if (els.gezienCount) els.gezienCount.textContent = items.length ? `${items.length} voorstelling${items.length === 1 ? '' : 'en'}` : '';
  if (els.gezienEmpty) els.gezienEmpty.hidden = items.length > 0;
  els.gezienList.innerHTML = '';
  const live = showsPerSleutel();
  for (const item of items) els.gezienList.appendChild(renderGezienRow(item, live.get(item.sleutel)));
}

// Sterren met het cijfer ernaast ("★ 4,5") en een kleine wis-link, voor één
// Gezien-item. Werkt zichzelf bij (zonder de lijst opnieuw te tekenen, zodat
// de focus blijft); `naWijziging` voor wat de plek verder nog wil.
function maakBeoordeling(sleutel, { label, naWijziging = () => {} } = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'beoordeling';
  const huidig = () => (state.gezien?.gezien ?? []).find((i) => i.sleutel === sleutel)?.beoordeling ?? null;
  const cijfer = document.createElement('span');
  cijfer.className = 'beoordeling-cijfer';
  const wis = document.createElement('button');
  wis.type = 'button';
  wis.className = 'link-btn';
  wis.textContent = 'Wis beoordeling';
  const bij = () => {
    const w = huidig();
    cijfer.textContent = w ? `★ ${beoordelingTekst(w)}` : '';
    cijfer.hidden = !w;
    wis.hidden = !w;
  };
  const opslaan = (w) => {
    state.gezien = zetBeoordeling(state.gezien, sleutel, w);
    saveGezien();
    bij();
    toonMelding(w ? 'Opgeslagen' : 'Beoordeling gewist');
    renderAgenda();
    naWijziging(w);
  };
  const sterren = maakSterren({ waarde: huidig(), label: label ?? 'Beoordeling', onWijzig: opslaan });
  wis.addEventListener('click', (e) => {
    e.stopPropagation();
    sterren.zetWaarde(null);
    opslaan(null);
  });
  wrap.append(sterren, cijfer, wis);
  bij();
  return wrap;
}

function renderGezienRow(item, liveShow) {
  const row = document.createElement('div');
  row.className = 'gezien-row';

  // Het item opent het detailscherm (titel is de knop, de rest van het vlak
  // ook); de sterren en "Weghalen" niet.
  const open = () => navigate(`#/gezien/${encodeURIComponent(item.sleutel)}`);
  const info = document.createElement('div');
  info.className = 'plan-info gezien-info';
  info.addEventListener('click', (e) => {
    if (!e.target.closest('.beoordeling, button')) open();
  });
  const title = document.createElement('button');
  title.type = 'button';
  title.className = 'plan-title gezien-titel';
  // Live weergavetitel als de voorstelling nog in de agenda staat.
  title.textContent = liveShow ? weergaveTitel(liveShow) : item.titel;
  title.addEventListener('click', open);
  info.appendChild(title);
  const genre = gezienGenre(item, liveShow);
  if (genre) {
    const g = document.createElement('span');
    g.className = 'show-genre-tag';
    g.textContent = genre;
    info.appendChild(g);
  }
  info.appendChild(
    maakBeoordeling(item.sleutel, {
      label: `Beoordeling van ${title.textContent}`,
      // Alleen de sorteerknop bijwerken (de lijst niet: dan blijft de focus).
      naWijziging: () => renderGezienSorteerknop(state.gezien?.gezien ?? []),
    })
  );
  const lijst = document.createElement('ul');
  lijst.className = 'bezoek-lijst bezoek-lijst--compact';
  vulBezoekLijst(lijst, item);
  info.appendChild(lijst);

  const weg = document.createElement('button');
  weg.type = 'button';
  weg.className = 'link-btn gezien-weg';
  weg.textContent = 'Weghalen';
  weg.setAttribute('aria-label', `${title.textContent} van Gezien halen`);
  weg.addEventListener('click', () => {
    state.gezien = haalUitGezien(state.gezien, item.sleutel);
    saveGezien();
    renderGezienList();
    renderAgenda();
  });

  row.append(info, weg);
  return row;
}

// Detailscherm voor een gezien voorstelling die niet meer in de agenda staat:
// titel, maker, genre, de bezoeken en de link; geen reserveren of plannen.
function renderGezienDetail(item) {
  if (els.gezienTitel) els.gezienTitel.textContent = item.titel;
  const maker = gezienVeld(item, 'maker');
  if (els.gezienMaker) {
    els.gezienMaker.textContent = maker ?? '';
    els.gezienMaker.hidden = !maker || makerStaatInTitel(item.titel, maker);
  }
  if (els.gezienGenre) els.gezienGenre.textContent = gezienGenre(item, null) ?? '';
  if (els.gezienBezoeken) {
    vulBezoekLijst(els.gezienBezoeken, item, { podiumpas: true });
    plaatsBeoordeling(els.gezienBezoeken, item.sleutel);
  }
  const url = gezienVeld(item, 'url');
  if (els.gezienLink) {
    els.gezienLink.hidden = !url;
    if (url) els.gezienLink.href = url;
  }
}

// Blok "Gezien" bovenaan het gewone detailscherm.
function renderDetailGezien(show) {
  if (!els.detailGezienBlok || !els.detailGezienBezoeken) return;
  const item = (state.gezien?.gezien ?? []).find((i) => i.sleutel === showSleutel(show));
  els.detailGezienBlok.hidden = !item;
  if (item) {
    vulBezoekLijst(els.detailGezienBezoeken, item, { podiumpas: true });
    plaatsBeoordeling(els.detailGezienBezoeken, item.sleutel);
  }
}

// De sterren in een Gezien-blok, direct boven de bezoeklijst (vervangt een vorige).
function plaatsBeoordeling(lijst, sleutel) {
  lijst.parentElement?.querySelector(':scope > .beoordeling')?.remove();
  lijst.before(maakBeoordeling(sleutel, { label: 'Jouw beoordeling' }));
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
  const vervallen = isVervallen(show);
  row.className = 'plan-row' + (soort === 'weg' ? ' plan-row--weg' : '') + (vervallen ? ' plan-row--vervallen' : '');

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
  // De actuele weergave van de gekoppelde voorstelling; anders de titel uit
  // de momentopname.
  title.textContent = show ? weergaveTitel(show) : item.titel;
  const meta = document.createElement('span');
  meta.className = 'plan-meta';
  const tijd = show?.tijd ?? item.tijd;
  const theaterNaam = planTheaterNaam(item);
  meta.textContent = tijd ? `${theaterNaam} · ${tijd}` : theaterNaam;
  info.append(title, meta);
  // Afgelast/verplaatst: duidelijk bovenaan, ook bij "Kaarten ✓".
  if (vervallen) info.prepend(makeStatusBadge(show.beschikbaarheid));
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
    deelKaarten(item, volgende === 'kaarten');
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
  // Geen .ics voor een voorstelling die niet doorgaat.
  actions.append(...(vervallen ? [status] : [status, ics]));

  row.append(when, info, actions);
  const samen = planSamenRij(item);
  if (samen) row.appendChild(samen);
  return row;
}

// ---------- Inloggen (optioneel) ----------

function userDocRef(uid) {
  return doc(db, 'users', uid);
}

async function handleAuthChange(user) {
  state.user = user;
  state.authBekend = true;
  state.authError = null;
  state.cloudWatchlist = null;
  state.cloudGepland = null;
  state.cloudGezien = null;
  state.profiel = undefined;
  state.profielFout = false;
  state.profielGevraagd = false;
  state.vrienden = null;
  state.vriendenStatus = 'leeg';
  state.inkomendAantal = null;
  if (state.vriendLink) state.vriendLink = { token: state.vriendLink.token, status: 'leeg', uitkomst: null };
  state.delen = undefined;
  state.delenFout = false;
  vriendProfielCache.clear();
  planCache.clear();
  naamCache.clear();
  stopBerichtenTeller();
  state.mailAan = undefined;
  state.mailFout = false;
  clearTimeout(kopieTimer);
  laatsteKopie.gezien = undefined;
  laatsteKopie.watchlist = undefined;

  if (user) {
    const ref = userDocRef(user.uid);
    try {
      const snap = await getDoc(ref);
      if (snap.exists()) {
        // Bestaande cloud-data is leidend (bv. al eerder op een ander apparaat ingelogd).
        const data = snap.data();
        state.profielGevraagd = data.profielGevraagd === true;
        state.favorites = new Set(data.favorites ?? []);
        state.enabledTheaters = data.enabledTheaters ?? state.enabledTheaters;

        if (!data.favoritesMigrated) {
          state.favorites = migrateFavorites(state.favorites);
          await setDoc(ref, { favorites: [...state.favorites], favoritesMigrated: true }, { merge: true });
        }
        renameFavoritesInCloud(ref);
        state.cloudWatchlist = { watchlist: data.watchlist ?? [], watchlistVerwijderd: data.watchlistVerwijderd ?? [] };
        state.cloudGepland = { gepland: data.gepland ?? [], geplandVerwijderd: data.geplandVerwijderd ?? [] };
        state.cloudGezien = { gezien: data.gezien ?? [], gezienVerwijderd: data.gezienVerwijderd ?? [] };
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
        state.cloudGezien = legeGezien();
      }
      syncProfielForCurrentUser();
    } catch (err) {
      console.error('Kon cloudgegevens niet laden:', err);
    }
    // Los van het blok hierboven: ook als dat mislukte (offline) weten we
    // dan of het profiel er is, of tonen we een foutmelding met "Opnieuw".
    await laadEigenProfiel();
    if (state.user !== user) return;
    await laadDelen();
    if (state.user !== user) return;
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
  if (hash === '#/profiel') {
    renderProfielScreen();
    vraagProfielEenmalig();
  }
  if (hash === '#/profiel/instellen') {
    if (user) renderProfielInstellen();
    else vervang('#/profiel');
  }
  if (hash === '#/vrienden') {
    if (user) laadVrienden();
    else vervang('#/profiel');
  }
  if (hash.startsWith('#/vriend-link/')) laadVriendLink();
  if (hash === '#/profiel/delen') renderDelenScherm();
  if (hash.startsWith('#/vriend/')) routeNaar(hash);
  if (hash.startsWith('#/uitnodigen/')) routeNaar(hash);
  if (hash === '#/berichten') routeNaar(hash);
  if (hash === '#/profiel/mail') laadMail();
  vernieuwVriendenTeller();
  planKopie();
  laadEigenPlannen();
  startBerichtenTeller();
  if (hash.startsWith('#/show/')) {
    const id = decodeURIComponent(hash.slice('#/show/'.length));
    const show = state.shows.find((s) => s.id === id);
    if (show) {
      renderWatchButtons(show);
      renderPlanControls(show);
    }
  }
}

// ---------- Profiel: gebruikersnaam en naam (zie profiel.js) ----------

const firestoreFns = {
  doc,
  getDoc,
  getDocs,
  setDoc,
  deleteDoc,
  writeBatch,
  collection,
  query,
  where,
  orderBy,
  getCountFromServer,
  runTransaction,
  serverTimestamp,
};

// Opslaan wacht hooguit zo lang; daarna een melding (offline blijft een
// transactie anders lang hangen). Lukt het later alsnog, dan is de naam van
// jou en geeft opnieuw opslaan hetzelfde resultaat.
const PROFIEL_TIMEOUT_MS = 15000;

async function laadEigenProfiel() {
  const user = state.user;
  if (!user) return;
  state.profielFout = false;
  try {
    const profiel = await laadProfiel({ db, fs: firestoreFns, uid: user.uid });
    if (state.user !== user) return;
    state.profiel = profiel;
  } catch (err) {
    if (state.user !== user) return;
    console.error('Kon het profiel niet laden:', err);
    state.profiel = undefined;
    state.profielFout = true;
  }
}

async function opnieuwProfielLaden() {
  state.profielFout = false;
  renderAuthBox();
  renderProfielInstellen();
  await laadEigenProfiel();
  renderAuthBox();
  renderProfielTegels();
  profielFormulierGevuld = false;
  renderProfielInstellen();
  vernieuwVriendenTeller();
  if ((location.hash || '').startsWith('#/vriend-link/')) laadVriendLink();
  if (state.profiel && state.delen === undefined) {
    await laadDelen();
    renderProfielTegels();
    renderDelenScherm();
    planKopie();
  }
  startBerichtenTeller();
}

// Na inloggen zonder profiel één keer het scherm "Kies je gebruikersnaam",
// als je op Profiel bent (daar log je in, en daar komen bestaande gebruikers
// vanzelf langs). Daarna niet meer vanzelf: Profiel houdt een knop.
function vraagProfielEenmalig() {
  if (!state.user || state.profiel !== null || state.profielGevraagd) return;
  if ((location.hash || '#/') !== '#/profiel' || !els.screens.profielInstellen) return;
  state.profielGevraagd = true;
  setDoc(userDocRef(state.user.uid), { profielGevraagd: true }, { merge: true }).catch((err) =>
    console.error('Kon niet onthouden dat het profiel gevraagd is:', err)
  );
  navigate('#/profiel/instellen');
}

// De velden één keer vullen per bezoek aan het scherm (niet bij elke
// herberekening, anders verdwijnt wat je aan het typen bent).
let profielFormulierGevuld = false;

function renderProfielInstellen() {
  if (!els.screens.profielInstellen || els.screens.profielInstellen.hidden) return;
  const eerste = state.profiel === null;
  els.profielTitel.textContent = state.profiel ? 'Profiel wijzigen' : 'Kies je gebruikersnaam';
  els.profielSub.textContent = state.profiel
    ? 'Je gebruikersnaam en naam voor vrienden.'
    : 'Zo kunnen vrienden je straks vinden. Je kunt dit later altijd wijzigen.';
  els.profielLater.hidden = !eerste;

  const laden = !state.authBekend || (state.user && state.profiel === undefined && !state.profielFout);
  els.profielLaden.hidden = !laden;
  els.profielLaadFout.hidden = !state.profielFout;
  els.profielForm.hidden = laden || state.profielFout;
  if (els.profielForm.hidden || profielFormulierGevuld) return;

  profielFormulierGevuld = true;
  els.profielGebruikersnaam.value = state.profiel?.gebruikersnaam ?? voorstelGebruikersnaam(state.user?.displayName);
  els.profielNaam.value = state.profiel?.naam ?? state.user?.displayName ?? '';
  toonVeldFout(els.profielGebruikersnaam, els.profielGebruikersnaamFout, null);
  toonVeldFout(els.profielNaam, els.profielNaamFout, null);
  toonProfielStatus(null);
}

function toonVeldFout(input, el, tekst) {
  el.hidden = !tekst;
  el.textContent = tekst ?? '';
  if (tekst) input.setAttribute('aria-invalid', 'true');
  else input.removeAttribute('aria-invalid');
}

function toonProfielStatus(tekst) {
  els.profielStatus.hidden = !tekst;
  els.profielStatus.textContent = tekst ?? '';
}

async function onProfielOpslaan(e) {
  e.preventDefault();
  if (!state.user) return;
  const g = controleerGebruikersnaam(els.profielGebruikersnaam.value);
  const n = controleerNaam(els.profielNaam.value);
  toonVeldFout(els.profielGebruikersnaam, els.profielGebruikersnaamFout, g.ok ? null : g.fout);
  toonVeldFout(els.profielNaam, els.profielNaamFout, n.ok ? null : n.fout);
  toonProfielStatus(null);
  if (!g.ok || !n.ok) {
    (g.ok ? els.profielNaam : els.profielGebruikersnaam).focus();
    return;
  }

  const user = state.user;
  els.profielOpslaan.disabled = true;
  els.profielOpslaan.textContent = 'Opslaan…';
  try {
    const opslaan = bewaarProfiel({ db, fs: firestoreFns, uid: user.uid, gebruikersnaam: g.weergave, naam: n.naam });
    const timeout = new Promise((_, weiger) => setTimeout(() => weiger(new Error('timeout')), PROFIEL_TIMEOUT_MS));
    const profiel = await Promise.race([opslaan, timeout]);
    if (state.user !== user) return;
    state.profiel = { ...(state.profiel ?? {}), ...profiel };
    state.profielFout = false;
    renderAuthBox();
    if (state.delen === undefined) laadDelen().then(() => renderProfielTegels());
    startBerichtenTeller();
    renderProfielTegels();
    terug('#/profiel');
  } catch (err) {
    if (err instanceof ProfielFout && err.code === 'bezet') {
      toonVeldFout(els.profielGebruikersnaam, els.profielGebruikersnaamFout, err.message);
      els.profielGebruikersnaam.focus();
    } else if (err instanceof ProfielFout) {
      toonProfielStatus(err.message);
    } else {
      console.error('Profiel opslaan mislukt:', err);
      toonProfielStatus('Opslaan lukte niet. Controleer je verbinding en probeer het opnieuw.');
    }
  } finally {
    els.profielOpslaan.disabled = false;
    els.profielOpslaan.textContent = 'Opslaan';
  }
}

// Onder het inlogblok in Profiel: je gebruikersnaam met "Wijzigen", of een
// knop om er een te kiezen, of een foutmelding met "Opnieuw".
function renderProfielRegel() {
  if (!state.user || !els.screens.profielInstellen) return null;
  if (state.profiel === undefined && !state.profielFout) return null;
  const regel = document.createElement('div');
  regel.className = 'profiel-regel';
  const tekst = document.createElement('p');
  tekst.className = 'profiel-regel-tekst';
  const knop = document.createElement('button');
  knop.type = 'button';
  knop.className = 'text-btn-small';

  if (state.profielFout) {
    regel.classList.add('profiel-regel--fout');
    tekst.textContent = 'Je profiel kon niet worden geladen.';
    knop.textContent = 'Opnieuw';
    knop.addEventListener('click', opnieuwProfielLaden);
  } else if (state.profiel) {
    const naam = document.createElement('span');
    naam.className = 'profiel-regel-naam';
    naam.textContent = `@${state.profiel.gebruikersnaam}`;
    tekst.append(naam, document.createTextNode(` · ${state.profiel.naam}`));
    knop.textContent = 'Wijzigen';
    knop.setAttribute('aria-label', 'Gebruikersnaam en naam wijzigen');
    knop.addEventListener('click', () => navigate('#/profiel/instellen'));
  } else {
    tekst.textContent = 'Nog geen gebruikersnaam. Daarmee kunnen vrienden je straks vinden.';
    knop.textContent = 'Kiezen';
    knop.setAttribute('aria-label', 'Gebruikersnaam kiezen');
    knop.addEventListener('click', () => navigate('#/profiel/instellen'));
  }
  regel.append(tekst, knop);
  return regel;
}

// ---------- Gedeelde plannen (zie plannen.js) ----------

// planId → { status: 'laden'|'klaar'|'fout', info: { plan, leden } | null }.
// Geladen bij het openen van Profiel of een detailscherm (niet live).
const planCache = new Map();
// uid → '@naam' of 'iemand' (uit het actuele profiel; per sessie).
const naamCache = new Map();

async function naamVan(uid) {
  if (uid === state.user?.uid) return `@${state.profiel?.gebruikersnaam ?? ''}`;
  if (naamCache.has(uid)) return naamCache.get(uid);
  let naam = 'iemand';
  try {
    const p = await getDoc(doc(db, 'profielen', uid));
    if (p.exists()) naam = `@${p.data().gebruikersnaam}`;
  } catch {
    // Geen vriend (meer): "iemand".
  }
  naamCache.set(uid, naam);
  return naam;
}

const naamNu = (uid) => (uid === state.user?.uid ? `@${state.profiel?.gebruikersnaam ?? ''}` : naamCache.get(uid) ?? 'iemand');

async function laadPlanInfo(planId, { opnieuw = false } = {}) {
  if (!magVrienden()) return null;
  const user = state.user;
  const huidig = planCache.get(planId);
  if (huidig && !opnieuw && huidig.status !== 'fout') return huidig.info;
  planCache.set(planId, { status: 'laden', info: huidig?.info ?? null });
  try {
    const info = await laadPlan({ db, fs: firestoreFns, planId });
    if (state.user !== user) return null;
    if (info) await Promise.all(info.leden.map((l) => naamVan(l.uid)));
    planCache.set(planId, { status: 'klaar', info });
    return info;
  } catch (err) {
    if (state.user !== user) return null;
    console.error('Kon een gedeeld plan niet laden:', err);
    planCache.set(planId, { status: 'fout', info: huidig?.info ?? null });
    return null;
  }
}

// Het gedeelde plan van een eigen item: alleen als het loopt en je er nog
// bij hoort (meegaan of organisator). Anders gedraagt het item zich als een
// gewoon plan (ook na opheffen of intrekken).
function gedeeldPlan(item) {
  const info = item?.planId ? planCache.get(item.planId)?.info : null;
  if (!info || info.plan.opgeheven) return null;
  const ik = info.leden.find((l) => l.uid === state.user?.uid);
  return ik && ik.status === 'gaat' ? info : null;
}

const isOrganisator = (info) => info?.plan.eigenaar === state.user?.uid;

// Alle komende eigen plannen met een planId laden, de momentopname "met
// wie" bijwerken en opnieuw tekenen.
async function laadEigenPlannen({ opnieuw = false } = {}) {
  if (!magVrienden() || !state.gepland) return;
  const ids = [...new Set(komendePlannen(state.gepland.gepland, todayIsoDate()).map((i) => i.planId).filter(Boolean))];
  if (ids.length === 0) return;
  await Promise.all(ids.map((id) => laadPlanInfo(id, { opnieuw })));
  naPlanLaden();
}

function naPlanLaden() {
  werkMetWieBij();
  renderGeplandList();
  const hash = location.hash || '#/';
  if (hash.startsWith('#/show/')) {
    const show = state.shows.find((s) => s.id === decodeURIComponent(hash.slice('#/show/'.length)));
    if (show) renderPlanControls(show);
  }
  if (hash.startsWith('#/uitnodigen/')) renderUitnodigen();
}

// "Met wie" als momentopname op het eigen item (voor het bezoek in Gezien).
function werkMetWieBij() {
  if (!state.user || !state.gepland) return;
  let profiel = state.gepland;
  let ander = false;
  for (const item of profiel.gepland) {
    const info = gedeeldPlan(item);
    if (!info) continue;
    const r = zetMetWie(profiel, item.sleutel, metWie(info, state.user.uid, naamNu).gaan.map((g) => g.naam));
    if (r.gewijzigd) {
      profiel = r.profiel;
      ander = true;
    }
  }
  if (ander) {
    state.gepland = profiel;
    saveGepland();
  }
}

// Kaarten ook in het plan zetten (zichtbaar voor de andere leden).
function deelKaarten(item, kaarten) {
  const info = gedeeldPlan(item);
  if (!info) return;
  const lid = info.leden.find((l) => l.uid === state.user.uid);
  if (lid) lid.kaarten = kaarten;
  zetKaarten({ db, fs: firestoreFns, ik: state.user.uid, planId: item.planId, kaarten }).catch((err) =>
    console.error('Kon kaarten niet in het plan zetten:', err)
  );
}

// Uitnodigen kan tot middernacht in Amsterdam op de speeldag (niet UTC, niet
// de tijdzone van het toestel); zie isNogTePlannen in plannen.js.
const magUitnodigen = (item) =>
  magVrienden() && isNogTePlannen(item.datum) && (!gedeeldPlan(item) || isOrganisator(gedeeldPlan(item)));

// De regels "met wie" als tekst.
function metWieTekst(item) {
  const info = gedeeldPlan(item);
  if (!info) return null;
  const regels = metWieRegels(metWie(info, state.user.uid, naamNu));
  if (regels.length === 0) regels.push('Nog niemand gaat mee');
  return regels.join(' · ');
}

// Onder een Gepland-rij: met wie, en [Vrienden uitnodigen] of [Ik ga toch niet].
function planSamenRij(item) {
  if (!magVrienden() || !isNogTePlannen(item.datum)) return null;
  const info = gedeeldPlan(item);
  const tekst = metWieTekst(item);
  const rij = document.createElement('div');
  rij.className = 'plan-samen-rij';
  if (tekst) rij.appendChild(vriendenTekst('p', 'plan-samen-tekst', tekst));
  const vraag = planBevestigBlok(item);
  if (vraag) {
    rij.appendChild(vraag);
    return rij;
  }
  const acties = document.createElement('div');
  acties.className = 'plan-samen-acties';
  if (magUitnodigen(item)) {
    acties.appendChild(
      kleineKnop('Vrienden uitnodigen', {
        label: `Vrienden uitnodigen voor ${item.titel}`,
        onClick: () => navigate(`#/uitnodigen/${encodeURIComponent(item.sleutel)}`),
      })
    );
  } else if (info && !isOrganisator(info)) {
    acties.appendChild(kleineKnop('Ik ga toch niet', { label: `Ik ga toch niet naar ${item.titel}`, onClick: () => vraagPlanBevestiging(item, 'weg') }));
  }
  rij.appendChild(acties);
  return rij;
}

// In het detailscherm: met wie, uitnodigen, en weggaan of opheffen.
function renderPlanSamen(item) {
  const box = els.detailPlanSamen;
  if (!box) return;
  box.replaceChildren();
  if (!magVrienden() || !isNogTePlannen(item.datum)) {
    box.hidden = true;
    return;
  }
  box.hidden = false;
  const info = gedeeldPlan(item);
  const tekst = metWieTekst(item);
  if (tekst) box.appendChild(vriendenTekst('p', 'plan-samen-tekst', tekst));
  const vraag = planBevestigBlok(item);
  if (vraag) {
    box.appendChild(vraag);
    return;
  }
  const acties = document.createElement('div');
  acties.className = 'plan-samen-acties';
  if (magUitnodigen(item)) {
    acties.appendChild(kleineKnop('Vrienden uitnodigen', { primair: true, onClick: () => navigate(`#/uitnodigen/${encodeURIComponent(item.sleutel)}`) }));
  }
  if (info && isOrganisator(info)) acties.appendChild(kleineKnop('Plan opheffen', { onClick: () => vraagPlanBevestiging(item, 'opheffen') }));
  if (info && !isOrganisator(info)) acties.appendChild(kleineKnop('Ik ga toch niet', { onClick: () => vraagPlanBevestiging(item, 'weg') }));
  box.appendChild(acties);
}

// ---------- Bevestigen bij een gedeeld plan ----------

// { sleutel, actie: 'opheffen' | 'weg' | 'uit' } zolang er een vraag openstaat.
let planBevestig = null;

// "@b", "@b en @c", "@b, @c en @d"
function namenZin(namen) {
  if (namen.length <= 1) return namen.join('');
  return `${namen.slice(0, -1).join(', ')} en ${namen[namen.length - 1]}`;
}

function vraagPlanBevestiging(item, actie) {
  planBevestig = { sleutel: item.sleutel, actie };
  naPlanLaden();
  document.querySelector('.plan-bevestig button')?.focus();
}

function annuleerPlanBevestiging() {
  planBevestig = null;
  naPlanLaden();
}

// De vraag met [bevestig] [Annuleren], of null als er niets gevraagd wordt.
function planBevestigBlok(item) {
  const info = gedeeldPlan(item);
  if (!info || planBevestig?.sleutel !== item.sleutel) return null;
  const ik = state.user.uid;
  const organisator = isOrganisator(info);
  // Wie een bericht krijgt: bij opheffen wie nog meegaat of uitgenodigd is,
  // bij afmelden de organisator.
  const ontvangers = organisator
    ? info.leden.filter((l) => l.uid !== ik && ['gaat', 'uitgenodigd'].includes(l.status)).map((l) => naamNu(l.uid))
    : [naamNu(info.plan.eigenaar)];
  const bericht = ontvangers.length ? ` ${namenZin(ontvangers)} ${ontvangers.length === 1 ? 'krijgt' : 'krijgen'} hiervan een bericht.` : '';
  const { actie } = planBevestig;
  const vraag = organisator
    ? actie === 'uit'
      ? `Uit je planning halen? Het gedeelde plan wordt dan opgeheven.${bericht}`
      : `Plan opheffen?${bericht}`
    : `Toch niet meegaan?${bericht}`;
  const knopTekst = organisator ? (actie === 'uit' ? 'Uit planning halen' : 'Opheffen') : 'Ik ga niet';
  const box = document.createElement('div');
  box.className = 'vriend-menu plan-bevestig';
  box.setAttribute('role', 'group');
  box.setAttribute('aria-label', 'Bevestigen');
  box.append(
    vriendenTekst('p', 'vriend-menu-vraag', vraag),
    kleineKnop(knopTekst, { primair: true, onClick: () => bevestigPlan(item) }),
    kleineKnop('Annuleren', { onClick: annuleerPlanBevestiging })
  );
  return box;
}

async function bevestigPlan(item) {
  const info = gedeeldPlan(item);
  const actie = planBevestig?.actie;
  planBevestig = null;
  if (!info) {
    naPlanLaden();
    return;
  }
  // De organisator heft op (en haalt het bij 'uit' daarna uit de eigen
  // planning); een gast meldt zich af (verlaatGedeeldPlan haalt het item weg).
  const gelukt = await verlaatGedeeldPlan(item);
  if (gelukt && isOrganisator(info) && actie === 'uit') {
    state.gepland = haalUitPlanning(state.gepland, item.sleutel);
    saveGepland();
    naPlanLaden();
    renderAgenda();
  }
}

// Een gast meldt zich af (item uit de eigen planning, bericht aan de
// organisator); de organisator heft het plan op (de leden krijgen een
// bericht; zijn eigen item blijft als gewoon plan staan).
async function verlaatGedeeldPlan(item) {
  const info = gedeeldPlan(item);
  if (!info) return false;
  const user = state.user;
  try {
    if (isOrganisator(info)) {
      await hefOp({ db, fs: firestoreFns, ik: user.uid, planId: item.planId, leden: info.leden });
      planCache.set(item.planId, { status: 'klaar', info: { ...info, plan: { ...info.plan, opgeheven: true } } });
      toonMelding('Plan opgeheven. Wie meeging of uitgenodigd was, krijgt een bericht.');
    } else {
      await zetMijnStatus({ db, fs: firestoreFns, ik: user.uid, planId: item.planId, eigenaar: info.plan.eigenaar, status: 'weg' });
      planCache.delete(item.planId);
      state.gepland = haalUitPlanning(state.gepland, item.sleutel);
      saveGepland();
      toonMelding(`Je gaat niet mee. ${naamNu(info.plan.eigenaar)} krijgt een bericht.`);
    }
  } catch (err) {
    console.error('Gedeeld plan verlaten mislukt:', err);
    toonMelding(err instanceof PlanFout ? err.message : VERBINDING_FOUT);
    return false;
  }
  if (state.user !== user) return false;
  naPlanLaden();
  renderAgenda();
  return true;
}

// ---------- Mail bij uitnodigingen (stap 5) ----------

// mailvoorkeur/{uid}: { uitnodigingen, gewijzigdOp }; geen document = aan.
// De Cloud Function leest dit vóór het versturen (functions/uitnodiging.js).
const MAIL_ICOON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M4 6h16v12H4z" /><path d="M4 7l8 6 8-6" /><path d="M16 3l4 3" />
</svg>`;
let mailMelding = null;

function renderMailTegel() {
  const tegel = document.createElement('button');
  tegel.type = 'button';
  tegel.className = 'profiel-tegel';
  tegel.id = 'mailTegel';
  const icoon = document.createElement('span');
  icoon.className = 'profiel-tegel-icoon';
  icoon.innerHTML = MAIL_ICOON;
  icoon.firstElementChild.setAttribute('aria-hidden', 'true');
  const tekst = document.createElement('span');
  tekst.className = 'profiel-tegel-tekst';
  tekst.append(vriendenTekst('span', 'profiel-tegel-titel', 'Mail'), vriendenTekst('span', 'profiel-tegel-sub', 'Mail bij uitnodigingen'));
  const pijl = document.createElement('span');
  pijl.className = 'profiel-tegel-pijl';
  pijl.innerHTML = CHEVRON;
  tegel.append(icoon, tekst, pijl);
  tegel.addEventListener('click', () => navigate('#/profiel/mail'));
  return tegel;
}

async function laadMail() {
  renderMailScherm();
  if (!state.user) return;
  const user = state.user;
  state.mailFout = false;
  try {
    const snap = await getDoc(doc(db, 'mailvoorkeur', user.uid));
    if (state.user !== user) return;
    state.mailAan = !(snap.exists() && snap.data().uitnodigingen === false);
  } catch (err) {
    if (state.user !== user) return;
    console.error('Kon de mailinstelling niet laden:', err);
    state.mailFout = true;
  }
  renderMailScherm();
}

async function zetMail(aan, knop) {
  const user = state.user;
  if (!user) return;
  knop.disabled = true;
  try {
    await setDoc(doc(db, 'mailvoorkeur', user.uid), { uitnodigingen: aan, gewijzigdOp: serverTimestamp() });
    if (state.user !== user) return;
    state.mailAan = aan;
    mailMelding = { tekst: aan ? 'Opgeslagen: je krijgt weer mail bij uitnodigingen.' : 'Opgeslagen: geen mail meer bij uitnodigingen.', soort: 'succes' };
  } catch (err) {
    console.error('Mailinstelling opslaan mislukt:', err);
    mailMelding = { tekst: VERBINDING_FOUT, soort: 'fout' };
  }
  renderMailScherm();
  document.getElementById('mailSchakelaar')?.focus();
}

function renderMailScherm() {
  const box = els.mailInhoud;
  if (!box || els.screens.mail.hidden) return;
  box.replaceChildren();
  if (!state.authBekend) {
    box.appendChild(vriendenTekst('p', 'profiel-melding', 'Laden…'));
    return;
  }
  if (!state.user) {
    box.appendChild(vriendenTekst('p', 'vrienden-leeg', 'Log in om je mailinstelling te bekijken of te wijzigen.'));
    const inloggen = document.createElement('button');
    inloggen.type = 'button';
    inloggen.className = 'google-btn';
    inloggen.innerHTML = GOOGLE_ICON_SVG;
    inloggen.appendChild(vriendenTekst('span', '', 'Inloggen met Google'));
    inloggen.addEventListener('click', handleSignIn);
    box.appendChild(inloggen);
    return;
  }
  if (state.mailFout) {
    box.appendChild(vriendenFoutBlok('Je mailinstelling kon niet worden geladen. Controleer je verbinding en probeer het opnieuw.', laadMail));
    return;
  }
  if (state.mailAan === undefined) {
    box.appendChild(vriendenTekst('p', 'profiel-melding', 'Laden…'));
    return;
  }
  const rij = document.createElement('div');
  rij.className = 'delen-rij';
  const label = vriendenTekst('label', 'delen-label', 'Mail bij uitnodigingen');
  label.htmlFor = 'mailSchakelaar';
  const schakelaar = document.createElement('button');
  schakelaar.type = 'button';
  schakelaar.id = 'mailSchakelaar';
  schakelaar.className = 'switch' + (state.mailAan ? ' is-on' : '');
  schakelaar.setAttribute('role', 'switch');
  schakelaar.setAttribute('aria-checked', String(state.mailAan));
  schakelaar.addEventListener('click', () => zetMail(!state.mailAan, schakelaar));
  label.addEventListener('click', (e) => {
    e.preventDefault();
    schakelaar.click();
  });
  rij.append(label, schakelaar);
  box.appendChild(rij);
  const uitleg = vriendenTekst(
    'p',
    'vrienden-leeg',
    'Nodigt een vriend je uit voor een voorstelling, dan sturen we een korte mail naar het adres van je Google-account. Je adres is nooit zichtbaar voor anderen. '
  );
  const privacy = document.createElement('a');
  privacy.href = 'privacy.html';
  privacy.textContent = 'Meer over privacy';
  uitleg.appendChild(privacy);
  box.appendChild(uitleg);
  if (mailMelding) {
    const p = vriendenTekst('p', `vrienden-melding vrienden-melding--${mailMelding.soort}`, mailMelding.tekst);
    p.setAttribute('role', mailMelding.soort === 'fout' ? 'alert' : 'status');
    box.appendChild(p);
  }
}

// ---------- Berichten (zie plannen.js) ----------

const BERICHT_ICOON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <rect x="3" y="5" width="18" height="14" rx="2" /><polyline points="3 7 12 13 21 7" />
</svg>`;
const STAND_TEKST = {
  gaat: 'Je gaat mee',
  'kan-niet': 'Afgeslagen',
  weg: 'Je gaat niet meer',
  ingetrokken: 'Ingetrokken',
  opgeheven: 'Opgeheven',
  verlopen: 'Verlopen',
};

// De enige live listener in de app: het aantal ongelezen berichten, voor de
// teller op de tegel en de Profiel-tab.
let berichtenAfmelden = null;

function startBerichtenTeller() {
  if (!magVrienden() || berichtenAfmelden || !els.screens.berichten) return;
  const user = state.user;
  const q = query(collection(db, 'inbox', user.uid, 'berichten'), where('gelezen', '==', false));
  berichtenAfmelden = onSnapshot(
    q,
    (snap) => {
      if (state.user !== user) return;
      state.ongelezen = snap.size;
      renderBerichtenTeller();
    },
    (err) => {
      console.error('Teller van berichten werkt niet:', err);
      state.ongelezen = null;
      renderBerichtenTeller();
    }
  );
}

function stopBerichtenTeller() {
  berichtenAfmelden?.();
  berichtenAfmelden = null;
  state.ongelezen = null;
  renderBerichtenTeller();
}

function renderBerichtenTeller() {
  const n = state.ongelezen ?? 0;
  if (els.profielBadge) {
    els.profielBadge.hidden = n === 0;
    els.profielBadge.textContent = n > 99 ? '99+' : String(n);
  }
  const tab = els.bottomNav?.querySelector('.nav-item[data-tab="profiel"]');
  if (tab) {
    if (n) tab.setAttribute('aria-label', `Profiel, ${n} ongelezen ${n === 1 ? 'bericht' : 'berichten'}`);
    else tab.removeAttribute('aria-label');
  }
  document.getElementById('berichtenTegel')?.replaceWith(renderBerichtenTegel());
}

function renderBerichtenTegel() {
  const n = state.ongelezen ?? 0;
  const tegel = document.createElement('button');
  tegel.type = 'button';
  tegel.className = 'profiel-tegel';
  tegel.id = 'berichtenTegel';
  const icoon = document.createElement('span');
  icoon.className = 'profiel-tegel-icoon';
  icoon.innerHTML = BERICHT_ICOON;
  icoon.firstElementChild.setAttribute('aria-hidden', 'true');
  if (n > 0) {
    const badge = document.createElement('span');
    badge.className = 'badge';
    badge.setAttribute('aria-hidden', 'true');
    badge.textContent = n > 99 ? '99+' : String(n);
    icoon.appendChild(badge);
  }
  const tekst = document.createElement('span');
  tekst.className = 'profiel-tegel-tekst';
  tekst.append(
    vriendenTekst('span', 'profiel-tegel-titel', 'Berichten'),
    vriendenTekst('span', 'profiel-tegel-sub', n > 0 ? `${n} ongelezen` : 'Uitnodigingen en reacties')
  );
  const pijl = document.createElement('span');
  pijl.className = 'profiel-tegel-pijl';
  pijl.innerHTML = CHEVRON;
  tegel.append(icoon, tekst, pijl);
  tegel.addEventListener('click', () => navigate('#/berichten'));
  return tegel;
}

const BERICHTEN_TIMEOUT_MS = 12000;

// { status: 'leeg'|'laden'|'klaar'|'fout', lijst, nieuw (ids die bij het
// openen ongelezen waren), melding }
let berichtenStand = { status: 'leeg', lijst: [], nieuw: new Set(), melding: null };

async function openBerichten() {
  berichtenStand = { ...berichtenStand, melding: null };
  renderBerichten();
  if (!magVrienden()) return;
  const user = state.user;
  berichtenStand = { ...berichtenStand, status: 'laden' };
  renderBerichten();
  try {
    // Offline wacht Firestore soms lang; na BERICHTEN_TIMEOUT_MS een melding.
    const lijst = await Promise.race([
      (async () => {
        let l = await laadBerichten({ db, fs: firestoreFns, ik: user.uid });
        l = await ruimBerichtenOp({ db, fs: firestoreFns, ik: user.uid, berichten: l });
        await Promise.all([
          ...[...new Set(l.map((b) => b.planId))].map((id) => laadPlanInfo(id, { opnieuw: true })),
          ...[...new Set(l.map((b) => b.van))].map((uid) => naamVan(uid)),
        ]);
        return l;
      })(),
      new Promise((_, weiger) => setTimeout(() => weiger(new Error('timeout')), BERICHTEN_TIMEOUT_MS)),
    ]);
    if (state.user !== user) return;
    const nieuw = new Set(lijst.filter((b) => !b.gelezen).map((b) => b.id));
    berichtenStand = { status: 'klaar', lijst, nieuw, melding: null };
    renderBerichten();
    markeerGelezen({ db, fs: firestoreFns, ik: user.uid, ids: [...nieuw] }).catch((err) => console.error('Kon berichten niet als gelezen zetten:', err));
  } catch (err) {
    if (state.user !== user) return;
    console.error('Kon berichten niet laden:', err);
    berichtenStand = { ...berichtenStand, status: 'fout' };
    renderBerichten();
  }
}

// "za 18 okt"
function dagKort(iso) {
  const { day, month, year } = parseIsoDate(iso);
  return `${WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()]} ${day} ${MONTHS[month - 1]}`;
}

// De voorstelling van een plan in de agenda (voor de titelknop), of null.
function showVanPlan(info) {
  const v = info?.plan.voorstelling;
  if (!v) return null;
  return koppel({ titel: v.titel, theaterId: v.theaterId, datum: v.datum, tijd: v.tijd }, indexeerShows(state.shows)).show;
}

function berichtKaart(b) {
  const info = planCache.get(b.planId)?.info ?? null;
  const v = info?.plan.voorstelling ?? null;
  const naam = naamNu(b.van);
  const kaart = document.createElement('article');
  kaart.className = 'bericht' + (berichtenStand.nieuw.has(b.id) ? ' bericht--nieuw' : '');
  if (berichtenStand.nieuw.has(b.id)) kaart.appendChild(vriendenTekst('span', 'bericht-nieuw', 'Nieuw'));

  const zin = document.createElement('p');
  zin.className = 'bericht-tekst';
  const voor = {
    uitnodiging: `${naam} nodigt je uit voor `,
    'gaat-mee': `${naam} gaat mee naar `,
    'kan-niet': `${naam} kan niet naar `,
    weg: `${naam} gaat toch niet naar `,
    opgeheven: `${naam} heeft het plan opgeheven voor `,
  }[b.soort] ?? `${naam}: `;
  zin.appendChild(document.createTextNode(voor));
  const show = showVanPlan(info);
  if (v && show) {
    const titel = document.createElement('button');
    titel.type = 'button';
    titel.className = 'bericht-titel';
    titel.textContent = v.titel;
    titel.addEventListener('click', () => navigate(`#/show/${encodeURIComponent(show.id)}`));
    zin.appendChild(titel);
  } else {
    zin.appendChild(vriendenTekst('span', 'bericht-titel bericht-titel--tekst', v?.titel ?? 'een voorstelling'));
  }
  kaart.appendChild(zin);
  if (v) {
    const plek = [v.theaterNaam, v.stad].filter(Boolean).join(', ');
    kaart.appendChild(vriendenTekst('p', 'bericht-meta', [dagKort(v.datum), v.tijd, plek].filter(Boolean).join(' · ')));
  }

  if (b.soort === 'uitnodiging') {
    const stand = uitnodigingStand(info, state.user.uid);
    if (stand === 'open') {
      const acties = document.createElement('div');
      acties.className = 'vriend-rij-acties bericht-acties';
      acties.append(
        kleineKnop('Ik ga mee', { primair: true, label: `Ik ga mee naar ${v.titel}`, onClick: (e) => reageerOpUitnodiging(b, info, 'gaat', e.currentTarget) }),
        kleineKnop('Kan niet', { label: `Ik kan niet naar ${v.titel}`, onClick: (e) => reageerOpUitnodiging(b, info, 'kan-niet', e.currentTarget) })
      );
      kaart.appendChild(acties);
    } else {
      kaart.appendChild(vriendenTekst('p', `bericht-stand bericht-stand--${stand}`, STAND_TEKST[stand] ?? ''));
    }
  }
  return kaart;
}

function renderBerichten() {
  const box = els.berichtenInhoud;
  if (!box || els.screens.berichten.hidden) return;
  box.replaceChildren();
  if (!state.authBekend || (state.user && state.profiel === undefined && !state.profielFout)) {
    box.appendChild(vriendenTekst('p', 'profiel-melding', 'Laden…'));
    return;
  }
  if (!magVrienden()) {
    box.appendChild(vriendenTekst('p', 'vrienden-leeg', 'Kies eerst een gebruikersnaam; daarna kunnen vrienden je uitnodigen.'));
    return;
  }
  if (berichtenStand.melding) {
    const p = vriendenTekst('p', `vrienden-melding vrienden-melding--${berichtenStand.melding.soort}`, berichtenStand.melding.tekst);
    p.setAttribute('role', berichtenStand.melding.soort === 'fout' ? 'alert' : 'status');
    box.appendChild(p);
  }
  if (berichtenStand.status === 'fout') {
    box.appendChild(vriendenFoutBlok('Je berichten konden niet worden geladen. Controleer je verbinding en probeer het opnieuw.', openBerichten));
    return;
  }
  if (berichtenStand.status !== 'klaar') {
    box.appendChild(vriendenTekst('p', 'profiel-melding', 'Laden…'));
    return;
  }
  if (berichtenStand.lijst.length === 0) {
    box.appendChild(vriendenTekst('p', 'vrienden-leeg', 'Nog geen berichten. Nodigt een vriend je uit voor een voorstelling, dan zie je dat hier.'));
    return;
  }
  for (const b of berichtenStand.lijst) box.appendChild(berichtKaart(b));
}

// Ik ga mee: status in het plan en het plan in je eigen Gepland (een
// bestaand item met dezelfde sleutel wordt gekoppeld, niet verdubbeld).
async function reageerOpUitnodiging(b, info, status, knop) {
  const user = state.user;
  knop.disabled = true;
  try {
    await zetMijnStatus({ db, fs: firestoreFns, ik: user.uid, planId: b.planId, eigenaar: info.plan.eigenaar, status });
    if (status === 'gaat') voegGedeeldPlanToe(info);
    berichtenStand.melding = {
      tekst: status === 'gaat' ? 'Je gaat mee. Het staat in je Gepland.' : `Afgeslagen. ${naamNu(info.plan.eigenaar)} krijgt een bericht.`,
      soort: 'succes',
    };
  } catch (err) {
    if (!(err instanceof PlanFout)) console.error('Reageren mislukt:', err);
    berichtenStand.melding = { tekst: err instanceof PlanFout ? err.message : VERBINDING_FOUT, soort: 'fout' };
  }
  if (state.user !== user) return;
  await laadPlanInfo(b.planId, { opnieuw: true });
  renderBerichten();
  naPlanLaden();
  renderAgenda();
}

function voegGedeeldPlanToe(info) {
  const v = info.plan.voorstelling;
  const sleutels = new Set([info.plan.sleutel, geplandSleutel(v)]);
  let eigen = state.gepland.gepland.find((i) => sleutels.has(i.sleutel));
  if (!eigen) {
    const show = showVanPlan(info);
    const bron = show ?? { ...v, reserverenUrl: '' };
    state.gepland = planIn(state.gepland, bron);
    eigen = state.gepland.gepland.find((i) => i.sleutel === geplandSleutel(bron));
  }
  state.gepland = koppelPlan(state.gepland, eigen.sleutel, info.plan.planId);
  saveGepland();
}

// ---------- Scherm "Vrienden uitnodigen" (#/uitnodigen/<sleutel>) ----------

let uitnodigSleutel = null;
let uitnodigKeuze = new Set();
let uitnodigMelding = null;
let uitnodigBezig = false;

async function openUitnodigen(sleutel) {
  if (uitnodigSleutel !== sleutel) {
    uitnodigKeuze = new Set();
    uitnodigMelding = null;
  }
  uitnodigSleutel = sleutel;
  renderUitnodigen();
  if (!magVrienden()) return;
  const item = state.gepland?.gepland.find((i) => i.sleutel === sleutel);
  // De vriendenlijst altijd opnieuw, en de oude niet tonen ("Laden…"): wie
  // sinds het vorige laden vriend werd (bv. via jouw link), moet erin staan,
  // en wie geen vriend meer is (verbroken, geblokkeerd) niet.
  state.vrienden = null;
  state.vriendenStatus = 'leeg';
  renderUitnodigen();
  const laden = [laadVrienden()];
  if (item?.planId) laden.push(laadPlanInfo(item.planId, { opnieuw: true }));
  await Promise.all(laden);
  renderUitnodigen();
}

function renderUitnodigen() {
  const box = els.uitnodigenInhoud;
  if (!box || els.screens.uitnodigen.hidden) return;
  box.replaceChildren();
  const item = state.gepland?.gepland.find((i) => i.sleutel === uitnodigSleutel);
  els.uitnodigenSub.textContent = item ? `${item.titel} · ${formatDateLong(item.datum)}${item.tijd ? ` · ${item.tijd}` : ''}` : '';

  if (!state.authBekend || (state.user && state.profiel === undefined && !state.profielFout)) {
    box.appendChild(vriendenTekst('p', 'profiel-melding', 'Laden…'));
    return;
  }
  if (!magVrienden()) {
    box.appendChild(vriendenTekst('p', 'vrienden-leeg', 'Kies eerst een gebruikersnaam en voeg vrienden toe; daarna kun je ze uitnodigen.'));
    return;
  }
  if (!item) {
    box.appendChild(vriendenTekst('p', 'vrienden-leeg', 'Deze voorstelling staat niet (meer) in je planning.'));
    return;
  }
  if (!isNogTePlannen(item.datum)) {
    box.appendChild(vriendenTekst('p', 'vrienden-leeg', 'Deze voorstelling is voorbij; uitnodigen kan niet meer.'));
    return;
  }
  const cache = item.planId ? planCache.get(item.planId) : null;
  if (cache?.status === 'laden' || (!state.vrienden && state.vriendenStatus !== 'fout')) {
    box.appendChild(vriendenTekst('p', 'profiel-melding', 'Laden…'));
    return;
  }
  if (cache?.status === 'fout' || state.vriendenStatus === 'fout') {
    box.appendChild(
      vriendenFoutBlok('Dit kon niet worden geladen. Controleer je verbinding en probeer het opnieuw.', () => {
        if (item.planId) planCache.delete(item.planId);
        state.vrienden = null;
        state.vriendenStatus = 'leeg';
        openUitnodigen(item.sleutel);
      })
    );
    return;
  }
  // Een lopend plan van iemand anders: alleen de organisator nodigt uit.
  const lopend = cache?.info && !cache.info.plan.opgeheven ? cache.info : null;
  if (lopend && !isOrganisator(lopend)) {
    box.appendChild(vriendenTekst('p', 'vrienden-leeg', `Alleen ${naamNu(lopend.plan.eigenaar)} kan mensen uitnodigen voor dit plan.`));
    return;
  }
  const genodigden = lopend?.plan.genodigden ?? [];
  const leden = new Map((lopend?.leden ?? []).map((l) => [l.uid, l]));
  const vrienden = (state.vrienden?.vrienden ?? []).filter((v) => !v.onbekend);
  // Uitgenodigden die geen vriend meer zijn, staan er ook (om in te trekken).
  const extra = genodigden.filter((u) => !vrienden.some((v) => v.uid === u)).map((u) => ({ uid: u, gebruikersnaam: naamNu(u).replace(/^@/, ''), onbekendNaam: naamNu(u) === 'iemand' }));
  const plekken = MAX_GENODIGDEN - genodigden.length;

  if (uitnodigMelding) {
    const p = vriendenTekst('p', `vrienden-melding vrienden-melding--${uitnodigMelding.soort}`, uitnodigMelding.tekst);
    p.setAttribute('role', uitnodigMelding.soort === 'fout' ? 'alert' : 'status');
    box.appendChild(p);
  }
  if (vrienden.length === 0 && extra.length === 0) {
    box.appendChild(vriendenTekst('p', 'vrienden-leeg', 'Je hebt nog geen vrienden om uit te nodigen.'));
    const naar = document.createElement('button');
    naar.type = 'button';
    naar.className = 'btn-secondary';
    naar.textContent = 'Naar Vrienden';
    naar.addEventListener('click', () => navigate('#/vrienden'));
    box.appendChild(naar);
    return;
  }
  box.appendChild(vriendenTekst('p', 'vrienden-leeg', `Je kunt nog ${Math.max(plekken, 0)} van de ${MAX_GENODIGDEN} plekken vullen. Wie je uitnodigt, krijgt een bericht.`));

  const lijst = document.createElement('div');
  lijst.className = 'uitnodig-lijst';
  for (const v of [...vrienden, ...extra]) {
    const rij = document.createElement('div');
    rij.className = 'uitnodig-rij';
    const lid = leden.get(v.uid);
    if (genodigden.includes(v.uid)) {
      const tekst = document.createElement('p');
      tekst.className = 'vriend-rij-tekst';
      tekst.append(vriendenTekst('span', 'vriend-naam', v.onbekendNaam ? 'iemand' : `@${v.gebruikersnaam}`), document.createTextNode(` · ${STATUS_LABELS[lid?.status] ?? 'uitgenodigd'}`));
      rij.append(
        tekst,
        kleineKnop('Intrekken', {
          label: `Uitnodiging van ${v.onbekendNaam ? 'iemand' : `@${v.gebruikersnaam}`} intrekken`,
          onClick: () => trekUitnodigingIn(item, v.uid),
        })
      );
    } else {
      const id = `uitnodig-${v.uid}`;
      const vak = document.createElement('input');
      vak.type = 'checkbox';
      vak.id = id;
      vak.className = 'uitnodig-vak';
      vak.checked = uitnodigKeuze.has(v.uid);
      vak.disabled = uitnodigBezig || (!vak.checked && uitnodigKeuze.size >= plekken);
      vak.addEventListener('change', () => {
        if (vak.checked) uitnodigKeuze.add(v.uid);
        else uitnodigKeuze.delete(v.uid);
        renderUitnodigen();
        document.getElementById(id)?.focus();
      });
      const label = document.createElement('label');
      label.htmlFor = id;
      label.className = 'uitnodig-label';
      label.append(vriendenTekst('span', 'vriend-naam', `@${v.gebruikersnaam}`), document.createTextNode(` · ${v.naam ?? ''}`));
      rij.append(vak, label);
    }
    lijst.appendChild(rij);
  }
  box.appendChild(lijst);

  const knop = document.createElement('button');
  knop.type = 'button';
  knop.className = 'btn-primary';
  knop.textContent = uitnodigBezig ? 'Bezig…' : `Uitnodigen${uitnodigKeuze.size ? ` (${uitnodigKeuze.size})` : ''}`;
  knop.disabled = uitnodigBezig || uitnodigKeuze.size === 0;
  knop.addEventListener('click', () => verstuurUitnodigingen(item));
  box.appendChild(knop);
}

// Eén vriend per batch (zie plannen.js); het eerste maakt het plan gedeeld.
async function verstuurUitnodigingen(item) {
  const user = state.user;
  const cache = item.planId ? planCache.get(item.planId)?.info : null;
  let lopend = cache && !cache.plan.opgeheven && isOrganisator(cache) ? cache : null;
  let planId = lopend ? item.planId : null;
  let plan = lopend?.plan ?? null;
  const gelukt = [];
  const mislukt = [];
  uitnodigBezig = true;
  renderUitnodigen();
  for (const gast of [...uitnodigKeuze]) {
    try {
      planId = await nodigUit({ db, fs: firestoreFns, ik: user.uid, item, planId, plan, gast });
      plan = { ...(plan ?? {}), genodigden: [...(plan?.genodigden ?? []), gast] };
      gelukt.push(gast);
      uitnodigKeuze.delete(gast);
    } catch (err) {
      if (!(err instanceof PlanFout)) console.error('Uitnodigen mislukt:', err);
      mislukt.push({ gast, tekst: err instanceof PlanFout ? err.message : VERBINDING_FOUT });
      if (!(err instanceof PlanFout)) break;
    }
  }
  uitnodigBezig = false;
  if (state.user !== user) return;
  if (gelukt.length && item.planId !== planId) {
    state.gepland = koppelPlan(state.gepland, item.sleutel, planId);
    saveGepland();
  }
  const naam = (u) => {
    const v = state.vrienden?.vrienden.find((x) => x.uid === u);
    return v ? `@${v.gebruikersnaam}` : naamNu(u);
  };
  const delen = [];
  if (gelukt.length) delen.push(`Uitgenodigd: ${gelukt.map(naam).join(', ')}.`);
  for (const m of mislukt) delen.push(`${naam(m.gast)}: ${m.tekst}`);
  uitnodigMelding = { tekst: delen.join(' '), soort: mislukt.length ? 'fout' : 'succes' };
  if (planId) await laadPlanInfo(planId, { opnieuw: true });
  naPlanLaden();
  renderAgenda();
}

async function trekUitnodigingIn(item, gast) {
  const info = item.planId ? planCache.get(item.planId)?.info : null;
  if (!info || !isOrganisator(info)) return;
  try {
    await trekIn({ db, fs: firestoreFns, planId: item.planId, plan: info.plan, gast });
    uitnodigMelding = { tekst: `Uitnodiging van ${naamNu(gast)} ingetrokken.`, soort: 'succes' };
  } catch (err) {
    console.error('Intrekken mislukt:', err);
    uitnodigMelding = { tekst: VERBINDING_FOUT, soort: 'fout' };
  }
  await laadPlanInfo(item.planId, { opnieuw: true });
  naPlanLaden();
}

// ---------- Delen met vrienden (zie gedeeld.js) ----------

const OOG_ICOON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" />
</svg>`;
const DEEL_LABELS = { gezien: 'Vrienden zien mijn Gezien (met sterren)', watchlist: 'Vrienden zien mijn Watchlist' };
const KOPIE_WACHT_MS = 3000;

// Laatst geschreven kopie per onderdeel (JSON van de items): undefined =
// onbekend, null = er staat geen kopie. Zo wordt er niets geschreven als er
// niets veranderd is (ook niet bij inloggen op een ander apparaat).
const laatsteKopie = { gezien: undefined, watchlist: undefined };
let kopieTimer = null;

async function laadDelen() {
  const user = state.user;
  if (!magVrienden()) return;
  state.delenFout = false;
  try {
    const { instelling, kopieen } = await laadEigenDelen({ db, fs: firestoreFns, uid: user.uid });
    if (state.user !== user) return;
    state.delen = instelling;
    for (const o of ONDERDELEN) laatsteKopie[o] = kopieen[o] ? JSON.stringify(kopieen[o].items) : null;
  } catch (err) {
    if (state.user !== user) return;
    console.error('Kon de instelling voor delen niet laden:', err);
    state.delen = undefined;
    state.delenFout = true;
  }
}

// Actuele titel, maker en genre uit de agenda, per sleutel.
function kopieInfo() {
  const live = showsPerSleutel();
  return (sleutel) => {
    const show = live.get(sleutel);
    return show ? { titel: weergaveTitel(show), maker: show.maker ?? null, genre: getGenreBucket(show) } : null;
  };
}

// De kopie van één onderdeel, of null zolang de data nog niet compleet is
// (niet ingelogd, cloud of agenda nog niet geladen).
function kopieVan(onderdeel, info = kopieInfo()) {
  if (!state.user || state.shows.length === 0) return null;
  if (onderdeel === 'gezien') {
    if (!state.cloudGezien) return null;
    return { items: kopieGezien(state.gezien, info), stand: standVan(state.gezien, 'gezien') };
  }
  if (!state.cloudWatchlist) return null;
  return { items: kopieWatchlist(state.watchlist, info), stand: standVan(state.watchlist, 'watchlist') };
}

// Na een wijziging, het inloggen of de sync: over KOPIE_WACHT_MS de kopie
// bijwerken (één keer, ook na meerdere tikken).
function planKopie() {
  if (!state.user || !state.delen) return;
  clearTimeout(kopieTimer);
  kopieTimer = setTimeout(schrijfKopieen, KOPIE_WACHT_MS);
}

async function schrijfKopieen() {
  const user = state.user;
  if (!user || !state.delen) return;
  const info = kopieInfo();
  for (const o of ONDERDELEN) {
    if (!state.delen[o]) continue;
    const kopie = kopieVan(o, info);
    if (!kopie) continue;
    const json = JSON.stringify(kopie.items);
    if (json === laatsteKopie[o]) continue;
    try {
      await schrijfKopie({ db, fs: firestoreFns, uid: user.uid, onderdeel: o, ...kopie });
      if (state.user === user) laatsteKopie[o] = json;
    } catch (err) {
      // Geweigerd: o.a. een nieuwere kopie van een ander apparaat (stand).
      console.warn(`Kopie van ${o} niet bijgewerkt:`, err?.code ?? err);
    }
  }
}

// Eén keer, voor wie een profiel heeft maar nog niets gekozen heeft. Tot
// "Oké" of een keuze bij "Aanpassen" wordt er niets gedeeld.
function renderDelenMelding() {
  if (!magVrienden() || state.delen !== null || !els.screens.delen) return null;
  const box = document.createElement('div');
  box.className = 'delen-melding';
  box.setAttribute('role', 'region');
  box.setAttribute('aria-label', 'Delen met vrienden');
  box.appendChild(vriendenTekst('p', 'delen-melding-tekst', 'Je vrienden kunnen je Gezien (met sterren) en Watchlist zien.'));
  const knoppen = document.createElement('div');
  knoppen.className = 'vriend-rij-acties delen-melding-knoppen';
  knoppen.append(
    kleineKnop('Aanpassen', { onClick: () => navigate('#/profiel/delen') }),
    kleineKnop('Oké', { primair: true, label: 'Oké, vrienden zien mijn Gezien en Watchlist', onClick: (e) => kiesDelen(STANDAARD_INSTELLING, e.currentTarget) })
  );
  box.appendChild(knoppen);
  return box;
}

function delenSamenvatting() {
  if (state.delenFout) return 'Kon niet worden geladen';
  if (state.delen === undefined) return '…';
  if (state.delen === null) return 'Nog niet ingesteld';
  const { gezien, watchlist } = state.delen;
  if (gezien && watchlist) return 'Gezien en Watchlist';
  if (gezien) return 'Alleen Gezien';
  if (watchlist) return 'Alleen Watchlist';
  return 'Niets';
}

function renderDelenTegel() {
  const tegel = document.createElement('button');
  tegel.type = 'button';
  tegel.className = 'profiel-tegel';
  tegel.id = 'delenTegel';
  const icoon = document.createElement('span');
  icoon.className = 'profiel-tegel-icoon';
  icoon.innerHTML = OOG_ICOON;
  icoon.firstElementChild.setAttribute('aria-hidden', 'true');
  const tekst = document.createElement('span');
  tekst.className = 'profiel-tegel-tekst';
  tekst.append(vriendenTekst('span', 'profiel-tegel-titel', 'Wat vrienden zien'), vriendenTekst('span', 'profiel-tegel-sub', delenSamenvatting()));
  const pijl = document.createElement('span');
  pijl.className = 'profiel-tegel-pijl';
  pijl.innerHTML = CHEVRON;
  tegel.append(icoon, tekst, pijl);
  tegel.addEventListener('click', () => navigate('#/profiel/delen'));
  return tegel;
}

// Keuze op het scherm "Wat vrienden zien" zolang er nog niets opgeslagen is.
let delenKeuze = null;
let delenMelding = null;

/**
 * Instelling opslaan met in dezelfde batch de kopieën (aan: schrijven als
 * de data er is; uit: weghalen). `knop` gaat even uit.
 */
async function kiesDelen(instelling, knop = null) {
  const user = state.user;
  if (!magVrienden()) return;
  if (knop) knop.disabled = true;
  const info = kopieInfo();
  const kopieen = {};
  for (const o of ONDERDELEN) if (instelling[o]) kopieen[o] = kopieVan(o, info);
  try {
    await zetInstelling({ db, fs: firestoreFns, uid: user.uid, instelling, kopieen });
    if (state.user !== user) return;
    state.delen = { gezien: instelling.gezien === true, watchlist: instelling.watchlist === true };
    for (const o of ONDERDELEN) {
      if (!instelling[o]) laatsteKopie[o] = null;
      else if (kopieen[o]) laatsteKopie[o] = JSON.stringify(kopieen[o].items);
    }
    delenKeuze = null;
    delenMelding = { tekst: 'Opgeslagen.', soort: 'succes' };
    planKopie();
  } catch (err) {
    console.error('Instelling delen opslaan mislukt:', err);
    delenMelding = { tekst: VERBINDING_FOUT, soort: 'fout' };
    if (knop) knop.disabled = false;
  }
  renderProfielTegels();
  renderDelenScherm();
}

function renderDelenScherm() {
  const box = els.delenInhoud;
  if (!box || els.screens.delen.hidden) return;
  box.innerHTML = '';
  if (!state.authBekend || (state.user && state.profiel === undefined && !state.profielFout) || (magVrienden() && state.delen === undefined && !state.delenFout)) {
    box.appendChild(vriendenTekst('p', 'profiel-melding', 'Laden…'));
    return;
  }
  if (!magVrienden()) {
    box.append(vriendenTekst('p', 'vrienden-leeg', 'Kies eerst een gebruikersnaam. Daarna kun je instellen wat vrienden zien.'));
    const knop = document.createElement('button');
    knop.type = 'button';
    knop.className = 'btn-secondary';
    knop.textContent = 'Gebruikersnaam kiezen';
    knop.addEventListener('click', () => navigate('#/profiel/instellen'));
    box.appendChild(knop);
    return;
  }
  if (state.delenFout) {
    box.appendChild(
      vriendenFoutBlok('Je instelling kon niet worden geladen. Controleer je verbinding en probeer het opnieuw.', async () => {
        state.delenFout = false;
        renderDelenScherm();
        await laadDelen();
        renderDelenScherm();
        renderProfielTegels();
        planKopie();
      })
    );
    return;
  }

  // Nog niets gekozen: schakelaars staan op de standaard en er wordt pas
  // iets gedeeld na "Opslaan".
  const eerste = state.delen === null;
  const huidig = eerste ? (delenKeuze ?? { ...STANDAARD_INSTELLING }) : state.delen;
  for (const o of ONDERDELEN) {
    const rij = document.createElement('div');
    rij.className = 'delen-rij';
    const id = `delenSchakelaar-${o}`;
    const label = vriendenTekst('label', 'delen-label', DEEL_LABELS[o]);
    label.htmlFor = id;
    const schakelaar = document.createElement('button');
    schakelaar.type = 'button';
    schakelaar.id = id;
    schakelaar.className = 'switch' + (huidig[o] ? ' is-on' : '');
    schakelaar.setAttribute('role', 'switch');
    schakelaar.setAttribute('aria-checked', String(huidig[o]));
    schakelaar.addEventListener('click', () => {
      const nieuw = { ...huidig, [o]: !huidig[o] };
      if (eerste) {
        delenKeuze = nieuw;
        renderDelenScherm();
        document.getElementById(id)?.focus();
        return;
      }
      kiesDelen(nieuw, schakelaar).then(() => document.getElementById(id)?.focus());
    });
    label.addEventListener('click', (e) => {
      e.preventDefault();
      schakelaar.click();
    });
    rij.append(label, schakelaar);
    box.appendChild(rij);
  }
  const uitleg = vriendenTekst('p', 'vrienden-leeg', 'Je planning (Gepland) zien vrienden niet. Wie geen vriend is, ziet niets. ');
  const privacy = document.createElement('a');
  privacy.href = 'privacy.html';
  privacy.textContent = 'Meer over privacy';
  uitleg.appendChild(privacy);
  box.appendChild(uitleg);
  if (eerste) {
    box.appendChild(vriendenTekst('p', 'vrienden-leeg', 'Er wordt nog niets gedeeld tot je opslaat.'));
    const opslaan = document.createElement('button');
    opslaan.type = 'button';
    opslaan.className = 'btn-primary';
    opslaan.textContent = 'Opslaan';
    opslaan.addEventListener('click', () => kiesDelen(huidig, opslaan));
    box.appendChild(opslaan);
  }
  if (delenMelding) {
    const p = vriendenTekst('p', `vrienden-melding vrienden-melding--${delenMelding.soort}`, delenMelding.tekst);
    p.setAttribute('role', delenMelding.soort === 'fout' ? 'alert' : 'status');
    box.appendChild(p);
  }
}

// ---------- Vrienden (zie vrienden.js) ----------

// Alleen ingelogd én met profiel: zonder gebruikersnaam kun je niet gevonden
// worden en geven de rules geen verzoek of link.
const magVrienden = () => Boolean(state.user && state.profiel);

const VRIENDEN_ICOON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6" />
  <circle cx="17" cy="9" r="2.5" /><path d="M16.5 14.2c2.9.2 5 2.3 5 5.3" />
</svg>`;
const CHEVRON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 6 15 12 9 18" /></svg>';
const MEER_ICOON = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="19" cy="12" r="2" /></svg>';

const VERBINDING_FOUT = 'Dat lukte niet. Controleer je verbinding en probeer het opnieuw.';

// Aantal openstaande verzoeken voor de tegel (1 read), bij het openen van
// Profiel en na inloggen.
async function vernieuwVriendenTeller() {
  if (!magVrienden()) return;
  const user = state.user;
  try {
    const n = await telInkomend({ db, fs: firestoreFns, ik: user.uid });
    if (state.user !== user) return;
    state.inkomendAantal = n;
  } catch (err) {
    if (state.user !== user) return;
    console.error('Kon het aantal vriendschapsverzoeken niet ophalen:', err);
    state.inkomendAantal = null;
  }
  renderProfielTegels();
}

function renderProfielTegels() {
  const box = els.profielTegels;
  if (!box) return;
  box.innerHTML = '';
  box.hidden = !magVrienden() || !els.screens.vrienden;
  if (box.hidden) return;

  const melding = renderDelenMelding();
  if (melding) box.appendChild(melding);
  if (els.screens.berichten) box.appendChild(renderBerichtenTegel());

  const n = state.inkomendAantal ?? 0;
  const tegel = document.createElement('button');
  tegel.type = 'button';
  tegel.className = 'profiel-tegel';
  tegel.id = 'vriendenTegel';
  const icoon = document.createElement('span');
  icoon.className = 'profiel-tegel-icoon';
  icoon.innerHTML = VRIENDEN_ICOON;
  icoon.firstElementChild.setAttribute('aria-hidden', 'true');
  if (n > 0) {
    const badge = document.createElement('span');
    badge.className = 'badge';
    badge.setAttribute('aria-hidden', 'true');
    badge.textContent = n > 99 ? '99+' : String(n);
    icoon.appendChild(badge);
  }
  const tekst = document.createElement('span');
  tekst.className = 'profiel-tegel-tekst';
  const titel = document.createElement('span');
  titel.className = 'profiel-tegel-titel';
  titel.textContent = 'Vrienden';
  const sub = document.createElement('span');
  sub.className = 'profiel-tegel-sub';
  sub.textContent = n > 0 ? `${n} ${n === 1 ? 'nieuw verzoek' : 'nieuwe verzoeken'}` : 'Toevoegen, verzoeken en je uitnodigingslink';
  tekst.append(titel, sub);
  const pijl = document.createElement('span');
  pijl.className = 'profiel-tegel-pijl';
  pijl.innerHTML = CHEVRON;
  tegel.append(icoon, tekst, pijl);
  tegel.addEventListener('click', () => navigate('#/vrienden'));
  box.appendChild(tegel);
  if (els.screens.delen) box.appendChild(renderDelenTegel());
  if (els.screens.mail) box.appendChild(renderMailTegel());
}

// Een geopend menu bij een rij: { uid, soort: 'vriend'|'verzoek', bevestig: null|'verbreek'|'blokkeer' }.
let vriendMenu = null;
// Laatste melding bovenaan de lijsten na een actie: { tekst, soort: 'succes'|'fout' }.
let vriendenMelding = null;
let vriendenLaadId = 0;

async function laadVrienden() {
  if (!magVrienden()) {
    renderVriendenScherm();
    return;
  }
  const id = ++vriendenLaadId;
  const user = state.user;
  state.vriendenStatus = 'laden';
  renderVriendenScherm();
  try {
    const data = await laadVriendenScherm({ db, fs: firestoreFns, ik: user.uid });
    if (id !== vriendenLaadId || state.user !== user) return;
    state.vrienden = data;
    state.vriendenStatus = 'klaar';
    state.inkomendAantal = data.inkomend.length;
    // Verlopen links van jezelf opruimen (ze werken toch niet meer).
    for (const token of data.verlopenLinks) {
      trekLinkIn({ db, fs: firestoreFns, token }).catch((err) => console.error('Kon een verlopen link niet opruimen:', err));
    }
  } catch (err) {
    if (id !== vriendenLaadId || state.user !== user) return;
    console.error('Kon de vrienden niet laden:', err);
    state.vriendenStatus = 'fout';
  }
  renderVriendenScherm();
  renderProfielTegels();
}

function vriendenTekst(tag, className, tekst) {
  const el = document.createElement(tag);
  el.className = className;
  el.textContent = tekst;
  return el;
}

function kleineKnop(tekst, { primair = false, label = null, onClick }) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'knop-klein' + (primair ? ' knop-klein--primair' : '');
  b.textContent = tekst;
  if (label) b.setAttribute('aria-label', label);
  b.addEventListener('click', onClick);
  return b;
}

// "@naam · Volledige naam"
function persoonTekst(persoon) {
  const p = document.createElement('p');
  p.className = 'vriend-rij-tekst';
  if (persoon.onbekend) {
    p.textContent = 'Onbekende gebruiker';
    return p;
  }
  p.append(vriendenTekst('span', 'vriend-naam', `@${persoon.gebruikersnaam}`), document.createTextNode(` · ${persoon.naam}`));
  return p;
}

// Een actie uitvoeren (knoppen in het scherm even uit), daarna opnieuw laden.
async function vriendActie(fn, succesTekst) {
  const user = state.user;
  for (const b of els.vriendenInhoud.querySelectorAll('button')) b.disabled = true;
  try {
    await fn();
    vriendenMelding = succesTekst ? { tekst: succesTekst, soort: 'succes' } : null;
  } catch (err) {
    console.error('Vriendactie mislukt:', err);
    vriendenMelding = { tekst: err instanceof VriendFout ? err.message : VERBINDING_FOUT, soort: 'fout' };
  }
  if (state.user !== user) return;
  vriendMenu = null;
  await laadVrienden();
}

function vriendRij(persoon, acties, menu = null) {
  const wrap = document.createElement('div');
  wrap.className = 'vriend-item';
  const rij = document.createElement('div');
  rij.className = 'vriend-rij';
  const knoppen = document.createElement('div');
  knoppen.className = 'vriend-rij-acties';
  knoppen.append(...acties);
  if (menu) {
    const open = vriendMenu?.uid === persoon.uid && vriendMenu?.soort === menu.soort;
    const meer = document.createElement('button');
    meer.type = 'button';
    meer.className = 'icon-btn icon-btn--plat';
    meer.innerHTML = MEER_ICOON;
    meer.setAttribute('aria-label', `Opties voor @${persoon.gebruikersnaam ?? 'onbekend'}`);
    meer.setAttribute('aria-expanded', String(open));
    meer.addEventListener('click', () => {
      vriendMenu = open ? null : { uid: persoon.uid, soort: menu.soort, bevestig: null };
      renderVriendenScherm();
      document.querySelector('.vriend-menu button')?.focus();
    });
    knoppen.appendChild(meer);
    if (menu.soort === 'vriend' && !persoon.onbekend) {
      const naarProfiel = document.createElement('button');
      naarProfiel.type = 'button';
      naarProfiel.className = 'vriend-rij-open';
      naarProfiel.setAttribute('aria-label', `Profiel van @${persoon.gebruikersnaam} bekijken`);
      naarProfiel.appendChild(persoonTekst(persoon));
      naarProfiel.addEventListener('click', () => navigate(`#/vriend/${encodeURIComponent(persoon.uid)}`));
      rij.append(naarProfiel, knoppen);
    } else {
      rij.append(persoonTekst(persoon), knoppen);
    }
    wrap.appendChild(rij);
    if (open) wrap.appendChild(renderVriendMenu(persoon, menu));
    return wrap;
  }
  rij.append(persoonTekst(persoon), knoppen);
  wrap.appendChild(rij);
  return wrap;
}

// Menu onder een rij: eerst de keuzes, dan een bevestiging.
function renderVriendMenu(persoon, menu) {
  const box = document.createElement('div');
  box.className = 'vriend-menu';
  const naam = `@${persoon.gebruikersnaam}`;
  const ik = state.user.uid;
  const annuleer = kleineKnop('Annuleren', {
    onClick: () => {
      vriendMenu = null;
      renderVriendenScherm();
    },
  });
  if (vriendMenu.bevestig === 'verbreek') {
    box.append(
      vriendenTekst('p', 'vriend-menu-vraag', `Vriendschap met ${naam} verbreken? ${naam} krijgt daar geen melding van.`),
      kleineKnop('Ja, verbreken', {
        primair: true,
        onClick: () => vriendActie(() => verbreek({ db, fs: firestoreFns, ik, ander: persoon.uid }), `Je bent geen vrienden meer met ${naam}.`),
      }),
      annuleer
    );
    return box;
  }
  if (vriendMenu.bevestig === 'blokkeer') {
    box.append(
      vriendenTekst(
        'p',
        'vriend-menu-vraag',
        `${naam} blokkeren? Jullie zijn dan geen vrienden meer en ${naam} kan je geen verzoek meer sturen of je link gebruiken. ${naam} krijgt daar geen melding van.`
      ),
      kleineKnop('Ja, blokkeren', {
        primair: true,
        onClick: () => vriendActie(() => blokkeer({ db, fs: firestoreFns, ik, ander: persoon }), `${naam} is geblokkeerd.`),
      }),
      annuleer
    );
    return box;
  }
  const kies = (bevestig) => () => {
    vriendMenu = { ...vriendMenu, bevestig };
    renderVriendenScherm();
    document.querySelector('.vriend-menu button')?.focus();
  };
  if (menu.soort === 'vriend') box.appendChild(kleineKnop('Vriendschap verbreken', { onClick: kies('verbreek') }));
  box.append(kleineKnop('Blokkeren', { onClick: kies('blokkeer') }), annuleer);
  return box;
}

function vriendenSectie(titel, items, leegTekst = null) {
  const sectie = document.createElement('section');
  sectie.className = 'vrienden-blok';
  sectie.append(vriendenTekst('h2', 'vrienden-kop', titel));
  if (items.length === 0 && leegTekst) sectie.appendChild(vriendenTekst('p', 'vrienden-leeg', leegTekst));
  sectie.append(...items);
  return sectie;
}

function vriendenFoutBlok(tekst, opnieuw) {
  const box = document.createElement('div');
  box.className = 'profiel-laadfout';
  box.setAttribute('role', 'alert');
  box.append(vriendenTekst('p', '', tekst));
  const knop = document.createElement('button');
  knop.type = 'button';
  knop.className = 'btn-secondary';
  knop.textContent = 'Opnieuw proberen';
  knop.addEventListener('click', opnieuw);
  box.appendChild(knop);
  return box;
}

function renderVriendenScherm() {
  if (!els.screens.vrienden || els.screens.vrienden.hidden) return;
  const inhoud = els.vriendenInhoud;
  inhoud.innerHTML = '';
  els.vriendToevoegen.hidden = !magVrienden();
  if (els.vriendLinkBlok) els.vriendLinkBlok.hidden = !magVrienden();
  renderEigenLinks();

  if (!state.authBekend || (state.user && state.profiel === undefined && !state.profielFout)) {
    inhoud.appendChild(vriendenTekst('p', 'profiel-melding', 'Laden…'));
    return;
  }
  if (state.profielFout) {
    inhoud.appendChild(
      vriendenFoutBlok('Je profiel kon niet worden geladen. Controleer je verbinding en probeer het opnieuw.', async () => {
        await opnieuwProfielLaden();
        laadVrienden();
      })
    );
    return;
  }
  if (!state.profiel) {
    const box = document.createElement('div');
    box.className = 'vrienden-blok';
    box.append(vriendenTekst('p', 'vrienden-leeg', 'Kies eerst een gebruikersnaam. Daarmee kunnen vrienden je vinden.'));
    const knop = document.createElement('button');
    knop.type = 'button';
    knop.className = 'btn-secondary';
    knop.textContent = 'Gebruikersnaam kiezen';
    knop.addEventListener('click', () => navigate('#/profiel/instellen'));
    box.appendChild(knop);
    inhoud.appendChild(box);
    return;
  }
  const data = state.vrienden;
  if (!data) {
    inhoud.appendChild(
      state.vriendenStatus === 'fout'
        ? vriendenFoutBlok('Je vrienden konden niet worden geladen. Controleer je verbinding en probeer het opnieuw.', laadVrienden)
        : vriendenTekst('p', 'profiel-melding', 'Je vrienden worden geladen…')
    );
    return;
  }

  const melding = vriendenMelding ?? (state.vriendenStatus === 'fout' ? { tekst: 'Bijwerken lukte niet; dit is de laatst geladen stand.', soort: 'fout' } : null);
  if (melding) {
    const p = vriendenTekst('p', `vrienden-melding vrienden-melding--${melding.soort}`, melding.tekst);
    p.setAttribute('role', melding.soort === 'fout' ? 'alert' : 'status');
    inhoud.appendChild(p);
  }

  const ik = state.user.uid;
  if (data.inkomend.length) {
    inhoud.appendChild(
      vriendenSectie(
        'Verzoeken voor jou',
        data.inkomend.map((p) =>
          vriendRij(
            p,
            [
              kleineKnop('Accepteren', {
                primair: true,
                label: `Verzoek van @${p.gebruikersnaam} accepteren`,
                onClick: () => vriendActie(() => accepteer({ db, fs: firestoreFns, ik, van: p.uid }), `Je bent nu vrienden met @${p.gebruikersnaam}.`),
              }),
              kleineKnop('Weigeren', {
                label: `Verzoek van @${p.gebruikersnaam} weigeren`,
                onClick: () => vriendActie(() => haalVerzoekWeg({ db, fs: firestoreFns, van: p.uid, naar: ik }), null),
              }),
            ],
            { soort: 'verzoek' }
          )
        )
      )
    );
  }
  if (data.uitgaand.length) {
    inhoud.appendChild(
      vriendenSectie(
        'Verstuurd',
        data.uitgaand.map((p) =>
          vriendRij(p, [
            kleineKnop('Intrekken', {
              label: `Verzoek aan @${p.gebruikersnaam} intrekken`,
              onClick: () => vriendActie(() => haalVerzoekWeg({ db, fs: firestoreFns, van: ik, naar: p.uid }), null),
            }),
          ])
        )
      )
    );
  }
  inhoud.appendChild(
    vriendenSectie(
      'Vrienden',
      data.vrienden.map((p) => vriendRij(p, [], { soort: 'vriend' })),
      'Nog geen vrienden. Voeg iemand toe met de gebruikersnaam, of deel je uitnodigingslink.'
    )
  );
  if (data.geblokkeerd.length) {
    inhoud.appendChild(
      vriendenSectie(
        'Geblokkeerd',
        data.geblokkeerd.map((p) =>
          vriendRij(p, [
            kleineKnop('Deblokkeren', {
              label: `@${p.gebruikersnaam} deblokkeren`,
              onClick: () => vriendActie(() => deblokkeer({ db, fs: firestoreFns, ik, ander: p.uid }), `@${p.gebruikersnaam} is niet meer geblokkeerd.`),
            }),
          ])
        )
      )
    );
  }
}

// ---------- Profiel van een vriend (#/vriend/<uid>) ----------

// uid → { status: 'laden'|'klaar'|'fout', data }; data = uitkomst van
// laadVriendDelen (null = geen vriend). Geleegd bij het openen van Vrienden
// en bij in- of uitloggen; terug van een detailscherm gebruikt de cache.
const vriendProfielCache = new Map();
let vriendItemTerug = '#/vrienden';

async function laadVriendProfiel(uid) {
  if (!magVrienden()) {
    renderVriendProfiel(uid);
    return;
  }
  const huidig = vriendProfielCache.get(uid);
  if (huidig && huidig.status !== 'fout') {
    renderVriendProfiel(uid);
    return;
  }
  const user = state.user;
  vriendProfielCache.set(uid, { status: 'laden', data: null });
  renderVriendProfiel(uid);
  try {
    const data = await laadVriendDelen({ db, fs: firestoreFns, uid });
    if (state.user !== user) return;
    vriendProfielCache.set(uid, { status: 'klaar', data });
  } catch (err) {
    if (state.user !== user) return;
    console.error('Kon het profiel van een vriend niet laden:', err);
    vriendProfielCache.set(uid, { status: 'fout', data: null });
  }
  if (location.hash === `#/vriend/${encodeURIComponent(uid)}`) renderVriendProfiel(uid);
}

const korteDatum = (iso) => {
  const { day, month, year } = parseIsoDate(iso);
  return `${day} ${MONTHS_LONG[month - 1]} ${year}`;
};

// Sleutel van een item van een vriend in onze normalisatie (een vriend met
// een oudere of nieuwere app kan andere sleutels hebben).
function kopieSleutel(item, nv) {
  return nv === NORMALISATIE_VERSIE ? item.sleutel : watchlistSleutel(item.titel);
}

// Eerstvolgende speeldatum in de agenda, of null.
function liveShowVoor(sleutel) {
  const vandaag = todayIsoDate();
  return state.shows.filter((s) => showSleutel(s) === sleutel && s.datum >= vandaag).sort((a, b) => sortKey(a).localeCompare(sortKey(b)))[0] ?? null;
}

function vriendItemRij(vriend, onderdeel, item) {
  const live = liveShowVoor(kopieSleutel(item, vriend[`${onderdeel}Nv`] ?? vriend.nv));
  const knop = document.createElement('button');
  knop.type = 'button';
  knop.className = 'vriend-titel-rij';
  const titel = live ? weergaveTitel(live) : item.titel;
  knop.appendChild(vriendenTekst('span', 'vriend-titel-naam', titel));
  const meta = [item.maker && !makerStaatInTitel(titel, item.maker) ? item.maker : null, item.genre].filter(Boolean).join(' · ');
  if (meta) knop.appendChild(vriendenTekst('span', 'vriend-titel-meta', meta));
  const regel = [];
  const label = [titel];
  if (onderdeel === 'gezien') {
    if (item.beoordeling) {
      regel.push(`★ ${beoordelingTekst(item.beoordeling)}`);
      label.push(`${beoordelingTekst(item.beoordeling)} van 5 sterren`);
    }
    if (item.laatsteBezoek) {
      const keer = item.aantal > 1 ? ` (${item.aantal}×)` : '';
      regel.push(`gezien ${korteDatum(item.laatsteBezoek)}${keer}`);
      label.push(`gezien op ${korteDatum(item.laatsteBezoek)}${item.aantal > 1 ? `, ${item.aantal} keer` : ''}`);
    }
  }
  if (live) {
    regel.push('in de agenda');
    label.push('staat in de agenda');
  }
  if (regel.length) knop.appendChild(vriendenTekst('span', 'vriend-titel-regel', regel.join(' · ')));
  knop.setAttribute('aria-label', label.join(', '));
  knop.addEventListener('click', () => {
    if (live) navigate(`#/show/${encodeURIComponent(live.id)}`);
    else navigate(`#/vriend/${encodeURIComponent(vriend.uid)}/titel/${onderdeel}/${encodeURIComponent(item.sleutel)}`);
  });
  return knop;
}

function vriendOnderdeel(vriend, onderdeel) {
  const sectie = document.createElement('section');
  sectie.className = 'vrienden-blok';
  const kop = document.createElement('div');
  kop.className = 'section-head vriend-sectie-kop';
  const titel = onderdeel === 'gezien' ? 'Gezien' : 'Watchlist';
  kop.appendChild(vriendenTekst('h2', 'vrienden-kop', titel));
  sectie.appendChild(kop);
  const items = vriend[onderdeel];
  if (items === null) {
    sectie.appendChild(vriendenTekst('p', 'vrienden-leeg', `@${vriend.gebruikersnaam} deelt dit niet.`));
    return sectie;
  }
  if (items.length === 0) {
    sectie.appendChild(vriendenTekst('p', 'vrienden-leeg', 'Nog niets.'));
    return sectie;
  }
  if (onderdeel === 'gezien' && items.some((i) => i.beoordeling)) {
    const sorteer = document.createElement('button');
    sorteer.type = 'button';
    sorteer.className = 'link-btn gezien-sorteer';
    sorteer.textContent = gezienOpBeoordeling ? 'Sorteer op laatste bezoek' : 'Sorteer op beoordeling';
    sorteer.setAttribute('aria-pressed', String(gezienOpBeoordeling));
    sorteer.addEventListener('click', () => {
      gezienOpBeoordeling = !gezienOpBeoordeling;
      try {
        localStorage.setItem('podiumagenda:gezienSortering', gezienOpBeoordeling ? 'beoordeling' : 'bezoek');
      } catch {
        // geen opslag: alleen voor deze keer
      }
      renderVriendProfiel(vriend.uid);
      document.querySelector('#vriendInhoud .gezien-sorteer')?.focus();
    });
    kop.appendChild(sorteer);
  }
  const lijst = onderdeel === 'gezien' ? sorteerKopieGezien(items, gezienOpBeoordeling) : sorteerKopieWatchlist(items);
  const ul = document.createElement('div');
  ul.className = 'vriend-titels';
  for (const item of lijst) ul.appendChild(vriendItemRij(vriend, onderdeel, item));
  sectie.appendChild(ul);
  return sectie;
}

function renderVriendProfiel(uid) {
  const box = els.vriendInhoud;
  if (!box || els.screens.vriend.hidden) return;
  box.innerHTML = '';
  const terugNaarVrienden = () => {
    const knop = document.createElement('button');
    knop.type = 'button';
    knop.className = 'btn-secondary';
    knop.textContent = 'Naar Vrienden';
    knop.addEventListener('click', () => navigate('#/vrienden'));
    return knop;
  };
  const cache = vriendProfielCache.get(uid);
  if (!state.authBekend || (state.user && state.profiel === undefined && !state.profielFout) || !cache || cache.status === 'laden') {
    els.vriendTitel.textContent = 'Vriend';
    els.vriendSub.textContent = '';
    box.appendChild(vriendenTekst('p', 'profiel-melding', 'Laden…'));
    return;
  }
  if (cache.status === 'fout') {
    box.appendChild(
      vriendenFoutBlok('Dit profiel kon niet worden geladen. Controleer je verbinding en probeer het opnieuw.', () => laadVriendProfiel(uid))
    );
    return;
  }
  const vriend = cache.data;
  if (!vriend) {
    els.vriendTitel.textContent = 'Vriend';
    els.vriendSub.textContent = '';
    box.append(vriendenTekst('p', 'vrienden-leeg', 'Dit profiel kun je niet (meer) bekijken: jullie zijn geen vrienden.'), terugNaarVrienden());
    return;
  }
  els.vriendTitel.textContent = `@${vriend.gebruikersnaam}`;
  els.vriendSub.textContent = vriend.naam;
  box.append(vriendOnderdeel(vriend, 'gezien'), vriendOnderdeel(vriend, 'watchlist'));
}

// Een voorstelling van een vriend die niet in de agenda staat: titel,
// maker, genre en (bij Gezien) de sterren van de vriend.
function renderVriendItem(vriend, onderdeel, item) {
  vriendItemTerug = `#/vriend/${encodeURIComponent(vriend.uid)}`;
  els.vriendItemTitel.textContent = item.titel;
  els.vriendItemGenre.textContent = item.genre ?? '';
  const maker = item.maker && !makerStaatInTitel(item.titel, item.maker) ? item.maker : null;
  els.vriendItemMaker.textContent = maker ?? '';
  els.vriendItemMaker.hidden = !maker;
  const oordeel = [];
  if (onderdeel === 'gezien') {
    if (item.beoordeling) oordeel.push(`@${vriend.gebruikersnaam} gaf ★ ${beoordelingTekst(item.beoordeling)}`);
    if (item.laatsteBezoek) oordeel.push(`gezien ${korteDatum(item.laatsteBezoek)}${item.aantal > 1 ? ` (${item.aantal}×)` : ''}`);
  } else {
    oordeel.push(`Op de watchlist van @${vriend.gebruikersnaam}`);
  }
  els.vriendItemOordeel.textContent = oordeel.join(' · ');
  els.vriendItemOordeel.hidden = oordeel.length === 0;
}

// ---------- Persoonlijke uitnodigingslinks ----------

const formatLinkTijd = (ms) =>
  new Date(ms).toLocaleString('nl-NL', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

function zetLinkResultaat(inhoud) {
  if (!els.vriendLinkResultaat) return;
  els.vriendLinkResultaat.innerHTML = '';
  if (inhoud) els.vriendLinkResultaat.appendChild(inhoud);
}

// Kopiëren naar het klembord; lukt dat niet, dan false (de link staat er
// dan nog om met de hand te kopiëren).
async function kopieerLink(url) {
  try {
    await navigator.clipboard.writeText(url);
    return true;
  } catch {
    return false;
  }
}

// Delen via het deelmenu van het toestel; geen deelmenu → kopiëren.
// Geeft 'gedeeld' | 'geannuleerd' | 'gekopieerd' | 'mislukt'.
async function deelLink(url) {
  if (typeof navigator.share === 'function') {
    try {
      await navigator.share({ title: 'Podiumagenda', text: 'Word vrienden met me op Podiumagenda:', url });
      return 'gedeeld';
    } catch (err) {
      if (err?.name === 'AbortError') return 'geannuleerd';
      // Bv. NotAllowedError (de tik is "verbruikt" door het opslaan): kopiëren.
    }
  }
  return (await kopieerLink(url)) ? 'gekopieerd' : 'mislukt';
}

const DEEL_MELDING = {
  gedeeld: 'Link gedeeld.',
  gekopieerd: 'Link gekopieerd. Plak hem in een bericht aan je vriend.',
  geannuleerd: 'Niet gedeeld. De link staat hieronder; je kunt hem nog delen of intrekken.',
  mislukt: 'Delen lukte niet. Kopieer de link hieronder met de hand.',
};

// Na het maken: de melding, de link zelf (selecteerbaar) en [Delen] [Kopiëren].
function linkPaneel(url, uitkomst) {
  const box = document.createElement('div');
  box.className = 'vriend-link-paneel';
  const melding = vriendenTekst('p', `vrienden-melding vrienden-melding--${uitkomst === 'mislukt' ? 'fout' : 'succes'}`, DEEL_MELDING[uitkomst]);
  melding.setAttribute('role', 'status');
  const veld = document.createElement('input');
  veld.className = 'veld-input vriend-link-url';
  veld.type = 'text';
  veld.readOnly = true;
  veld.value = url;
  veld.setAttribute('aria-label', 'Uitnodigingslink');
  veld.addEventListener('focus', () => veld.select());
  const knoppen = document.createElement('div');
  knoppen.className = 'vriend-rij-acties vriend-link-knoppen';
  if (typeof navigator.share === 'function') {
    knoppen.appendChild(kleineKnop('Delen', { primair: true, onClick: async () => zetLinkResultaat(linkPaneel(url, await deelLink(url))) }));
  }
  knoppen.appendChild(
    kleineKnop('Kopiëren', { onClick: async () => zetLinkResultaat(linkPaneel(url, (await kopieerLink(url)) ? 'gekopieerd' : 'mislukt')) })
  );
  box.append(melding, veld, knoppen);
  return box;
}

async function onLinkMaken() {
  if (!magVrienden()) return;
  const user = state.user;
  els.vriendLinkMaak.disabled = true;
  zetLinkResultaat(zoekMelding('Link maken…'));
  let url;
  try {
    ({ url } = await maakLink({ db, fs: firestoreFns, ik: user.uid, mijnProfiel: state.profiel, plek: location }));
  } catch (err) {
    console.error('Link maken mislukt:', err);
    els.vriendLinkMaak.disabled = false;
    if (state.user === user) zetLinkResultaat(zoekMelding(VERBINDING_FOUT, 'fout'));
    return;
  }
  els.vriendLinkMaak.disabled = false;
  if (state.user !== user) return;
  zetLinkResultaat(linkPaneel(url, await deelLink(url)));
  laadVrienden();
}

// Je eigen openstaande links: geldig tot …, [Kopiëren] [Intrekken].
function renderEigenLinks() {
  const lijst = els.vriendLinkLijst;
  if (!lijst) return;
  lijst.innerHTML = '';
  const links = state.vrienden?.links ?? [];
  if (!magVrienden() || links.length === 0) return;
  const kop = vriendenTekst('h3', 'vriend-link-kop', links.length === 1 ? 'Openstaande link' : 'Openstaande links');
  lijst.appendChild(kop);
  for (const link of links) {
    const verloopt = linkVerlooptOp(link);
    const tot = verloopt === null ? 'over 7 dagen' : formatLinkTijd(verloopt);
    const rij = document.createElement('div');
    rij.className = 'vriend-rij';
    rij.append(vriendenTekst('p', 'vriend-rij-tekst', `Geldig tot ${tot}`));
    const acties = document.createElement('div');
    acties.className = 'vriend-rij-acties';
    const url = linkUrl(link.token, location);
    acties.append(
      kleineKnop('Kopiëren', {
        label: `Link (geldig tot ${tot}) kopiëren`,
        onClick: async () => zetLinkResultaat(linkPaneel(url, (await kopieerLink(url)) ? 'gekopieerd' : 'mislukt')),
      }),
      kleineKnop('Intrekken', {
        label: `Link (geldig tot ${tot}) intrekken`,
        onClick: () => {
          zetLinkResultaat(null);
          vriendActie(() => trekLinkIn({ db, fs: firestoreFns, token: link.token }), 'Link ingetrokken. Hij werkt niet meer.');
        },
      })
    );
    rij.appendChild(acties);
    lijst.appendChild(rij);
  }
}

// ---------- Een geopende uitnodigingslink (#/vriend-link/<token>) ----------

async function laadVriendLink() {
  const huidig = state.vriendLink;
  if (!huidig || ['bezig', 'gelukt'].includes(huidig.status)) {
    renderVriendLink();
    return;
  }
  if (!magVrienden()) {
    renderVriendLink();
    return;
  }
  const user = state.user;
  state.vriendLink = { ...huidig, status: 'laden' };
  renderVriendLink();
  try {
    const uitkomst = await bekijkLink({ db, fs: firestoreFns, ik: user.uid, token: huidig.token });
    if (state.user !== user || state.vriendLink?.token !== huidig.token) return;
    state.vriendLink = { token: huidig.token, status: 'klaar', uitkomst };
  } catch (err) {
    if (state.user !== user || state.vriendLink?.token !== huidig.token) return;
    console.error('Kon de uitnodigingslink niet bekijken:', err);
    state.vriendLink = { token: huidig.token, status: 'fout', uitkomst: null };
  }
  renderVriendLink();
}

const LINK_MELDING = {
  ongeldig: 'Deze link werkt niet (meer). Hij is al gebruikt, ingetrokken of bestaat niet. Vraag je vriend om een nieuwe link.',
  verlopen: 'Deze link is verlopen: een uitnodigingslink is 7 dagen geldig. Vraag je vriend om een nieuwe link.',
  eigen: 'Dit is je eigen uitnodigingslink. Stuur hem naar iemand die je als vriend wilt toevoegen.',
};

function renderVriendLink() {
  const box = els.vriendLinkInhoud;
  if (!box || els.screens.vriendLink.hidden) return;
  box.innerHTML = '';
  const knop = (tekst, klasse, onClick) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = klasse;
    b.textContent = tekst;
    b.addEventListener('click', onClick);
    return b;
  };
  const naarVrienden = () => knop('Naar Vrienden', 'btn-secondary', () => navigate('#/vrienden'));

  if (!state.authBekend || (state.user && state.profiel === undefined && !state.profielFout)) {
    box.appendChild(vriendenTekst('p', 'profiel-melding', 'Laden…'));
    return;
  }
  if (!state.user) {
    box.append(vriendenTekst('p', 'vrienden-leeg', 'Je bent uitgenodigd om vrienden te worden. Log in om de uitnodiging te bekijken.'));
    const inloggen = knop('', 'google-btn', handleSignIn);
    inloggen.innerHTML = GOOGLE_ICON_SVG;
    inloggen.appendChild(vriendenTekst('span', '', 'Inloggen met Google'));
    box.appendChild(inloggen);
    if (state.authError) box.appendChild(vriendenTekst('p', 'auth-error', state.authError));
    return;
  }
  if (state.profielFout) {
    box.appendChild(
      vriendenFoutBlok('Je profiel kon niet worden geladen. Controleer je verbinding en probeer het opnieuw.', opnieuwProfielLaden)
    );
    return;
  }
  if (!state.profiel) {
    box.append(
      vriendenTekst('p', 'vrienden-leeg', 'Kies eerst een gebruikersnaam. Daarna kun je de uitnodiging accepteren.'),
      knop('Gebruikersnaam kiezen', 'btn-secondary', () => navigate('#/profiel/instellen'))
    );
    return;
  }

  const vl = state.vriendLink;
  if (!vl || vl.status === 'leeg' || vl.status === 'laden') {
    box.appendChild(vriendenTekst('p', 'profiel-melding', 'Uitnodiging bekijken…'));
    return;
  }
  if (vl.status === 'fout') {
    box.appendChild(vriendenFoutBlok('De uitnodiging kon niet worden geladen. Controleer je verbinding en probeer het opnieuw.', () => {
      state.vriendLink = { token: vl.token, status: 'leeg', uitkomst: null };
      laadVriendLink();
    }));
    return;
  }
  const link = vl.uitkomst?.link;
  const naam = link ? `@${link.gebruikersnaam}` : '';
  if (vl.status === 'gelukt') {
    const p = vriendenTekst('p', 'vrienden-melding vrienden-melding--succes', `Je bent nu vrienden met ${naam}.`);
    p.setAttribute('role', 'status');
    box.append(p, naarVrienden());
    return;
  }
  if (vl.fout) {
    const p = vriendenTekst('p', 'vrienden-melding vrienden-melding--fout', vl.fout);
    p.setAttribute('role', 'alert');
    box.appendChild(p);
  }
  const status = vl.uitkomst.status;
  if (LINK_MELDING[status]) {
    box.append(vriendenTekst('p', 'vrienden-leeg', LINK_MELDING[status]), naarVrienden());
    return;
  }
  if (status === 'vrienden') {
    box.append(vriendenTekst('p', 'vrienden-leeg', `Je bent al vrienden met ${naam}.`), naarVrienden());
    return;
  }
  if (status === 'jij-blokkeert') {
    box.append(vriendenTekst('p', 'vrienden-leeg', `Je hebt ${naam} geblokkeerd. Deblokkeer ${naam} eerst onder Vrienden.`), naarVrienden());
    return;
  }
  // Geweigerd bij "Ja" (status 'gebruikt'): alleen de melding hierboven.
  // Bij een netwerkfout blijft de status 'ok' en kun je het opnieuw proberen.
  if (status !== 'ok') {
    box.appendChild(naarVrienden());
    return;
  }
  box.append(
    vriendenTekst('h2', 'vrienden-kop', `Word vrienden met ${naam}?`),
    vriendenTekst('p', 'vriend-link-naam', link.naam),
    vriendenTekst('p', 'vrienden-leeg', `Jullie kunnen dan elkaars gebruikersnaam en naam zien. Je kunt de vriendschap later altijd verbreken.`)
  );
  const knoppen = document.createElement('div');
  knoppen.className = 'profiel-knoppen';
  const ja = knop('Ja, word vrienden', 'btn-primary', onLinkAccepteren);
  ja.disabled = vl.status === 'bezig';
  if (vl.status === 'bezig') ja.textContent = 'Bezig…';
  knoppen.append(ja, knop('Nee, dank je', 'btn-secondary', () => terug('#/profiel')));
  box.appendChild(knoppen);
}

async function onLinkAccepteren() {
  const vl = state.vriendLink;
  if (!magVrienden() || vl?.uitkomst?.status !== 'ok') return;
  const user = state.user;
  state.vriendLink = { ...vl, status: 'bezig', fout: null };
  renderVriendLink();
  try {
    await gebruikLink({ db, fs: firestoreFns, ik: user.uid, link: vl.uitkomst.link });
    if (state.user !== user) return;
    state.vriendLink = { ...vl, status: 'gelukt', fout: null };
    state.vrienden = null;
  } catch (err) {
    if (state.user !== user) return;
    if (!(err instanceof VriendFout)) console.error('Link gebruiken mislukt:', err);
    // Geweigerd (gebruikt, ingetrokken, of een blokkade door de eigenaar):
    // neutraal, en niet opnieuw proberen. Netwerk: opnieuw kan.
    state.vriendLink = err instanceof VriendFout
      ? { ...vl, status: 'klaar', fout: err.message, uitkomst: { ...vl.uitkomst, status: 'gebruikt' } }
      : { ...vl, status: 'klaar', fout: VERBINDING_FOUT };
  }
  renderVriendLink();
}

// ---------- Vriend zoeken op exacte gebruikersnaam ----------

function zetZoekResultaat(inhoud) {
  if (!els.vriendZoekResultaat) return;
  els.vriendZoekResultaat.innerHTML = '';
  if (inhoud) els.vriendZoekResultaat.appendChild(inhoud);
}

function zoekMelding(tekst, soort = 'info') {
  const p = vriendenTekst('p', `vrienden-melding vrienden-melding--${soort}`, tekst);
  if (soort === 'fout') p.setAttribute('role', 'alert');
  return p;
}

async function onVriendZoeken(e) {
  e.preventDefault();
  if (!magVrienden()) return;
  const user = state.user;
  zetZoekResultaat(zoekMelding('Zoeken…'));
  let gevonden;
  try {
    gevonden = await zoekGebruiker({ db, fs: firestoreFns, invoer: els.vriendZoekInput.value });
  } catch (err) {
    if (state.user !== user) return;
    if (!(err instanceof VriendFout)) console.error('Zoeken mislukt:', err);
    zetZoekResultaat(zoekMelding(err instanceof VriendFout ? err.message : VERBINDING_FOUT, 'fout'));
    return;
  }
  if (state.user !== user) return;
  if (!gevonden) {
    zetZoekResultaat(zoekMelding('Niemand gevonden met deze gebruikersnaam.'));
    return;
  }
  if (gevonden.uid === user.uid) {
    zetZoekResultaat(zoekMelding('Dat ben je zelf.'));
    return;
  }
  const data = state.vrienden;
  const kaart = document.createElement('div');
  kaart.className = 'vriend-rij vriend-rij--kaart';
  const acties = document.createElement('div');
  acties.className = 'vriend-rij-acties';
  if (data?.vrienden.some((v) => v.uid === gevonden.uid)) {
    acties.appendChild(vriendenTekst('span', 'vriend-status', 'Al vrienden'));
  } else if (data?.uitgaand.some((v) => v.uid === gevonden.uid)) {
    acties.appendChild(vriendenTekst('span', 'vriend-status', 'Verzoek verstuurd'));
  } else if (data?.inkomend.some((v) => v.uid === gevonden.uid)) {
    // stuurVerzoek accepteert dan het bestaande verzoek.
    acties.append(
      vriendenTekst('span', 'vriend-status', 'Heeft jou een verzoek gestuurd'),
      kleineKnop('Accepteren', {
        primair: true,
        label: `Verzoek van @${gevonden.gebruikersnaam} accepteren`,
        onClick: (ev) => onVerzoekSturen(gevonden, ev.currentTarget),
      })
    );
  } else {
    acties.appendChild(
      kleineKnop('Verzoek sturen', {
        primair: true,
        label: `Vriendschapsverzoek sturen aan @${gevonden.gebruikersnaam}`,
        onClick: (ev) => onVerzoekSturen(gevonden, ev.currentTarget),
      })
    );
  }
  kaart.append(persoonTekst(gevonden), acties);
  zetZoekResultaat(kaart);
}

async function onVerzoekSturen(gevonden, knop) {
  const user = state.user;
  knop.disabled = true;
  const naam = `@${gevonden.gebruikersnaam}`;
  try {
    const uitkomst = await stuurVerzoek({ db, fs: firestoreFns, ik: user.uid, mijnProfiel: state.profiel, ander: gevonden });
    if (state.user !== user) return;
    zetZoekResultaat(
      zoekMelding(uitkomst === 'vrienden' ? `Jullie zijn nu vrienden: ${naam} had jou al een verzoek gestuurd.` : `Verzoek verstuurd aan ${naam}.`, 'succes')
    );
    els.vriendZoekInput.value = '';
  } catch (err) {
    if (state.user !== user) return;
    if (!(err instanceof VriendFout)) console.error('Verzoek sturen mislukt:', err);
    zetZoekResultaat(zoekMelding(err instanceof VriendFout ? err.message : VERBINDING_FOUT, 'fout'));
  }
  vriendenMelding = null;
  laadVrienden();
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
  const profielRegel = renderProfielRegel();
  if (profielRegel) els.authBox.appendChild(profielRegel);

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

// De zoekbalk in de kop is alleen voor de telefoon (< 900 px). Open/dicht
// is een class op .header-top; alleen de CSS onder 900 px reageert erop.
// Op desktop zoek je via de sidebar, ook na het wisselen van breedte, en ook
// met een herstelde zoekterm (tot 30 sep 2026 verscheen de balk daar dan
// naast het sidebarveld, en verdween de titel).
function zetZoekbalkOpen(open) {
  els.headerSearch.closest('.header-top').classList.toggle('zoekbalk-open', open);
}

function openSearch() {
  zetZoekbalkOpen(true);
  els.searchInput.focus();
}

function closeSearch() {
  clearTimeout(searchDebounceTimer);
  els.searchInput.value = '';
  els.sidebarSearchInput.value = '';
  state.searchQuery = '';
  state.searchQueryRaw = '';
  zetZoekbalkOpen(false);
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
  // Getypt in de sidebar (desktop): bij smaller maken van het venster de
  // telefoonbalk tonen zolang er een zoekterm is, zodat er nooit stil
  // gefilterd wordt.
  if (source === els.sidebarSearchInput) zetZoekbalkOpen(source.value.trim() !== '');

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

function onHideGezienToggleClick() {
  state.hideGezien = !state.hideGezien;
  renderHideGezienToggle();
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
  state.hideGezien = false;
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
  const present = GENRE_CATEGORIES.filter((g) => state.shows.some((s) => getGenres(s).includes(g)));

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
  renderHideGezienToggle();
}

function renderHideGezienToggle() {
  for (const btn of [els.hideGezienToggle, els.sidebarHideGezienToggle]) {
    if (!btn) continue;
    btn.classList.toggle('is-on', state.hideGezien);
    btn.setAttribute('aria-checked', String(state.hideGezien));
  }
}

function renderFilterBadge() {
  const count =
    (state.selectedCities.size > 0 ? 1 : 0) +
    (state.selectedTheaters.size > 0 ? 1 : 0) +
    (state.selectedGenres.size > 0 ? 1 : 0) +
    (state.podiumpasOnly ? 1 : 0) +
    (state.watchlistOnly ? 1 : 0) +
    (state.hideFullOnly ? 1 : 0) +
    (state.hideGezien ? 1 : 0);
  els.filterBadge.textContent = String(count);
  els.filterBadge.hidden = count === 0;
}

function makeChip(label, active, onClick, { podiumpas = false } = {}) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'chip' + (active ? ' is-active' : '') + (podiumpas ? ' chip--podiumpas' : '');
  btn.textContent = label;
  // Podiumpas voor déze speeldatum (bij gemengde dekking per chip).
  if (podiumpas) btn.appendChild(makePodiumpasIcon());
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
    // Op alle genres van de productie (show.genres); het label toont het
    // weergavegenre (show.genre).
    const genreOk = matchtGenreFilter(s, state.selectedGenres);
    const podiumpasOk = !state.podiumpasOnly || s.podiumpas === true;
    const watchlistOk = !state.watchlistOnly || isOpWatchlist(s);
    const gezienOk = !state.hideGezien || !isGezien(s);
    // 'onbekend' blijft altijd zichtbaar — we weten domweg niet of die vol
    // is, en dat is iets anders dan bevestigd vol (uitverkocht/wachtlijst).
    // Afgelast en verplaatst zijn ook niet te boeken: die gaan mee weg.
    // Een voorstelling met alleen volle data verdwijnt dan helemaal, en de
    // tellers tellen ze niet mee (ze gaan allemaal via deze filter).
    const fullOk = !state.hideFullOnly || (!isVol(s) && !isVervallen(s));
    // Ondergrens geldt altijd, ook met ignoreDateWindow (dat heft alleen de
    // voorwaartse 30-dagen-grens op via "toon meer" — verleden tijd tonen we
    // nooit, dat is geen "meer", dat is gewoon verlopen data).
    const dateOk = s.datum >= minDate && (maxDate == null || s.datum <= maxDate);
    const searchOk =
      !state.searchQuery ||
      s.titel.toLowerCase().includes(state.searchQuery) ||
      // Ook op de titel zoals het theater hem schrijft (weergave op meerderheid).
      (s.titelBron ?? '').toLowerCase().includes(state.searchQuery) ||
      s.theaterNaam.toLowerCase().includes(state.searchQuery) ||
      (THEATER_ZOEKALIASSEN[s.theaterId] ?? []).some((alias) => alias.includes(state.searchQuery));
    return cityOk && theaterOk && genreOk && podiumpasOk && watchlistOk && gezienOk && fullOk && dateOk && searchOk;
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
    state.hideFullOnly ||
    state.hideGezien;
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
  titleText.textContent = weergaveTitel(show);
  title.appendChild(titleText);

  const meta = document.createElement('p');
  meta.className = 'show-meta';
  // Externe locatie (bv. De Maaspoort in "Theater De Garage | Venlo"): de
  // plek zelf erbij, zonder het adres.
  // Of de zaal in het eigen gebouw (bv. Cpunt "Kleine Pier").
  const plek = show.locatie ? show.locatie.split('|')[0].trim() : show.zaal ?? null;
  meta.textContent = [show.theaterNaam, show.stad, plek].filter(Boolean).join(' · ');

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
  if (isGezien(show)) tagsRow.appendChild(makeGezienTag(show));

  info.append(title, meta, tagsRow);
  if (isVervallen(show)) row.classList.add('show-row--vervallen');

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

  // online: true (30 sep 2026): reserveren met de pas kan wél online (tarief
  // "Podiumpas" in de gewone kaartverkoop); dan alleen uitleg, en de
  // reserveerknop blijft de gewone.
  const title = document.createElement('strong');
  title.textContent = info.online ? 'Met je Podiumpas reserveer je hier online' : 'Met je Podiumpas reserveer je hier niet online';
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
  if (info.online) line.append('Of ');
  ways.forEach(([verb, a], i) => {
    if (i > 0) line.append(i === ways.length - 1 ? ' of ' : ', ');
    line.append(i === 0 && !info.online ? verb[0].toUpperCase() + verb.slice(1) : verb, a);
  });
  line.append('.');

  const extra = document.createElement('span');
  extra.className = 'podiumpas-notice__toelichting';
  extra.textContent = info.toelichting ?? '';
  // Online: eerst de uitleg, dan "Of bel …"; anders eerst hoe het wel kan.
  const delen = info.online ? [extra, ways.length ? line : null] : [ways.length ? line : null, extra];
  box.append(...delen.filter((d) => d && d.textContent));
  return !info.online;
}

function renderDetail(show) {
  els.detailGenre.textContent = getGenreBucket(show);
  els.detailTheater.textContent = show.theaterNaam;
  els.detailPodiumpasBadge.hidden = show.podiumpas !== true;
  els.detailTitle.textContent = show.titel;
  // De maker niet nog eens tonen als hij al in de titel staat.
  els.detailMaker.textContent = show.maker ?? '';
  els.detailMaker.hidden = !show.maker || makerStaatInTitel(show.titel, show.maker);
  els.detailDate.textContent = formatDateLong(show.datum);
  els.detailTime.textContent = show.tijd ? `${show.tijd} uur` : 'Tijd volgt nog';

  const adres = THEATER_INFO[show.theaterId]?.adres;
  // Externe locatie: die plek (met adres als de bron het geeft), namens het theater.
  const naamMetZaal = show.zaal ? `${show.theaterNaam} (${show.zaal})` : show.theaterNaam;
  els.detailAddress.textContent = show.locatie
    ? `${show.locatie.split('|').map((d) => d.trim()).join(', ')} (via ${show.theaterNaam})`
    : adres
      ? `${naamMetZaal}, ${adres}, ${show.stad}`
      : `${naamMetZaal}, ${show.stad}`;

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
  // Afgelast of verplaatst: niet boekbaar, niet in je agenda zetten.
  const vervallen = isVervallen(show);
  els.detailVervallenNotice.hidden = !vervallen;
  els.detailVervallenNotice.textContent = vervallen ? vervallenUitleg(show) : '';
  els.detailReserveBtn.hidden = vervallen;
  els.detailAddCalendar.hidden = vervallen;

  renderWatchButtons(show);
  renderPlanControls(show);
  renderOtherDates(show);
  renderRelatedTheaters(show);

  els.detailWatchIcon.onclick = () => toggleWatchlist(show);
  els.detailWatchBtn.onclick = () => toggleWatchlist(show);
  renderGezienButton(show);
  renderDetailGezien(show);
  if (els.detailGezienBtn) els.detailGezienBtn.onclick = () => toggleGezien(show);

  els.detailAddCalendar.onclick = () => downloadIcs(show);
}

function vervallenUitleg(show) {
  return show.beschikbaarheid === 'verplaatst'
    ? `Het theater heeft deze voorstelling verplaatst. Kijk op de site van ${show.theaterNaam} voor de nieuwe datum.`
    : `Het theater heeft deze voorstelling afgelast. Had je kaarten? Kijk op de site van ${show.theaterNaam} wat er met je kaarten gebeurt.`;
}

function renderGezienButton(show) {
  if (!els.detailGezienBtn) return;
  const gezien = isGezien(show);
  els.detailGezienBtn.classList.toggle('is-on', gezien);
  els.detailGezienBtn.setAttribute('aria-pressed', String(gezien));
  const label = gezien ? '✓ Gezien' : 'Gezien';
  if (els.detailGezienLabel) els.detailGezienLabel.textContent = label;
  else els.detailGezienBtn.textContent = label;
}

// Handmatig aan/uit (detailscherm). Aan: ook van de watchlist, met een
// melding om beide terug te draaien. Uit: alleen van Gezien.
function toggleGezien(show) {
  if (isGezien(show)) {
    state.gezien = haalUitGezien(state.gezien, showSleutel(show));
    saveGezien();
  } else {
    markeerGezien(show);
  }
  renderGezienButton(show);
  renderDetailGezien(show);
  renderWatchButtons(show);
  renderAgenda();
}

/**
 * Handmatig op Gezien zetten (detailscherm of watchlist in Profiel): ook van
 * de watchlist, en een melding met "Ongedaan maken" die beide terugdraait
 * (via tombstone en een nieuwe toevoeging, zodat het ook over apparaten
 * heen klopt).
 */
function markeerGezien(show, naAfloop = () => {}) {
  const sleutel = showSleutel(show);
  const watchItem = (state.watchlist?.watchlist ?? []).find((i) => i.sleutel === sleutel) ?? null;
  // Voorbije speeldatum (staat nog in de data tot de nachtelijke run):
  // meteen het bezoek bewaren, alsof het uit de planning kwam.
  const bezoek = show.datum && isVoorbij(show.datum) ? bezoekUitShow(show) : null;
  state.gezien = zetGezien(state.gezien, { show, bron: 'handmatig', bezoek });
  saveGezien();
  if (watchItem) {
    state.watchlist = verwijder(state.watchlist, sleutel);
    saveWatchlist();
  }
  toonMelding(watchItem ? 'Gezien · van je watchlist gehaald' : 'Gezien', () => {
    state.gezien = haalUitGezien(state.gezien, sleutel);
    saveGezien();
    if (watchItem) {
      state.watchlist = voegToe(state.watchlist, { titel: watchItem.titel, theaterId: watchItem.theaterId, maker: watchItem.maker ?? null, genre: watchItem.genre ?? null });
      saveWatchlist();
    }
    naAfloop();
  });
  naAfloop();
}

// Korte melding onderaan met één actie. Het element maakt app.js zelf aan,
// zodat het niet van index.html afhangt.
let meldingTimer = null;
function toonMelding(tekst, ongedaanMaken) {
  let el = document.getElementById('melding');
  if (!el) {
    el = document.createElement('div');
    el.id = 'melding';
    el.className = 'melding';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    document.body.appendChild(el);
  }
  el.replaceChildren();
  const t = document.createElement('span');
  t.textContent = tekst;
  // Zonder ongedaanMaken: alleen een korte bevestiging ("Opgeslagen").
  if (!ongedaanMaken) {
    el.append(t);
    el.hidden = false;
    clearTimeout(meldingTimer);
    meldingTimer = setTimeout(() => {
      el.hidden = true;
    }, 2500);
    return;
  }
  const knop = document.createElement('button');
  knop.type = 'button';
  knop.className = 'melding-actie';
  knop.textContent = 'Ongedaan maken';
  knop.addEventListener('click', () => {
    el.hidden = true;
    clearTimeout(meldingTimer);
    ongedaanMaken();
    const hash = location.hash || '#/';
    if (hash.startsWith('#/show/')) {
      const show = state.shows.find((s) => s.id === decodeURIComponent(hash.slice('#/show/'.length)));
      if (show) {
        renderGezienButton(show);
        renderDetailGezien(show);
        renderWatchButtons(show);
      }
    }
    if (hash === '#/profiel') renderProfielScreen();
    renderAgenda();
  });
  el.append(t, knop);
  el.hidden = false;
  clearTimeout(meldingTimer);
  meldingTimer = setTimeout(() => {
    el.hidden = true;
  }, 8000);
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
  // Zelfde theater als de hoofdregel (daar staat het vinkje al); alleen bij
  // gemengde dekking (bv. De Maaspoort: externe locatie, prijs) per datum.
  const gemengd = new Set(related.map((s) => s.podiumpas === true)).size > 1;
  for (const s of related) els.detailOtherDates.appendChild(datumChip(s, { actief: s.id === show.id, gemengd }));
}

// Eén datumblokje in het detailscherm. Uitverkocht of wachtlijst: grijs,
// doorgestreept en niet te kiezen (een uitgeschakelde knop: niet focusbaar,
// wel voorgelezen als "za 18 okt 20:15, uitverkocht").
function datumChip(s, { actief = false, gemengd = false } = {}) {
  const wanneer = s.tijd ? `${formatDateShort(s.datum)}, ${s.tijd}` : formatDateShort(s.datum);
  if (isVol(s)) return makeVolChip(s, wanneer, actief);
  const label = isVervallen(s) ? `${wanneer} (${s.beschikbaarheid})` : wanneer;
  // Een andere datum van dezelfde voorstelling vervangt de huidige plek in
  // de geschiedenis (okt 2026): terug gaat dan meteen naar waar je vandaan
  // kwam (Agenda, Profiel, Berichten, …), niet langs elke bekeken datum.
  return makeChip(label, actief, () => vervang(`#/show/${encodeURIComponent(s.id)}`), { podiumpas: gemengd && s.podiumpas === true });
}

function makeVolChip(s, wanneer, actief) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.disabled = true;
  btn.className = `chip chip--vol${actief ? ' is-active' : ''}`;
  btn.setAttribute('aria-disabled', 'true');
  if (actief) btn.setAttribute('aria-current', 'true');
  const dag = WEEKDAYS[dateFromIso(s.datum).getDay()];
  btn.setAttribute('aria-label', `${dag} ${formatDateShort(s.datum)}${s.tijd ? ` ${s.tijd}` : ''}, ${s.beschikbaarheid}`);
  const datum = document.createElement('span');
  datum.className = 'chip-vol-datum';
  datum.textContent = wanneer;
  const reden = document.createElement('span');
  reden.className = 'chip-vol-reden';
  reden.textContent = s.beschikbaarheid;
  btn.append(datum, reden);
  return btn;
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
    // Podiumpas per speeldatum: geldt het voor alle data, dan achter de
    // theaternaam; gemengd, dan alleen bij de data waar het geldt.
    const allemaal = shows.every((x) => x.podiumpas === true);
    const gemengd = !allemaal && shows.some((x) => x.podiumpas === true);
    if (allemaal) name.appendChild(makePodiumpasIcon());
    group.appendChild(name);

    const row = document.createElement('div');
    row.className = 'filter-row filter-row--wrap';
    row.setAttribute('role', 'group');
    row.setAttribute('aria-label', shows[0].theaterNaam);
    for (const s of shows) row.appendChild(datumChip(s, { gemengd }));
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

/** Vinkje bij de provinciekop (okt 2026): alle theaters van de provincie
 * in één keer aan of uit. Aan, uit of deels (indeterminate, voorgelezen als
 * "gemengd"); een tik bij deels zet alles aan. Eén opslag per tik, net als
 * de schakelaars per theater en per stad. */
function buildProvincieVinkje(provincie, ids, alleIds = ids) {
  const aan = ids.filter((id) => state.enabledTheaters[id] !== false).length;
  const label = document.createElement('label');
  label.className = 'provincie-vinkje';
  const vak = document.createElement('input');
  vak.type = 'checkbox';
  vak.className = 'provincie-vak';
  vak.dataset.provincie = provincie;
  vak.checked = aan === ids.length;
  vak.indeterminate = aan > 0 && aan < ids.length;
  vak.setAttribute('aria-label', `Alle theaters in ${provincie}`);
  vak.addEventListener('change', () => {
    const nieuw = aan !== ids.length;
    for (const id of alleIds) state.enabledTheaters[id] = nieuw;
    refreshAfterTheaterToggle();
    // Het scherm is opnieuw opgebouwd: de focus terug op dit vinkje.
    [...els.theatersList.querySelectorAll('.provincie-vak')].find((v) => v.dataset.provincie === provincie)?.focus();
  });
  const tekst = document.createElement('span');
  tekst.textContent = 'Alle';
  label.append(tekst, vak);
  return label;
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
    const kop = document.createElement('div');
    kop.className = 'theaters-province-head';
    const heading = document.createElement('h2');
    heading.className = 'theaters-province-heading';
    heading.textContent = provincie;
    kop.appendChild(heading);
    // De stand (aan/uit/deels) telt, net als "Alles aan/uit" per stad, alleen
    // theaters met voorstellingen (met een schakelaar). Een tik zet ook de
    // gepauzeerde of gesloten theaters van de provincie: komen die terug,
    // dan volgen ze je keuze.
    const alleIds = stedenByProvincie.get(provincie).flatMap((stad) => idsByStad.get(stad));
    const ids = alleIds.filter((id) => state.shows.some((s) => s.theaterId === id));
    if (ids.length > 0) kop.appendChild(buildProvincieVinkje(provincie, ids, alleIds));
    els.theatersList.appendChild(kop);

    for (const stad of stedenByProvincie.get(provincie)) {
      els.theatersList.appendChild(buildCitySection(stad, idsByStad.get(stad)));
    }
  }
}

// ---------- Profiel: watchlist ----------

/** Eén rij per watchlist-item, met de eerstvolgende voorstelling over alle
 * theaters heen en de stand (watchlistStand): "Afgelast", "2 van 5 data
 * afgelast" of "Niet meer in de agenda". Nooit stil weglaten, en altijd te
 * openen en te verwijderen. */
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
  // Eén regel per watchlist-item: items die samen uit één item zijn ontstaan
  // (groepeerWatchlist) staan samen op één regel, met al hun voorstellingen.
  for (const items of groepeerWatchlist(state.watchlist?.watchlist ?? [])) {
    const [item] = items;
    const shows = items.flatMap((i) => perSleutel.get(i.sleutel) ?? []);
    const stand = watchlistStand(shows, vandaag);
    const soonest = stand.soonest;
    // Theaters waar hij nog doorgaat (of, helemaal afgelast, waar hij stond).
    const relevant = shows.filter((s) => s.datum >= vandaag && (soonest ? !isVervallen(s) : true));
    const theaters = new Set(relevant.map((s) => s.theaterId));
    const eerste = stand.eerste;
    productions.push({
      item,
      items,
      key: item.sleutel,
      stand,
      titel: eerste ? weergaveTitel(eerste) : weergaveTitel({ titel: item.titel, maker: item.maker }),
      theaterNaam: eerste
        ? theaters.size > 1
          ? `${eerste.theaterNaam} en ${theaters.size - 1} ander${theaters.size === 2 ? '' : 'e'} theater${theaters.size === 2 ? '' : 's'}`
          : eerste.theaterNaam
        : item.theaterId ? theaterDisplayName(item.theaterId) : '',
      podiumpas: soonest?.podiumpas,
      soonest,
    });
  }

  // Komende eerst (op datum), dan helemaal afgelast, dan niet meer in de agenda.
  const groep = (p) => ({ komend: 0, vervallen: 1, weg: 2 })[p.stand.soort];
  productions.sort((a, b) => {
    if (groep(a) !== groep(b)) return groep(a) - groep(b);
    if (a.stand.eerste && b.stand.eerste) return sortKey(a.stand.eerste).localeCompare(sortKey(b.stand.eerste));
    return a.titel.localeCompare(b.titel, 'nl');
  });

  return productions;
}

function renderProductionRow(production) {
  const { stand } = production;
  const row = document.createElement('button');
  row.type = 'button';
  row.className = 'show-row' + (stand.soort === 'komend' ? '' : ' show-row--vervallen');
  // Komend of afgelast: het detailscherm (daar staat "Afgelast"); niet meer
  // in de agenda: het eenvoudige scherm met de bladwijzer.
  row.addEventListener('click', () =>
    navigate(stand.eerste ? `#/show/${encodeURIComponent(stand.eerste.id)}` : `#/watchlist/${encodeURIComponent(production.key)}`)
  );

  const dot = document.createElement('span');
  dot.className = 'show-dot';
  dot.setAttribute('aria-hidden', 'true');

  const info = document.createElement('span');
  info.className = 'show-info';

  const title = document.createElement('p');
  title.className = 'show-title';
  const titleText = document.createElement('span');
  titleText.className = 'show-title-text';
  titleText.textContent = production.titel;
  title.appendChild(titleText);

  const metaRow = document.createElement('div');
  metaRow.className = 'show-meta-row';

  const meta = document.createElement('p');
  meta.className = 'show-meta';
  const wanneer = stand.eerste ? `${formatDateShort(stand.eerste.datum)} · ` : '';
  meta.textContent = `${wanneer}${production.theaterNaam}`;
  metaRow.appendChild(meta);

  if (production.podiumpas === true) metaRow.appendChild(makePodiumpasIcon());

  info.append(title, metaRow);
  if (stand.label) {
    const flag = document.createElement('span');
    flag.className = 'plan-flag watchlist-stand';
    flag.textContent = stand.label;
    info.appendChild(flag);
  }
  row.append(dot, info);

  const chevron = svgIcon('<polyline points="9 6 15 12 9 18" />');
  chevron.classList.add('show-chevron');
  row.appendChild(chevron);

  return row;
}

// Watchlist-rij in Profiel met rechts "Gezien" en een eigen knop om het
// item te verwijderen (een knop kan niet in de rij-knop zelf). Die werkt
// altijd, ook als de voorstelling afgelast is of niet meer in de agenda staat.
function renderWatchlistItem(production) {
  const wrap = document.createElement('div');
  wrap.className = 'watchlist-item';
  const actie = document.createElement('button');
  actie.type = 'button';
  actie.className = 'link-btn watchlist-gezien';
  actie.textContent = 'Gezien';
  actie.setAttribute('aria-label', `${production.titel} als gezien markeren`);
  actie.addEventListener('click', () => {
    const show = production.soonest ?? { titel: production.item.titel, theaterId: production.item.theaterId, maker: production.item.maker, genre: production.item.genre };
    // De andere items van deze regel (groepeerWatchlist) gaan ook van de watchlist.
    const anderen = (production.items ?? []).filter((i) => i.sleutel !== showSleutel(show));
    if (anderen.length) {
      for (const i of anderen) state.watchlist = verwijder(state.watchlist, i.sleutel);
      saveWatchlist();
    }
    markeerGezien(show, () => {
      renderProfielScreen();
      renderAgenda();
    });
  });
  const weg = document.createElement('button');
  weg.type = 'button';
  weg.className = 'icon-btn icon-btn--plat watchlist-weg';
  weg.setAttribute('aria-label', `Verwijder ${production.titel} van watchlist`);
  weg.title = 'Van watchlist halen';
  const icoon = svgIcon(BLADWIJZER);
  icoon.setAttribute('fill', 'currentColor');
  weg.appendChild(icoon);
  weg.addEventListener('click', () => haalVanWatchlist(production.items ?? production.item, renderProfielScreen));
  wrap.append(renderProductionRow(production), actie, weg);
  return wrap;
}

// Het eenvoudige scherm van een watchlist-item dat niet meer in de agenda
// staat: titel, maker, genre en theater uit het item, met de bladwijzer.
// Na het weghalen blijft het scherm staan (bladwijzer leeg), zodat je hem
// meteen terug kunt zetten.
let watchlistSchermItem = null;
function renderWatchlistScherm(item) {
  watchlistSchermItem = item;
  const titel = item.titel ?? '';
  els.watchlistItemTitel.textContent = titel;
  const maker = item.maker && !makerStaatInTitel(titel, item.maker) ? item.maker : null;
  els.watchlistItemMaker.textContent = maker ?? '';
  els.watchlistItemMaker.hidden = !maker;
  els.watchlistItemGenre.textContent = item.genre ?? '';
  // Het theater waar je hem op de watchlist zette.
  const theater = item.theaterId ? theaterDisplayName(item.theaterId) : null;
  els.watchlistItemTheater.textContent = theater ?? '';
  els.watchlistItemTheater.hidden = !theater;
  const op = watchlistSleutels().has(item.sleutel);
  const label = op ? `Verwijder ${titel} van watchlist` : `${titel} weer op watchlist zetten`;
  const btn = els.watchlistItemIcon;
  btn.classList.toggle('is-on', op);
  btn.setAttribute('aria-pressed', String(op));
  btn.setAttribute('aria-label', label);
  btn.title = op ? 'Van watchlist halen' : 'Op watchlist zetten';
  btn.querySelector('svg').setAttribute('fill', op ? 'currentColor' : 'none');
  btn.onclick = () => {
    if (watchlistSleutels().has(item.sleutel)) {
      haalVanWatchlist(item, () => renderWatchlistScherm(item));
    } else {
      state.watchlist = voegToe(state.watchlist, { titel: item.titel, theaterId: item.theaterId, maker: item.maker ?? null, genre: item.genre ?? null });
      saveWatchlist();
      renderAgenda();
      renderWatchlistScherm(item);
    }
  };
}

function renderProfielScreen() {
  renderProfielTegels();
  renderGeplandList();
  renderGezienList();
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
    els.favoritesList.appendChild(renderWatchlistItem(production));
  }
}

init();
