// Kleine, zelfgeschreven robots.txt-parser. Genoeg om User-agent: * groepen,
// Allow/Disallow-patronen (met * wildcards en $ end-anchor) en Crawl-delay te
// respecteren, zonder externe dependency.

function parseRobotsText(text) {
  const lines = text
    .split('\n')
    .map((l) => l.replace(/#.*/, '').trim())
    .filter(Boolean);

  const groups = [];
  let current = null;

  for (const line of lines) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();

    if (key === 'user-agent') {
      const stillCollectingAgents =
        current && current.rules.length === 0 && current.crawlDelay === undefined;
      if (!stillCollectingAgents) {
        current = { agents: [], rules: [], crawlDelay: undefined };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
    } else if (key === 'allow' || key === 'disallow') {
      if (!current) continue;
      current.rules.push({ type: key, pattern: value });
    } else if (key === 'crawl-delay') {
      if (!current) continue;
      current.crawlDelay = parseFloat(value);
    }
  }

  return groups;
}

function patternToRegex(pattern) {
  let escaped = pattern.replace(/[.+^{}()|[\]\\?]/g, '\\$&');
  const endsWithDollar = escaped.endsWith('$');
  if (endsWithDollar) escaped = escaped.slice(0, -1);
  escaped = escaped.replace(/\*/g, '.*');
  return new RegExp('^' + escaped + (endsWithDollar ? '$' : ''));
}

function selectGroup(groups, userAgentToken) {
  const token = userAgentToken.toLowerCase();
  const named = groups.find(
    (g) => g.agents.includes(token) || g.agents.some((a) => a !== '*' && token.includes(a))
  );
  if (named) return named;
  return groups.find((g) => g.agents.includes('*')) ?? null;
}

function isPathAllowed(group, path) {
  if (!group) return true;
  let best = null;
  for (const rule of group.rules) {
    if (rule.type === 'disallow' && rule.pattern === '') continue; // lege Disallow = alles toegestaan
    const re = patternToRegex(rule.pattern);
    if (re.test(path)) {
      const length = rule.pattern.length;
      const isAllow = rule.type === 'allow';
      if (!best || length > best.length || (length === best.length && isAllow)) {
        best = { allow: isAllow, length };
      }
    }
  }
  return best ? best.allow : true;
}

const ROBOTS_FETCH_ATTEMPTS = 2;
const ROBOTS_FETCH_RETRY_DELAY_MS = 1500;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Voorzichtige default-delay voor het geval /robots.txt wél een 2xx
// oplevert, maar via een redirect ergens anders landt (bv. een inlogpagina
// achter een CMS-routeprobleem, geobserveerd bij Theater De Krakeling) —
// dan hebben we de ECHTE robots.txt-inhoud niet gezien en weten we dus
// niet of er een Crawl-delay bedoeld was. Dat is een andere situatie dan
// een bevestigde 404 (zoals bij Amstelveen), waar we wél zeker weten dat
// er geen regels zijn — die blijft op 0ms staan. Hier nemen we liever het
// zekere voor het onzekere, in lijn met de crawl-delay die de meeste
// andere Amsterdamse theaters al hanteren.
const AMBIGUOUS_REDIRECT_CRAWL_DELAY_MS = 5000;

/**
 * Haalt robots.txt op voor een site en geeft een klein object terug waarmee
 * je paden kunt checken en de opgegeven crawl-delay kunt opvragen.
 */
export async function loadRobotsRules(baseUrl, userAgent, userAgentToken) {
  const robotsUrl = new URL('/robots.txt', baseUrl).toString();
  let groups = [];
  let ambiguousRedirect = false;

  // Eén retry op een netwerkfout (niet op een 4xx/5xx-statuscode): een
  // ontbrekend robots.txt-bestand interpreteren we als "alles toegestaan",
  // maar een verbindingsfout is geen betrouwbaar signaal daarvoor — die kan
  // net zo goed een voorbijgaande hapering zijn (in de praktijk gezien: een
  // connect-timeout naar één specifieke site die bij een tweede poging
  // meteen weer normaal verbond). Zonder retry zou zo'n hapering ten
  // onrechte de opgegeven crawl-delay laten vallen.
  for (let attempt = 1; attempt <= ROBOTS_FETCH_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(robotsUrl, { headers: { 'User-Agent': userAgent } });
      if (res.ok) {
        if (new URL(res.url).pathname === '/robots.txt') {
          groups = parseRobotsText(await res.text());
        } else {
          // fetch() volgt redirects automatisch; als we na afloop niet meer
          // op /robots.txt staan, hebben we iets anders binnengekregen (een
          // inlogpagina, een generieke foutpagina, etc.) — dat NIET als
          // robots.txt-tekst parsen, en NIET stilzwijgend als "geen
          // robots.txt" behandelen.
          ambiguousRedirect = true;
        }
      }
      break;
    } catch {
      if (attempt === ROBOTS_FETCH_ATTEMPTS) {
        // Nog steeds onbereikbaar na de retry -> conservatief interpreteren
        // we dat als "alles toegestaan".
        break;
      }
      await sleep(ROBOTS_FETCH_RETRY_DELAY_MS);
    }
  }

  const group = selectGroup(groups, userAgentToken);
  const crawlDelayMs = group?.crawlDelay
    ? group.crawlDelay * 1000
    : ambiguousRedirect
      ? AMBIGUOUS_REDIRECT_CRAWL_DELAY_MS
      : 0;

  return {
    robotsUrl,
    isAllowed(path) {
      return isPathAllowed(group, path);
    },
    crawlDelayMs,
  };
}
