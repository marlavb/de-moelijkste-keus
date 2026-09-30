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
// productie een detailpagina met 5s crawl-delay), de rest hooguit ~3 min
// (Flint). De standaard is ruim 3x dat; een theater dat structureel langer
// duurt krijgt een eigen `budgetMinuten` hieronder. Het totaalbudget blijft
// ruim onder de timeout-minutes (90) van refresh-data.yml, zodat er altijd
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
    budgetMinuten: 40,
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
];
