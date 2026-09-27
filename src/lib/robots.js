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
const MAX_REDIRECTS = 6;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Voorzichtige default-delay voor als we de ECHTE robots.txt-inhoud niet
// hebben kunnen zien, en dus niet weten of er een Crawl-delay bedoeld was:
// - /robots.txt geeft wél een 2xx, maar via een redirect ergens anders
//   (bv. een inlogpagina achter een CMS-routeprobleem, bij De Krakeling);
// - een netwerkfout of redirectlus, ook na de retry.
// Dat is iets anders dan een bevestigde 404 (zoals bij Amstelveen), waar we
// wél zeker weten dat er geen regels zijn — die blijft op 0ms staan. Hier
// nemen we liever het zekere voor het onzekere, in lijn met de crawl-delay
// die de meeste theaters op dit platform hanteren.
const UNKNOWN_ROBOTS_CRAWL_DELAY_MS = 5000;

function cookiePairs(res) {
  const setCookies = res.headers.getSetCookie?.() ?? [];
  return setCookies.map((c) => c.split(';')[0]).filter(Boolean);
}

/**
 * fetch() met handmatig gevolgde redirects en een cookie-jar voor de duur
 * van dit ene verzoek. Nodig voor sites achter een BunnyCDN-wachtrij
 * ("/csq/", bv. De Kleine Komedie, Muziekgebouw, De Omval, Isala): die
 * sturen je met een cookie naar de wachtrij en daarna met een token-cookie
 * terug. Node's fetch bewaart geen cookies tussen redirects en blijft dus
 * rondjes draaien ("redirect count exceeded"); een browser niet.
 */
export async function fetchFollowingCookies(url, { headers = {}, signal, fetchImpl = fetch } = {}) {
  const jar = new Map();
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
    const res = await fetchImpl(current, {
      headers: { ...headers, ...(cookie ? { Cookie: cookie } : {}) },
      redirect: 'manual',
      signal,
    });
    for (const pair of cookiePairs(res)) {
      const i = pair.indexOf('=');
      if (i > 0) jar.set(pair.slice(0, i).trim(), pair.slice(i + 1));
    }
    const location = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && location) {
      current = new URL(location, current).toString();
      continue;
    }
    return { res, finalUrl: current };
  }
  throw new Error(`redirectlus (meer dan ${MAX_REDIRECTS} redirects)`);
}

/**
 * Haalt robots.txt op voor een site en geeft een klein object terug waarmee
 * je paden kunt checken en de opgegeven crawl-delay kunt opvragen.
 * `log` (optioneel) meldt wanneer de behoudende terugval gebruikt wordt.
 */
export async function loadRobotsRules(baseUrl, userAgent, userAgentToken, { signal, log, fetchImpl } = {}) {
  const robotsUrl = new URL('/robots.txt', baseUrl).toString();
  let groups = [];
  let unknownReason = null;

  // Eén retry op een netwerkfout (niet op een 4xx/5xx-statuscode): een
  // ontbrekend robots.txt-bestand interpreteren we als "alles toegestaan",
  // maar een verbindingsfout is geen betrouwbaar signaal daarvoor — die kan
  // net zo goed een voorbijgaande hapering zijn (in de praktijk gezien: een
  // connect-timeout naar één specifieke site die bij een tweede poging
  // meteen weer normaal verbond).
  for (let attempt = 1; attempt <= ROBOTS_FETCH_ATTEMPTS; attempt++) {
    try {
      const { res, finalUrl } = await fetchFollowingCookies(robotsUrl, {
        headers: { 'User-Agent': userAgent },
        signal,
        fetchImpl,
      });
      if (res.ok) {
        if (new URL(finalUrl).pathname === '/robots.txt') {
          groups = parseRobotsText(await res.text());
        } else {
          // Na de redirects staan we niet meer op /robots.txt: we hebben iets
          // anders binnengekregen (een inlogpagina, een foutpagina, …) — dat
          // NIET als robots.txt parsen, en NIET als "geen robots.txt" zien.
          unknownReason = `redirect naar ${new URL(finalUrl).pathname}`;
        }
      }
      break;
    } catch (err) {
      if (signal?.aborted) throw signal.reason;
      if (attempt === ROBOTS_FETCH_ATTEMPTS) {
        unknownReason = err.message;
        break;
      }
      await sleep(ROBOTS_FETCH_RETRY_DELAY_MS);
    }
  }

  const group = selectGroup(groups, userAgentToken);
  const crawlDelayMs = group?.crawlDelay
    ? group.crawlDelay * 1000
    : unknownReason
      ? UNKNOWN_ROBOTS_CRAWL_DELAY_MS
      : 0;
  if (unknownReason) {
    log?.(`robots.txt niet leesbaar (${unknownReason}) — behoudend ${UNKNOWN_ROBOTS_CRAWL_DELAY_MS}ms crawl-delay aangehouden.`);
  }

  return {
    robotsUrl,
    isAllowed(path) {
      return isPathAllowed(group, path);
    },
    crawlDelayMs,
  };
}
