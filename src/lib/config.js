// Herkenbare, eerlijke User-Agent met een link naar public/bot.html (uitleg +
// bezwaarformulier). In CI komt die uit de GitHub Actions-variabele
// SCRAPER_CONTACT; lokaal en als fallback dezelfde URL hieronder. Bewust geen
// persoonlijk e-mailadres: dat gaat naar servers van derden.
const BOT_INFO_URL = 'https://marlavb.github.io/de-moelijkste-keus/bot.html';
const CONTACT = process.env.SCRAPER_CONTACT || `+${BOT_INFO_URL}`;

export const USER_AGENT_TOKEN = 'DeMoeilijksteKeusBot';
export const USER_AGENT = `Mozilla/5.0 (compatible; ${USER_AGENT_TOKEN}/0.1; ${CONTACT})`;

// Tijdbudgetten voor een scrape-run (afgedwongen in lib/scrapeRun.js). Een
// theater dat zijn budget overschrijdt wordt afgebroken en valt terug op de
// vorige data. Gebaseerd op de run van 27 sep 2026: Bellevue ~18 min (elke
// productie een detailpagina met 5s crawl-delay; sinds okt 2026 ~2 min), de
// rest hooguit ~3 min (Flint). De standaard is ruim 3x dat; een theater dat
// structureel langer duurt krijgt een eigen `budgetMinuten` hieronder. Het
// totaalbudget blijft onder de 80-minutengrens van "Nachtrun beoordelen" en
// ruim onder de timeout-minutes (120) van refresh-data.yml, zodat er altijd
// iets wordt weggeschreven en gecommit voordat GitHub de job afschiet.
export const DEFAULT_THEATER_BUDGET_MINUTEN = 10;
export const RUN_BUDGET_MINUTEN = 75;

// Reserveren met de Podiumpas kan bij sommige theaters niet online (de
// "Reserveer"-knop gaat dan naar de gewone kaartverkoop). Alleen voor die
// theaters staat hieronder `podiumpasReserveren`; de run schrijft het naar
// public/data/theaters.json en het detailscherm toont dan een melding. Zonder
// dit veld (online, of onbekend) verandert er niets. Per theater: bron + datum.
// Met `online: true` kan het wél online (tarief "Podiumpas"); dan alleen een
// uitlegregel, en de gewone reserveerknop blijft staan.
//
// Bron: https://www.hnt.nl/nl/kaartverkoop-tgcr (27 sep 2026)
const HNT_RESERVEREN = {
  telefoon: '088 356 53 56',
  email: 'service@hnt.nl',
  toelichting: 'Telefonisch of per mail, vanaf 30 dagen voor de voorstelling.',
};
// Bron: https://www.theaterrotterdam.nl/podiumpas-onbeperkt-naar-voorstellingen-ssx2 (27 sep 2026)
const TR_RESERVEREN = {
  telefoon: '010 - 41 18 110',
  email: 'kassa@theaterrotterdam.nl',
  toelichting: 'Via de kassa: telefonisch (ma–vr 14–17 uur), per mail of aan de balie, vanaf 30 dagen voor de voorstelling.',
};

// Bron: https://www.agnietenhof.nl/kaartverkoopinformatie-jxyz (7 okt 2026)
const AGNIETENHOF_RESERVEREN = {
  telefoon: '0344 673 500',
  email: 'kassa@cultuurbedrijftiel.nl',
  toelichting: 'Alleen via de kassa: telefonisch, per mail of aan de balie, vanaf 30 dagen voor de voorstelling; tickets tot €50.',
};

// `provincie` (sinds 30 sep 2026): voor een latere provinciefilter; nog niet
// in de UI. Bij elk nieuw theater invullen.
//
// Bewust niet toegevoegd (en waarom), zodat niemand ze opnieuw uitzoekt:
// - De Bokkenrijders (Maastricht, op podiumpas.nl/waar-te-besteden):
//   eenmalige spektakelmusical in Stadion de Geusselt, juni 2026, via Eventim
//   (dat onze bot weert); geen theater met een agenda, en voorbij (30 sep 2026).
//
// `podiumpas` loopt mee als veld op elke gescrapete voorstelling (net als
// `naam`/`stad`), zodat de app kan filteren op Podiumpas-theaters zonder een
// aparte, makkelijk-te-vergeten lijst in de front-end bij te houden — vul
// 'm dus ook meteen in voor elk nieuw theater dat hier bijkomt.
export const THEATERS = [
  {
    id: 'delamar',
    naam: 'DeLaMar',
    stad: 'Amsterdam',
    provincie: 'Noord-Holland',
    baseUrl: 'https://delamar.nl',
    agendaUrl: 'https://delamar.nl/agenda/',
    podiumpas: true,
  },
  {
    id: 'bellevue',
    naam: 'Theater Bellevue',
    stad: 'Amsterdam',
    provincie: 'Noord-Holland',
    baseUrl: 'https://www.theaterbellevue.nl',
    agendaUrl: 'https://www.theaterbellevue.nl/agenda',
    podiumpas: true,
    // Sinds okt 2026 alleen de agendapagina's (~25 × 5 s crawl-delay ≈ 2 min);
    // was 40 min voor ~180 detailpagina's.
    budgetMinuten: 15,
  },
  {
    id: 'meervaart',
    naam: 'Theater de Meervaart',
    stad: 'Amsterdam',
    provincie: 'Noord-Holland',
    baseUrl: 'https://meervaart.nl',
    agendaUrl: 'https://meervaart.nl/agenda',
    podiumpas: true,
  },
  {
    id: 'ita',
    // Weergavenaam sinds 30 sep 2026 (was "Internationaal Theater Amsterdam");
    // de id blijft 'ita' (keuzes, plannen, sleutels en links hangen eraan).
    // Zoeken op "ITA" werkt via THEATER_ZOEKALIASSEN in public/js/app.js.
    naam: 'Stadsschouwburg Amsterdam',
    stad: 'Amsterdam',
    provincie: 'Noord-Holland',
    baseUrl: 'https://ita.nl',
    agendaUrl: 'https://ita.nl/nl/agenda-stadsschouwburg',
    podiumpas: false,
    // Eigen pauze tussen requests (robots.txt geeft geen crawl-delay, dus
    // anders 1 s): 9 listingpagina's gingen in ~8 s, en in CI liep ITA op
    // 27, 29 en 30 sep 2026 op wisselende pagina's tegen een time-out.
    crawlDelaySeconden: 4,
  },
  {
    id: 'kleinekomedie',
    naam: 'De Kleine Komedie',
    stad: 'Amsterdam',
    provincie: 'Noord-Holland',
    baseUrl: 'https://www.dekleinekomedie.nl',
    agendaUrl: 'https://www.dekleinekomedie.nl/agenda',
    podiumpas: false,
  },
  {
    id: 'frascati',
    naam: 'Frascati',
    stad: 'Amsterdam',
    provincie: 'Noord-Holland',
    baseUrl: 'https://www.frascatitheater.nl',
    agendaUrl: 'https://www.frascatitheater.nl/nl/agenda',
    podiumpas: true,
    // Bron: https://www.frascatitheater.nl/nl/pQ5Zjiw/podiumpas (27 sep 2026)
    podiumpasReserveren: {
      telefoon: '020-6266866',
      email: 'kassa@frascatitheater.nl',
      toelichting: 'Telefonisch; als bestaande klant ook per mail (naam, postcode, voorstelling met datum en tijd). Vanaf 30 dagen voor de voorstelling.',
    },
  },
  {
    id: 'carre',
    naam: 'Koninklijk Theater Carré',
    stad: 'Amsterdam',
    provincie: 'Noord-Holland',
    baseUrl: 'https://carre.nl',
    agendaUrl: 'https://carre.nl/agenda',
    podiumpas: false,
  },
  {
    id: 'amstelveen',
    naam: 'Schouwburg Amstelveen',
    stad: 'Amstelveen',
    provincie: 'Noord-Holland',
    baseUrl: 'https://schouwburgamstelveen.nl',
    agendaUrl: 'https://schouwburgamstelveen.nl/nl/theater/agenda/',
    podiumpas: true,
    // Getoond in "Mijn theaters" (via theaters.json), ook als het theater
    // geen voorstellingen heeft. Bron: https://schouwburgamstelveen.nl/nl/theater/over-ons/verbouwing-cultuurstrip/
    // (27 sep 2026: verbouwing sinds juni 2026, heropening december 2027).
    // Na de heropening weghalen.
    melding: 'Tijdelijk gesloten wegens verbouwing (heropening december 2027). De voorstellingen staan bij Theater De Landing.',
  },
  {
    id: 'stadsschouwburgutrecht',
    naam: 'Stadsschouwburg Utrecht',
    stad: 'Utrecht',
    provincie: 'Utrecht',
    baseUrl: 'https://stadsschouwburg-utrecht.nl',
    agendaUrl: 'https://stadsschouwburg-utrecht.nl/agenda',
    podiumpas: true,
  },
  {
    id: 'theaterkikker',
    naam: 'Theater Kikker',
    stad: 'Utrecht',
    provincie: 'Utrecht',
    baseUrl: 'https://www.theaterkikker.nl',
    agendaUrl: 'https://www.theaterkikker.nl/agenda',
    podiumpas: true,
  },
  {
    id: 'krakeling',
    naam: 'Theater De Krakeling',
    stad: 'Amsterdam',
    provincie: 'Noord-Holland',
    baseUrl: 'https://krakeling.nl',
    agendaUrl: 'https://krakeling.nl/programma',
    podiumpas: true,
  },
  {
    id: 'mozaiek',
    naam: 'Podium Mozaïek',
    stad: 'Amsterdam',
    provincie: 'Noord-Holland',
    baseUrl: 'https://www.podiummozaiek.nl',
    agendaUrl: 'https://www.podiummozaiek.nl/programma/agenda',
    podiumpas: true,
  },
  {
    id: 'muziekgebouw',
    naam: "Muziekgebouw aan 't IJ",
    stad: 'Amsterdam',
    provincie: 'Noord-Holland',
    baseUrl: 'https://www.muziekgebouw.nl',
    agendaUrl: 'https://www.muziekgebouw.nl/nl/agenda',
    podiumpas: true,
  },
  {
    id: 'scala',
    naam: 'Scala Theater',
    stad: 'Amsterdam',
    provincie: 'Noord-Holland',
    baseUrl: 'https://www.scala-amsterdam.nl',
    agendaUrl: 'https://www.scala-amsterdam.nl/voorstellingen',
    podiumpas: true,
    // Bron: https://www.scala-amsterdam.nl/podiumpas (27 sep 2026)
    podiumpasReserveren: {
      email: 'info@scala-amsterdam.nl',
      toelichting: 'Per mail met datum, shows, aantal gasten en pasnummer(s). Vrijdag en zaterdag alleen in combinatie met het 4-gangenmenu.',
    },
  },
  {
    id: 'omval',
    naam: 'Theater de Omval',
    stad: 'Diemen',
    provincie: 'Noord-Holland',
    baseUrl: 'https://www.theaterdeomval.nl',
    agendaUrl: 'https://www.theaterdeomval.nl/voorstellingen',
    podiumpas: true,
  },
  // Podiumpas bij De Landing: gemengd. Bron:
  // https://schouwburgamstelveen.nl/nl/theater/je-bezoek/kaartverkoop/podiumpas/
  // (27 sep 2026): uitgesloten zijn verhuringen, eigen producties, films,
  // gastvoorstellingen en voorstellingen boven €50. Per voorstelling bepaald
  // in sites/amstelveen.js (bepaalLandingPodiumpas: bestellink van derden,
  // en binnen 30 dagen het Podiumpas-prijstype in het Ticketmatic-widget).
  // Na de heropening van de Schouwburg (december 2027) gelden deze regels
  // ook voor de Schouwburg. Online reserveren met de pas kan via het widget,
  // dus geen podiumpasReserveren.
  {
    id: 'delanding',
    naam: 'De Landing',
    stad: 'Amstelveen',
    provincie: 'Noord-Holland',
    baseUrl: 'https://schouwburgamstelveen.nl',
    agendaUrl: 'https://schouwburgamstelveen.nl/nl/delanding/agenda/',
    podiumpas: true,
  },
  {
    id: 'zaantheater',
    naam: 'Zaantheater',
    stad: 'Zaandam',
    provincie: 'Noord-Holland',
    baseUrl: 'https://zaantheater.nl',
    agendaUrl: 'https://zaantheater.nl/nl/theater/agenda/',
    podiumpas: true,
  },
  {
    id: 'bijlmerparktheater',
    naam: 'Bijlmer Parktheater',
    stad: 'Amsterdam',
    provincie: 'Noord-Holland',
    baseUrl: 'https://www.bijlmerparktheater.nl',
    agendaUrl: 'https://www.bijlmerparktheater.nl/agenda',
    podiumpas: true,
  },
  {
    id: 'ccamstel',
    naam: 'CC Amstel',
    stad: 'Amsterdam',
    provincie: 'Noord-Holland',
    baseUrl: 'https://ccamstel.nl',
    agendaUrl: 'https://ccamstel.nl/programma/',
    podiumpas: true,
    // Bron: https://ccamstel.nl/over-ons/nieuws/podiumpas-bij-cc-amstel/ (27 sep 2026)
    podiumpasReserveren: {
      email: 'info@ccamstel.nl',
      toelichting: 'Per mail met onderwerp "Podiumpas Reservering" (voorstelling, datum, tijd), vanaf 30 dagen voor de voorstelling.',
    },
  },
  {
    id: 'marionettentheater',
    naam: 'Amsterdams Marionetten Theater',
    stad: 'Amsterdam',
    provincie: 'Noord-Holland',
    baseUrl: 'https://www.marionettentheater.nl',
    agendaUrl: 'https://www.marionettentheater.nl/agenda/',
    podiumpas: true,
    // Bron: https://www.marionettentheater.nl/podiumpas/ (27 sep 2026). Pas
    // geldt alleen bij marionettenvoorstellingen, zie classifyMarionetItem.
    podiumpasReserveren: {
      email: 'info@marionettentheater.nl',
      toelichting: 'Alleen per mail (onderwerp "Podiumpas"), vanaf 30 dagen voor de voorstelling. Ticket ophalen 30–45 min. voor aanvang.',
    },
  },
  {
    id: 'griffioen',
    naam: 'VU Griffioen',
    stad: 'Amsterdam',
    provincie: 'Noord-Holland',
    baseUrl: 'https://griffioen.vu.nl',
    agendaUrl: 'https://griffioen.vu.nl/voorstellingen',
    podiumpas: true,
  },
  // Podiumpas: false sinds 27 sep 2026. Plein Theater staat niet (meer) op
  // podiumpas.nl/waar-te-besteden, https://plein-theater.nl/podiumpas geeft
  // alleen de homepage terug (geen vermelding op de site), en de Stager-shop
  // (bv. https://plein-theater.stager.co/shop/default/events/111586165) toont
  // geen Podiumpas-prijstype (alleen Stadspas). Blijft wel in de agenda.
  {
    id: 'pleintheater',
    naam: 'Plein Theater',
    stad: 'Amsterdam',
    provincie: 'Noord-Holland',
    baseUrl: 'https://plein-theater.nl',
    agendaUrl: 'https://plein-theater.nl/agenda',
    podiumpas: false,
  },
  {
    id: 'karavaan',
    naam: 'Karavaan - Theater de Drukkerij',
    stad: 'Alkmaar',
    provincie: 'Noord-Holland',
    baseUrl: 'https://www.karavaan.nl',
    agendaUrl: 'https://www.karavaan.nl/location/de-drukkerij/',
    podiumpas: true,
    // Bron: https://www.karavaan.nl/podiumpas-en-alkmaarpas/ (27 sep 2026)
    podiumpasReserveren: {
      formulier: 'https://www.karavaan.nl/bestel-met-podiumpas/',
      toelichting: 'Via het Podiumpas-formulier, vanaf 30 dagen voor de voorstelling (max. 1 ticket per pas).',
    },
  },
  {
    id: 'schuur',
    naam: 'Schuur',
    stad: 'Haarlem',
    provincie: 'Noord-Holland',
    baseUrl: 'https://www.schuur.nl',
    agendaUrl: 'https://www.schuur.nl/agenda',
    podiumpas: true,
  },
  // Podiumpas gecontroleerd op 27 sep 2026: eigen pagina actief,
  // https://bostheater.nl/podiumpas/ (alleen theatervoorstellingen en
  // Bosfest; zie isPodiumpasEligible in sites/bostheater.js).
  {
    id: 'bostheater',
    naam: 'Bostheater',
    stad: 'Amstelveen',
    provincie: 'Noord-Holland',
    baseUrl: 'https://bostheater.nl',
    agendaUrl: 'https://bostheater.nl/ons-programma/',
    podiumpas: true,
  },
  {
    id: 'hogewoerd',
    naam: 'Podium Hoge Woerd',
    stad: 'Utrecht',
    provincie: 'Utrecht',
    baseUrl: 'https://www.podiumhogewoerd.nl',
    agendaUrl: 'https://www.podiumhogewoerd.nl/agenda',
    podiumpas: true,
    // Bron: https://www.podiumhogewoerd.nl/we-are-public-en-podiumpas (27 sep 2026)
    podiumpasReserveren: {
      telefoon: '030-7210933',
      email: 'kassa@podiumhogewoerd.nl',
      toelichting: 'Via de kassa, per mail of telefonisch, vanaf 30 dagen voor de voorstelling (weekend: uiterlijk vrijdag 17.00 uur).',
    },
  },
  {
    id: 'flint',
    naam: 'Flint',
    stad: 'Amersfoort',
    provincie: 'Utrecht',
    baseUrl: 'https://flint.nl',
    agendaUrl: 'https://flint.nl/agenda/',
    podiumpas: true,
    // Bron: https://flint.nl/programma/kortingen-acties/podiumpas/ (27 sep 2026)
    podiumpasReserveren: {
      telefoon: '033 4 229 229',
      toelichting: 'Telefonisch via de kassa, vanaf 30 dagen voor de voorstelling.',
    },
  },
  {
    id: 'aandeslinger',
    naam: 'Aan de Slinger',
    stad: 'Houten',
    provincie: 'Utrecht',
    baseUrl: 'https://www.aandeslinger.nl',
    agendaUrl: 'https://www.aandeslinger.nl/programma',
    podiumpas: true,
  },
  {
    id: 'corrosia',
    naam: 'Corrosia',
    stad: 'Almere',
    provincie: 'Flevoland',
    baseUrl: 'https://www.corrosia.nl',
    agendaUrl: 'https://www.corrosia.nl/agenda/programma',
    podiumpas: true,
  },
  {
    id: 'kunstlinie',
    naam: 'Kunstlinie',
    stad: 'Almere',
    provincie: 'Flevoland',
    baseUrl: 'https://kunstlinie.nl',
    agendaUrl: 'https://kunstlinie.nl/programma/',
    podiumpas: true,
  },
  // Zuid-Holland. Namen letterlijk zoals op podiumpas.nl/waar-te-besteden.
  // De drie HNT-zalen en de twee TR-locaties staan daar als losse locaties;
  // ze delen per groep één scrape (zie createGroupScraper in lib/peppered.js).
  {
    id: 'koninklijkeschouwburg',
    naam: 'Koninklijke Schouwburg',
    stad: 'Den Haag',
    provincie: 'Zuid-Holland',
    baseUrl: 'https://www.hnt.nl',
    agendaUrl: 'https://www.hnt.nl/nl/voorstellingen',
    podiumpas: true,
    podiumpasReserveren: HNT_RESERVEREN,
  },
  {
    id: 'theateraanhetspui',
    naam: 'Theater aan het Spui',
    stad: 'Den Haag',
    provincie: 'Zuid-Holland',
    baseUrl: 'https://www.hnt.nl',
    agendaUrl: 'https://www.hnt.nl/nl/voorstellingen',
    podiumpas: true,
    podiumpasReserveren: HNT_RESERVEREN,
  },
  {
    id: 'zaal3',
    naam: 'Zaal 3',
    stad: 'Den Haag',
    provincie: 'Zuid-Holland',
    baseUrl: 'https://www.hnt.nl',
    agendaUrl: 'https://www.hnt.nl/nl/voorstellingen',
    podiumpas: true,
    podiumpasReserveren: HNT_RESERVEREN,
  },
  {
    id: 'tr25',
    naam: 'Theater Rotterdam (TR25 Schouwburg)',
    stad: 'Rotterdam',
    provincie: 'Zuid-Holland',
    baseUrl: 'https://www.theaterrotterdam.nl',
    agendaUrl: 'https://www.theaterrotterdam.nl/agenda',
    podiumpas: true,
    podiumpasReserveren: TR_RESERVEREN,
  },
  {
    id: 'tr8',
    naam: 'Theater Rotterdam (TR8 William Boothlaan)',
    stad: 'Rotterdam',
    provincie: 'Zuid-Holland',
    baseUrl: 'https://www.theaterrotterdam.nl',
    agendaUrl: 'https://www.theaterrotterdam.nl/agenda',
    podiumpas: true,
    podiumpasReserveren: TR_RESERVEREN,
  },
  {
    id: 'koningshof',
    naam: 'Theater Koningshof',
    stad: 'Maassluis',
    provincie: 'Zuid-Holland',
    baseUrl: 'https://www.theaterkoningshof.nl',
    agendaUrl: 'https://www.theaterkoningshof.nl/agenda',
    podiumpas: true,
  },
  {
    id: 'maas',
    naam: 'Maas theater en dans',
    stad: 'Rotterdam',
    provincie: 'Zuid-Holland',
    baseUrl: 'https://www.maastd.nl',
    agendaUrl: 'https://www.maastd.nl/nl/agenda/',
    podiumpas: true,
  },
  {
    id: 'insblau',
    naam: 'Theater Ins Blau',
    stad: 'Leiden',
    provincie: 'Zuid-Holland',
    baseUrl: 'https://theaterinsblau.nl',
    agendaUrl: 'https://theaterinsblau.nl/programma',
    podiumpas: true,
  },
  {
    id: 'stadsgehoorzaal',
    naam: 'Stadsgehoorzaal',
    stad: 'Vlaardingen',
    provincie: 'Zuid-Holland',
    baseUrl: 'https://stadsgehoorzaal.nl',
    agendaUrl: 'https://stadsgehoorzaal.nl/programma',
    podiumpas: true,
  },
  {
    id: 'kruispunt',
    naam: 'Theater het Kruispunt',
    stad: 'Barendrecht',
    provincie: 'Zuid-Holland',
    baseUrl: 'https://www.theaterhetkruispunt.nl',
    agendaUrl: 'https://www.theaterhetkruispunt.nl/agenda',
    podiumpas: true,
    // Gepauzeerd: sinds 28 sep 2026 krijgt onze scraper (lokaal én in CI) een
    // 403 met een BunnyCDN-botcontrole ("Establishing a secure connection").
    // We omzeilen dat niet. Terugzetten = deze regel weghalen.
    gepauzeerd: { sinds: '2026-09-28', reden: 'BunnyCDN-botcontrole (403)' },
    // Bron: https://www.theaterhetkruispunt.nl/podiumpas-8y4s (27 sep 2026)
    podiumpasReserveren: {
      telefoon: '0180-615958',
      toelichting: 'Uitsluitend telefonisch via de publieksservice, vanaf 30 dagen voor de voorstelling.',
    },
  },
  {
    id: 'isala',
    naam: 'Isala theater',
    stad: 'Capelle aan den IJssel',
    provincie: 'Zuid-Holland',
    baseUrl: 'https://www.isalatheater.nl',
    agendaUrl: 'https://www.isalatheater.nl/agenda',
    podiumpas: true,
    // Gepauzeerd: sinds 28 sep 2026 krijgt onze scraper (lokaal én in CI) een
    // 403 met een BunnyCDN-botcontrole ("Establishing a secure connection").
    // We omzeilen dat niet. Terugzetten = deze regel weghalen.
    gepauzeerd: { sinds: '2026-09-28', reden: 'BunnyCDN-botcontrole (403)' },
    // Bron: https://www.isalatheater.nl/podiumpas-l3lg (27 sep 2026)
    podiumpasReserveren: {
      telefoon: '010 - 458 6400',
      email: 'info@isalatheater.nl',
      toelichting: 'Via het bespreekbureau, aan de balie, telefonisch of per mail, vanaf 30 dagen voor de voorstelling.',
    },
  },
  {
    id: 'stoep',
    naam: 'Theater de Stoep',
    stad: 'Spijkenisse',
    provincie: 'Zuid-Holland',
    baseUrl: 'https://theaterdestoep.nl',
    agendaUrl: 'https://theaterdestoep.nl/voorstellingen',
    podiumpas: true,
  },
  {
    id: 'maaspoort',
    naam: 'De Maaspoort Theater & Events',
    stad: 'Venlo',
    provincie: 'Limburg',
    baseUrl: 'https://www.maaspoort.nl',
    agendaUrl: 'https://www.maaspoort.nl/programma/',
    // Per voorstelling: niet bij Uit de regio, Events, Educatie, externe
    // locaties en boven € 50 (zie src/sites/maaspoort.js).
    podiumpas: true,
    // Bron: https://www.maaspoort.nl/informatie/voordeel-extras/podiumpas/ (30 sep 2026)
    podiumpasReserveren: {
      online: true,
      toelichting: 'Online met het tarief "Podiumpas" (pasnummer invullen), vanaf 30 dagen voor de voorstelling. Niet bij Uit de regio, Events, Educatie en voorstellingen buiten het Maaspoort-gebouw.',
    },
  },
  {
    id: 'dok6',
    naam: 'DOK6',
    stad: 'Panningen',
    provincie: 'Limburg',
    baseUrl: 'https://dok6.eu',
    agendaUrl: 'https://dok6.eu/theater/programma/',
    // Per voorstelling: niet bij Uit de regio, Events, Educatie en gratis
    // voorstellingen (zie src/sites/dok6.js).
    podiumpas: true,
    // Bron: https://dok6.eu/theater/podiumpas/ (30 sep 2026); telefoonnummer
    // uit de voettekst van die pagina.
    podiumpasReserveren: {
      online: true,
      telefoon: '077 310 1064',
      toelichting: 'Online met het prijstype "Podiumpas" (pasnummer invullen), of telefonisch, vanaf 30 dagen voor de voorstelling. Kaartje tot een half uur voor aanvang ophalen bij de balie.',
    },
  },
  // Theaters zonder Podiumpas (1 okt 2026), om voorstellingen als "Jordy van
  // Loon speelt Louis Davids" te volgen; podiumpas: false voor het hele
  // theater, zoals Carré en De Kleine Komedie.
  {
    id: 'kennemertheater',
    naam: 'Kennemer Theater',
    stad: 'Beverwijk',
    provincie: 'Noord-Holland',
    baseUrl: 'https://www.kennemertheater.nl',
    agendaUrl: 'https://www.kennemertheater.nl/programma',
    podiumpas: false,
    // De scraper (browser) krijgt een BunnyCDN-controle ("Establishing a
    // secure connection…", HTTP 403). Niet omzeilen; de module blijft staan
    // voor als ze ons toelaten.
    gepauzeerd: { sinds: '2026-10-01', reden: 'BunnyCDN-botcontrole (403)' },
  },
  {
    id: 'cpunt',
    naam: 'Cpunt',
    stad: 'Hoofddorp',
    provincie: 'Noord-Holland',
    baseUrl: 'https://www.cpunt.nl',
    agendaUrl: 'https://www.cpunt.nl/agenda',
    podiumpas: false,
  },
  // Noord-Brabant (okt 2026; inventarisatie in debug/noord-brabant-
  // inventarisatie.md, akkoord 6 okt 2026). Bewust achteraan: valt het
  // totaalbudget van de run op, dan vallen alleen deze theaters terug op hun
  // vorige data. Namen letterlijk zoals op podiumpas.nl/waar-te-besteden.
  {
    id: 'kattendans',
    naam: 'Kattendans',
    stad: 'Bergeijk',
    provincie: 'Noord-Brabant',
    baseUrl: 'https://kattendans.nl',
    agendaUrl: 'https://kattendans.nl/programma/',
    // Per voorstelling: niet boven € 50, niet bij film, "Uit de regio" en
    // gratis voorstellingen (zie src/sites/kattendans.js).
    podiumpas: true,
    // Bron: https://kattendans.nl/podiumpas/ (6 okt 2026); telefoonnummer uit
    // de voettekst van die pagina.
    podiumpasReserveren: {
      online: true,
      telefoon: '0497-571318',
      toelichting: 'Online met het prijstype "podiumpas" (pasnummer invullen), of telefonisch, vanaf 30 dagen voor de voorstelling. Kaartje tot een half uur voor aanvang ophalen bij de theaterkassa.',
    },
  },
  {
    id: 'paradox',
    naam: 'Paradox',
    stad: 'Tilburg',
    provincie: 'Noord-Brabant',
    baseUrl: 'https://www.paradoxtilburg.nl',
    agendaUrl: 'https://www.paradoxtilburg.nl/agenda/',
    // Alle concerten, behalve gratis toegankelijke avonden (zie
    // src/sites/paradox.js).
    podiumpas: true,
    // Bron: https://www.paradoxtilburg.nl/over-paradox/tickets-kortingspassen/
    // (6 okt 2026): "Voor een entreeticket stuur je een mail naar …". Het
    // adres is daar afgeschermd; de eigen RSS-feed (/upcoming_events, 6 okt
    // 2026) noemt voor dezelfde pasregeling info@paradoxtilburg.nl.
    podiumpasReserveren: {
      email: 'info@paradoxtilburg.nl',
      toelichting: 'Je krijgt per mail een entreeticket met barcode; alleen de pas tonen bij de kassa is niet genoeg.',
    },
  },
  // De Link en S.M.E.T. staan op podiumpas.nl als losse locaties; beide
  // spelen in Het Cenakel en staan in dezelfde agenda (src/sites/cenakel.js,
  // één scrape per run). Weergavenamen zoals op podiumpas.nl.
  {
    id: 'delink',
    naam: 'De Link',
    stad: 'Tilburg',
    provincie: 'Noord-Brabant',
    baseUrl: 'https://www.cenakel.nl',
    agendaUrl: 'https://www.cenakel.nl/agenda',
    // Bron: https://delink.nl/tickets-en-kortingspassen/ (6 okt 2026):
    // "Podiumpashouders bezoeken alle concerten van De Link in het Cenakel
    // gratis." Alleen de concerten in Het Cenakel (de scraper leest alleen
    // die agenda).
    podiumpas: true,
    podiumpasReserveren: {
      online: true,
      toelichting: 'Reserveer vanaf 30 dagen voor het concert online een zitplaats: kies op de concertpagina bij De Link "Ik heb een Podiumpas". Je krijgt een ticket van € 0; laat ticket én pas zien bij de kassa.',
    },
  },
  {
    id: 'smet',
    naam: 'S.M.E.T.',
    stad: 'Tilburg',
    provincie: 'Noord-Brabant',
    baseUrl: 'https://www.cenakel.nl',
    agendaUrl: 'https://www.cenakel.nl/agenda',
    // Bron: https://podiumpas.nl/waar-te-besteden (6 okt 2026): S.M.E.T.
    // staat erop, met een link naar de agenda van Het Cenakel. Eigen
    // voorwaarden niet gevonden (akkoord 6 okt 2026: Podiumpas volgens
    // podiumpas.nl; voorwaarden worden nagevraagd).
    podiumpas: true,
    melding: 'Podiumpas-voorwaarden nog niet bekend — vraag het theater.',
  },
  {
    id: 'markant',
    naam: 'Markant Theater Maashorst',
    stad: 'Uden',
    provincie: 'Noord-Brabant',
    baseUrl: 'https://www.markantmaashorst.nl',
    agendaUrl: 'https://www.markantmaashorst.nl/nl/agenda',
    // Per voorstelling: niet boven € 50 en niet bij verkoop door derden (zie
    // src/sites/markant.js). Achter BunnyCDN (crawl-delay 5 s): bij een
    // wachtrij of controlepagina pauzeren, niet omzeilen.
    podiumpas: true,
    // Bron: https://www.markantmaashorst.nl/nl/podiumpas-qz2t (6 okt 2026).
    podiumpasReserveren: {
      telefoon: '0413 230 230',
      toelichting: 'Bel het Informatiepunt (optie 1) vanaf 30 dagen voor de voorstelling; online reserveren is niet mogelijk. Ticket ophalen en pas laten scannen bij het Informatiepunt, vanaf een uur voor aanvang.',
    },
  },
  {
    id: 'speelhuis',
    naam: 'Het Speelhuis',
    stad: 'Helmond',
    provincie: 'Noord-Brabant',
    baseUrl: 'https://theaterspeelhuis.nl',
    agendaUrl: 'https://theaterspeelhuis.nl/programma',
    // Bron: https://podiumpas.nl/waar-te-besteden (6 okt 2026). De eigen
    // pagina https://theaterspeelhuis.nl/podiumpas (6 okt 2026) noemt geen
    // voorwaarden: Podiumpas bij alle voorstellingen behalve gratis (zie
    // src/sites/speelhuis.js); voorwaarden worden nagevraagd.
    podiumpas: true,
    melding: 'Podiumpas-voorwaarden nog niet bekend — vraag het theater.',
  },
  {
    id: 'schouwburgconcertzaal',
    naam: 'Schouwburg Concertzaal',
    stad: 'Tilburg',
    provincie: 'Noord-Brabant',
    baseUrl: 'https://www.schouwburgconcertzaaltilburg.nl',
    agendaUrl: 'https://www.schouwburgconcertzaaltilburg.nl/nl/agenda',
    // Bron: https://podiumpas.nl/waar-te-besteden (6 okt 2026); de eigen site
    // noemt de pas niet (6 okt 2026). Podiumpas bij alle voorstellingen
    // behalve gratis (zie src/sites/schouwburgconcertzaal.js); voorwaarden
    // worden nagevraagd.
    podiumpas: true,
    melding: 'Podiumpas-voorwaarden nog niet bekend — vraag het theater.',
  },
  {
    id: 'willemtwee',
    naam: 'Toonzaal Willem Twee',
    stad: "'s-Hertogenbosch",
    provincie: 'Noord-Brabant',
    baseUrl: 'https://www.willem-twee.nl',
    agendaUrl: 'https://www.willem-twee.nl/agenda/toonzaal',
    // Per concert: de tag "Podiumpas" op de site (zie src/sites/willemtwee.js).
    podiumpas: true,
    // Bron: https://www.willem-twee.nl/podiumpas (6 okt 2026).
    podiumpasReserveren: {
      email: 'podiumpas@willem-twee.nl',
      toelichting: 'Mail vanaf 15 dagen voor het concert welk concert je wilt bezoeken; er zijn 5 Podiumpasplaatsen per concert. Laat op de dag zelf je pas zien bij de kassa (open vanaf een uur voor aanvang).',
    },
  },
  {
    id: 'theateraandeparade',
    naam: 'Theater aan de Parade',
    stad: "'s-Hertogenbosch",
    provincie: 'Noord-Brabant',
    baseUrl: 'https://www.theateraandeparade.nl',
    agendaUrl: 'https://www.theateraandeparade.nl/nl/programma',
    // Per speeldatum: het prijstype "Podiumpas" in de eigen data van de site
    // (zie src/sites/theateraandeparade.js).
    podiumpas: true,
    // Bron: https://www.theateraandeparade.nl/nl/podiumpas (6 okt 2026);
    // telefoonnummer van Tickets & Service uit de voettekst van die pagina.
    podiumpasReserveren: {
      online: true,
      telefoon: '073 680 9809',
      toelichting: 'Online reserveren kan vanaf één maand voor de voorstelling, als je bent ingelogd en je Podiumpas hebt laten registreren; je tickets staan daarna in je mail of account. Eén ticket per pas.',
    },
  },
  {
    id: 'denieuwevorst',
    naam: 'Theater De Nieuwe Vorst',
    stad: 'Tilburg',
    provincie: 'Noord-Brabant',
    baseUrl: 'https://denieuwevorst.nl',
    agendaUrl: 'https://denieuwevorst.nl/programma',
    podiumpas: true,
    // Bron: https://denieuwevorst.nl/bezoekinfo/ticketinfo (6 okt 2026).
    podiumpasReserveren: {
      online: true,
      toelichting: 'Online met de kaartsoort "Podiumpas" (pasnummer invullen), vanaf 30 dagen voor de voorstelling. Neem je pas mee naar de kassa; reserveringen blijven tot 15 minuten voor aanvang geldig.',
    },
  },
  {
    id: 'hofnar',
    naam: 'Theater de Hofnar',
    stad: 'Valkenswaard',
    provincie: 'Noord-Brabant',
    baseUrl: 'https://www.hofnar.nl',
    agendaUrl: 'https://www.hofnar.nl/theater/',
    // ~120 verzoeken per run (1 overzicht + 1 pagina per productie, min. 1 s
    // pauze), zie src/sites/hofnar.js: ~3 min, ruim onder dit budget.
    budgetMinuten: 8,
    // Per voorstelling: niet bij Yes Jazz, Tonpraoten en kinderbuffetten
    // (zie src/sites/hofnar.js).
    podiumpas: true,
    // Bron: https://www.hofnar.nl/podiumpas/ (6 okt 2026).
    podiumpasReserveren: {
      telefoon: '040-207 40 10',
      toelichting: 'Uitsluitend telefonisch via de kaartverkoopbalie, vanaf 30 dagen voor de voorstelling; online reserveren is niet mogelijk. Kaartje tot een half uur voor aanvang ophalen bij de balie.',
    },
  },
  {
    id: 'parktheater',
    naam: 'Parktheater Eindhoven',
    stad: 'Eindhoven',
    provincie: 'Noord-Brabant',
    baseUrl: 'https://www.parktheater.nl',
    agendaUrl: 'https://www.parktheater.nl/programma',
    // Per voorstelling: alleen in het Parktheater en Pand P, niet boven € 50
    // en niet bij de genoemde uitzonderingen (zie src/sites/parktheater.js).
    podiumpas: true,
    // Gepauzeerd: bij de verkenning (6 okt 2026) kwamen we bij ons 5e
    // verzoek in 7 minuten in de BunnyCDN-wachtrij (/csq/queue). Niet
    // omzeilen; geen verzoeken tot het theater antwoordt (gemaild). De
    // scraper staat klaar. Terugzetten = deze regel weghalen.
    gepauzeerd: { sinds: '2026-10-06', reden: 'BunnyCDN-wachtrij (/csq/queue)' },
    // Bron: https://www.parktheater.nl/podiumpas-q3yt (6 okt 2026).
    podiumpasReserveren: {
      telefoon: '040-211 11 22',
      toelichting: 'Telefonisch via de kaartverkoopbalie, vanaf 30 dagen voor de voorstelling; online reserveren is nog niet mogelijk. Pas laten scannen bij de avondkassa (open vanaf een uur voor aanvang).',
    },
  },

  // Limburg (okt 2026): theaters zonder Podiumpas. Niet op
  // https://podiumpas.nl/waar-te-besteden en nergens op de eigen sites
  // (6 okt 2026, debug/limburg-2-inventarisatie.md §1). Achteraan in de run,
  // met budgetten die samen 12 minuten zijn.
  {
    id: 'vrijthof',
    naam: 'Theater aan het Vrijthof',
    stad: 'Maastricht',
    provincie: 'Limburg',
    baseUrl: 'https://www.theateraanhetvrijthof.nl',
    agendaUrl: 'https://www.theateraanhetvrijthof.nl/voorstellingen',
    // 1 pagina + 1 Algolia-query, samen met AINSI (zie src/sites/vrijthof.js).
    budgetMinuten: 1,
    podiumpas: false,
  },
  {
    // Kaartverkoop via Theater aan het Vrijthof; de speeldata komen uit
    // dezelfde bron (locatie "AINSI: …").
    id: 'ainsi',
    naam: 'AINSI',
    stad: 'Maastricht',
    provincie: 'Limburg',
    baseUrl: 'https://www.theateraanhetvrijthof.nl',
    agendaUrl: 'https://www.theateraanhetvrijthof.nl/voorstellingen',
    budgetMinuten: 0.5,
    podiumpas: false,
  },
  {
    // PLT Heerlen Sittard Kerkrade: één agenda voor drie theaters (zie
    // src/sites/plt.js). Heerlen doet de scrape (~55 pagina's), Kerkrade en
    // Sittard hergebruiken die.
    id: 'pltheerlen',
    naam: 'Theater Heerlen',
    stad: 'Heerlen',
    provincie: 'Limburg',
    baseUrl: 'https://www.plt.nl',
    agendaUrl: 'https://www.plt.nl/programma',
    budgetMinuten: 3.5,
    podiumpas: false,
  },
  {
    id: 'pltkerkrade',
    naam: 'Theater Kerkrade',
    stad: 'Kerkrade',
    provincie: 'Limburg',
    baseUrl: 'https://www.plt.nl',
    agendaUrl: 'https://www.plt.nl/programma',
    budgetMinuten: 0.5,
    podiumpas: false,
  },
  {
    id: 'pltsittard',
    naam: 'Toon Hermans Theater Sittard',
    stad: 'Sittard',
    provincie: 'Limburg',
    baseUrl: 'https://www.plt.nl',
    agendaUrl: 'https://www.plt.nl/programma',
    budgetMinuten: 0.5,
    podiumpas: false,
  },
  {
    // Van Van der Valk Theaterhotel De Oranjerie; de agenda staat op
    // theaterroermond.nl. ~20 verzoeken per run.
    id: 'oranjerie',
    naam: 'Theater De Oranjerie',
    stad: 'Roermond',
    provincie: 'Limburg',
    baseUrl: 'https://www.theaterroermond.nl',
    agendaUrl: 'https://www.theaterroermond.nl/agenda',
    budgetMinuten: 1,
    podiumpas: false,
  },
  {
    // ~150 verzoeken per run (sitemap + 1 pagina per productie, min. 1 s
    // pauze): /mvc/ ("Toon meer") verbiedt robots.txt. Zie src/sites/munttheater.js.
    id: 'munttheater',
    naam: 'Munttheater',
    stad: 'Weert',
    provincie: 'Limburg',
    baseUrl: 'https://www.munttheater.nl',
    agendaUrl: 'https://www.munttheater.nl/agenda',
    budgetMinuten: 5,
    podiumpas: false,
  },
  {
    id: 'orpheus',
    naam: 'Theater Orpheus',
    stad: 'Apeldoorn',
    provincie: 'Gelderland',
    baseUrl: 'https://www.orpheus.nl',
    agendaUrl: 'https://www.orpheus.nl/voorstellingen',
    // Bron: https://podiumpas.nl/waar-te-besteden en
    // https://www.orpheus.nl/podiumpas-7v18 (7 okt 2026): tickets tot €50,
    // reserveren vanaf 30 dagen; uitsluitingen per voorstelling (zie
    // src/sites/orpheus.js: prijs > €50, extern verkocht en gratis → false).
    podiumpas: true,
    // ~19 agendapagina's × 5 s crawl-delay ≈ 1,5 min.
    budgetMinuten: 5,
  },
  // Bron Podiumpas: https://podiumpas.nl/waar-te-besteden en
  // https://www.agnietenhof.nl/kaartverkoopinformatie-jxyz (7 okt 2026): alleen
  // via de kassa, tot €50; geen films, STIP, verhuur/extern (zie
  // src/sites/agnietenhof.js). Op podiumpas.nl als "Cultuurbedrijf Tiel".
  {
    id: 'agnietenhof',
    naam: 'Schouwburg Agnietenhof',
    stad: 'Tiel',
    provincie: 'Gelderland',
    baseUrl: 'https://www.agnietenhof.nl',
    agendaUrl: 'https://www.agnietenhof.nl/agenda',
    podiumpas: true,
    podiumpasReserveren: AGNIETENHOF_RESERVEREN,
    // 7 okt 2026: de agendapagina geeft onze browser (Playwright) HTTP 403
    // met een BunnyCDN-botcontrole ("Establishing a secure connection…"),
    // ook bij één gewone herpoging 's middags. Niet omzeilen; de scraper
    // staat klaar (getest op een bewaarde agendapagina). Terugzetten = deze
    // regel weghalen.
    gepauzeerd: { sinds: '2026-10-07', reden: 'BunnyCDN-botcontrole (403)' },
    // ~24 agendapagina's + ~20 detailpagina's × 5 s crawl-delay ≈ 4 min.
    budgetMinuten: 7,
  },
  {
    id: 'oostpool',
    naam: 'Huis Oostpool',
    stad: 'Arnhem',
    provincie: 'Gelderland',
    baseUrl: 'https://www.oostpool.nl',
    agendaUrl: 'https://www.oostpool.nl/agenda/',
    // Bron: https://podiumpas.nl/waar-te-besteden en
    // https://www.oostpool.nl/huistheater/bestel-bezoekinfo/podiumpas/ (7 okt
    // 2026): Podiumpas geldig in Huis Oostpool; online na registratie.
    podiumpas: true,
    podiumpasReserveren: {
      online: true,
      toelichting: 'Online, vanaf 30 dagen voor de voorstelling, nadat je je pas via het formulier op de site hebt geregistreerd (dat duurt een paar werkdagen). Anders aan de deur, als het niet uitverkocht is.',
    },
    // Eén agendapagina; alleen de speeldata in Huis Oostpool (zie oostpool.js).
    budgetMinuten: 2,
  },
  {
    id: 'tar',
    naam: 'TAR',
    stad: 'Arnhem',
    provincie: 'Gelderland',
    baseUrl: 'https://tar.nl',
    agendaUrl: 'https://tar.nl/agenda/',
    // Bron: https://podiumpas.nl/waar-te-besteden (7 okt 2026; verwijst naar
    // https://tar.nl/nieuws/podiumpas-nu-ook-beschikbaar-bij-theater-a-d-rijn/,
    // 12 feb 2024). De voorwaarden-link daarin (theateraanderijn.nl/podiumpas)
    // geeft 404; voorwaarden en manier van reserveren dus onbekend. Geen
    // uitzonderingen verzonnen: alles true, met een melding (zoals Het Speelhuis).
    podiumpas: true,
    melding: 'Podiumpas-voorwaarden nog niet bekend — vraag het theater.',
    // Agendapagina + ~5 keer het lijst-endpoint.
    budgetMinuten: 2,
  },
  // Musis en Stadstheater Arnhem: één site en één API (src/sites/musis.js),
  // twee zalen; namen zoals de markers op podiumpas.nl/waar-te-besteden.
  // Bron Podiumpas: https://podiumpas.nl/waar-te-besteden en
  // https://www.musisenstadstheater.nl/nl/jouw-bezoek/podiumpas (7 okt
  // 2026): reguliere voorstellingen en concerten; niet bij verhuur, gast of
  // extern verkocht (per voorstelling, zie musis.js). Reserveren online, na
  // eenmalige registratie van de pas.
  {
    id: 'musis',
    naam: 'Musis Arnhem',
    stad: 'Arnhem',
    provincie: 'Gelderland',
    baseUrl: 'https://www.musisenstadstheater.nl',
    agendaUrl: 'https://www.musisenstadstheater.nl/nl/agenda',
    podiumpas: true,
    // Eerste run ~34 API-pagina's + ~200 detailpagina's (1 s), daarna ~65.
    budgetMinuten: 8,
  },
  {
    id: 'stadstheater',
    naam: 'Stadstheater Arnhem',
    stad: 'Arnhem',
    provincie: 'Gelderland',
    baseUrl: 'https://www.musisenstadstheater.nl',
    agendaUrl: 'https://www.musisenstadstheater.nl/nl/agenda',
    podiumpas: true,
    budgetMinuten: 8,
    // Bron: https://www.musisenstadstheater.nl/nl/verbouwing-stadstheater
    // (7 okt 2026): het Stadstheater wordt vernieuwd, heropening volgens
    // planning in 2028; geen speeldata in de agenda. Na de heropening weghalen.
    melding: 'Gesloten wegens vernieuwing (heropening gepland in 2028). De voorstellingen staan bij Musis Arnhem.',
  },
];
