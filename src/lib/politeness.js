// Vertraging tussen requests naar dezelfde site, afgeleid van robots.txt
// (Crawl-delay) met een nette minimumwaarde als de site zelf niets opgeeft.

const DEFAULT_MIN_DELAY_MS = 1000;

// Met een AbortSignal breekt de sleep direct af (reject met signal.reason).
export function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

// Elke scraper roept waitForTurn() aan vóór elke request. Daarom is dit ook
// hét punt waar het tijdbudget per theater (zie lib/scrapeRun.js) wordt
// afgedwongen: is `signal` afgebroken, dan gooit waitForTurn — ook midden in
// een crawl-delay — en vertrekt er geen volgende request meer.
export function createPoliteWaiter(crawlDelayMs, log, signal) {
  const delayMs = Math.max(crawlDelayMs, DEFAULT_MIN_DELAY_MS);
  let lastRequestAt = 0;

  return async function waitForTurn() {
    signal?.throwIfAborted();
    const elapsed = Date.now() - lastRequestAt;
    const remaining = delayMs - elapsed;
    if (remaining > 0) {
      log?.(`  (wacht ${Math.round(remaining)}ms, crawl-delay = ${delayMs}ms)`);
      await sleep(remaining, signal);
    }
    lastRequestAt = Date.now();
  };
}
