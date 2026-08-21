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

/**
 * Haalt robots.txt op voor een site en geeft een klein object terug waarmee
 * je paden kunt checken en de opgegeven crawl-delay kunt opvragen.
 */
export async function loadRobotsRules(baseUrl, userAgent, userAgentToken) {
  const robotsUrl = new URL('/robots.txt', baseUrl).toString();
  let groups = [];
  try {
    const res = await fetch(robotsUrl, { headers: { 'User-Agent': userAgent } });
    if (res.ok) {
      groups = parseRobotsText(await res.text());
    }
  } catch {
    // Geen robots.txt bereikbaar -> conservatief interpreteren we dat als "alles toegestaan"
  }

  const group = selectGroup(groups, userAgentToken);
  const crawlDelayMs = group?.crawlDelay ? group.crawlDelay * 1000 : 0;

  return {
    robotsUrl,
    isAllowed(path) {
      return isPathAllowed(group, path);
    },
    crawlDelayMs,
  };
}
