// Herkenbare, eerlijke User-Agent. Vul CONTACT_URL desgewenst aan via env var
// SCRAPER_CONTACT (bv. een link naar dit project) — we zetten hier bewust geen
// persoonlijk e-mailadres in, want dat gaat naar servers van derden.
const CONTACT = process.env.SCRAPER_CONTACT || 'personal/educational project, no contact url set';

export const USER_AGENT_TOKEN = 'DeMoeilijksteKeusBot';
export const USER_AGENT = `Mozilla/5.0 (compatible; ${USER_AGENT_TOKEN}/0.1; ${CONTACT})`;

// `podiumpas` loopt mee als veld op elke gescrapete voorstelling (net als
// `naam`/`stad`), zodat de app kan filteren op Podiumpas-theaters zonder een
// aparte, makkelijk-te-vergeten lijst in de front-end bij te houden — vul
// 'm dus ook meteen in voor elk nieuw theater dat hier bijkomt.
export const THEATERS = [
  {
    id: 'delamar',
    naam: 'DeLaMar Theater',
    stad: 'Amsterdam',
    baseUrl: 'https://delamar.nl',
    agendaUrl: 'https://delamar.nl/agenda/',
    podiumpas: true,
  },
  {
    id: 'bellevue',
    naam: 'Theater Bellevue',
    stad: 'Amsterdam',
    baseUrl: 'https://www.theaterbellevue.nl',
    agendaUrl: 'https://www.theaterbellevue.nl/agenda',
    podiumpas: true,
  },
  {
    id: 'meervaart',
    naam: 'De Meervaart',
    stad: 'Amsterdam',
    baseUrl: 'https://meervaart.nl',
    agendaUrl: 'https://meervaart.nl/agenda',
    podiumpas: true,
  },
  {
    id: 'ita',
    naam: 'Internationaal Theater Amsterdam',
    stad: 'Amsterdam',
    baseUrl: 'https://ita.nl',
    agendaUrl: 'https://ita.nl/nl/agenda/',
    podiumpas: false,
  },
  {
    id: 'kleinekomedie',
    naam: 'De Kleine Komedie',
    stad: 'Amsterdam',
    baseUrl: 'https://www.dekleinekomedie.nl',
    agendaUrl: 'https://www.dekleinekomedie.nl/agenda',
    podiumpas: false,
  },
  {
    id: 'frascati',
    naam: 'Frascati',
    stad: 'Amsterdam',
    baseUrl: 'https://www.frascatitheater.nl',
    agendaUrl: 'https://www.frascatitheater.nl/nl/agenda',
    podiumpas: true,
  },
  {
    id: 'carre',
    naam: 'Koninklijk Theater Carré',
    stad: 'Amsterdam',
    baseUrl: 'https://carre.nl',
    agendaUrl: 'https://carre.nl/agenda',
    podiumpas: false,
  },
  {
    id: 'amstelveen',
    naam: 'Schouwburg Amstelveen',
    stad: 'Amstelveen',
    baseUrl: 'https://schouwburgamstelveen.nl',
    agendaUrl: 'https://schouwburgamstelveen.nl/nl/theater/agenda/',
    podiumpas: true,
  },
  {
    id: 'stadsschouwburgutrecht',
    naam: 'Stadsschouwburg Utrecht',
    stad: 'Utrecht',
    baseUrl: 'https://stadsschouwburg-utrecht.nl',
    agendaUrl: 'https://stadsschouwburg-utrecht.nl/agenda',
    podiumpas: true,
  },
  {
    id: 'theaterkikker',
    naam: 'Theater Kikker',
    stad: 'Utrecht',
    baseUrl: 'https://www.theaterkikker.nl',
    agendaUrl: 'https://www.theaterkikker.nl/agenda',
    podiumpas: true,
  },
];
