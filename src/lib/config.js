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
];
