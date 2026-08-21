// Vertraging tussen requests naar dezelfde site, afgeleid van robots.txt
// (Crawl-delay) met een nette minimumwaarde als de site zelf niets opgeeft.

const DEFAULT_MIN_DELAY_MS = 1000;

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createPoliteWaiter(crawlDelayMs, log) {
  const delayMs = Math.max(crawlDelayMs, DEFAULT_MIN_DELAY_MS);
  let lastRequestAt = 0;

  return async function waitForTurn() {
    const elapsed = Date.now() - lastRequestAt;
    const remaining = delayMs - elapsed;
    if (remaining > 0) {
      log?.(`  (wacht ${Math.round(remaining)}ms, crawl-delay = ${delayMs}ms)`);
      await sleep(remaining);
    }
    lastRequestAt = Date.now();
  };
}
