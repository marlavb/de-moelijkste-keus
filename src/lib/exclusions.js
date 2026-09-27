// Controle op de Podiumpas-uitsluitingstekst van een theater. Sommige
// theaters (Isala, Kruispunt) sluiten voorstellingen bij naam uit; die namen
// staan hardcoded in de scraper, met de bron-URL en datum erbij. Elke run
// lezen we de uitsluitingstekst op hun eigen pagina opnieuw en vergelijken
// die met de tekst zoals die gold toen de lijst werd overgenomen. Wijkt hij
// af (of is hij niet meer te vinden), dan draait de scrape gewoon door met
// de bekende lijst, maar volgt een waarschuwing (scrape-status.json +
// ::warning), zodat iemand de lijst kan bijwerken. Een lijst automatisch
// uit lopende tekst halen is te fragiel; stil verouderen ook.

const normalize = (text) => text.replace(/\s+/g, ' ').trim();

export async function checkExclusionText({ page, robots, waitForTurn, warn, log, url, startsWith, expected }) {
  const path = new URL(url).pathname;
  if (!robots.isAllowed(path)) {
    log(`robots.txt verbiedt ${path} — uitsluitingstekst niet gecontroleerd.`);
    return;
  }
  try {
    await waitForTurn();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    const body = normalize(await page.evaluate(() => document.body.innerText));
    const want = normalize(expected);
    if (body.includes(want)) {
      log('Podiumpas-uitsluitingstekst ongewijzigd.');
      return;
    }
    const i = body.indexOf(startsWith);
    const found = i >= 0 ? body.slice(i, i + want.length + 80) : null;
    warn(
      found
        ? `Podiumpas-uitsluitingstekst op ${url} is gewijzigd — controleer de namenlijst in de scraper. Nu: "${found}…"`
        : `Podiumpas-uitsluitingstekst niet meer gevonden op ${url} — controleer de namenlijst in de scraper.`
    );
  } catch (err) {
    if (err?.name === 'ScrapeTimeoutError') throw err;
    warn(`kon Podiumpas-uitsluitingspagina ${url} niet laden (${err.message.split('\n')[0]}) — namenlijst niet gecontroleerd.`);
  }
}

/** Case-insensitief: komt een van de namen voor in een van de teksten? */
export function matchesAnyName(names, ...texts) {
  const haystack = texts.filter(Boolean).join(' ').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  return names.find((name) => haystack.includes(name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''))) ?? null;
}

/**
 * Laagste bedrag in een prijstekst ("Rang 1 normaal € 22,50", "€ 15–€ 32",
 * "Prijzen vanaf € 12,50"), of 0 bij "gratis", of null als er geen bedrag
 * in staat. De laagste, omdat de theaters "tickets met een reguliere prijs
 * van maximaal €50" noemen: zolang de goedkoopste rang daaronder valt, is
 * er een Podiumpas-ticket. Tekst na "Extra kosten" telt niet mee (Flint-
 * valkuil: administratiekosten van €1/€5 als prijs gelezen).
 */
export function lowestPrice(text) {
  if (!text) return null;
  const relevant = text.split(/extra kosten|servicekosten/i)[0];
  const amounts = [...relevant.matchAll(/€\s*(\d+(?:\.\d{3})*)(?:[,.](\d{2})|,-)?/g)].map(([, whole, cents]) =>
    parseFloat(`${whole.replace(/\./g, '')}.${cents ?? '00'}`)
  );
  if (amounts.length > 0) return Math.min(...amounts);
  if (/gratis/i.test(relevant)) return 0;
  return null;
}
