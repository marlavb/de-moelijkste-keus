// Diagnose bij een mislukte scrape: wat kregen we eigenlijk te zien?
//
// Waarom: op 30 sep 2026 vonden HNT en Theater Rotterdam in CI "geen
// agendakaarten", terwijl dezelfde code lokaal direct daarna werkte. Zonder
// status, URL en paginatekst viel niet te zeggen of het een botcontrole, een
// lege pagina of een serverfout was. Alleen lezen en loggen; niets omzeilen.

const BODY_TEKENS = 300;
const DIAGNOSE_TIMEOUT_MS = 5000;

/**
 * Volgt de navigatieantwoorden van het hoofdframe (ook redirects), zodat we
 * na een fout de laatste HTTP-status en URL weten. Geeft een object dat
 * steeds bijgewerkt wordt: { status, url }.
 */
export function volgNavigatie(page) {
  const nav = { status: null, url: null };
  if (typeof page?.on !== 'function') return nav;
  page.on('response', (response) => {
    try {
      if (!response.request().isNavigationRequest() || response.frame() !== page.mainFrame()) return;
      nav.status = response.status();
      nav.url = response.url();
    } catch {
      // Frame al weg: niets te melden.
    }
  });
  return nav;
}

/** E-mailadressen en telefoonnummers eruit, witruimte samen, ingekort. */
export function zonderPersoonsgegevens(tekst, max = BODY_TEKENS) {
  const schoon = String(tekst ?? '')
    .replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, '[e-mail]')
    .replace(/(?:\+|\b0)\d[\d\s-]{7,}\d/g, '[telefoon]')
    .replace(/\s+/g, ' ')
    .trim();
  return schoon.length > max ? `${schoon.slice(0, max)}…` : schoon;
}

function metTimeout(promise, fallback) {
  return Promise.race([promise.catch(() => fallback), new Promise((r) => setTimeout(() => r(fallback), DIAGNOSE_TIMEOUT_MS))]);
}

/**
 * Eén logregel over de pagina zoals hij nu is: HTTP-status en URL van de
 * laatste navigatie, huidige URL, paginatitel en het begin van de body.
 */
export async function paginaDiagnose(page, nav = {}) {
  if (typeof page?.url !== 'function') return null;
  const url = page.url();
  const titel = await metTimeout(page.title(), '(onbekend)');
  const body = await metTimeout(
    page.evaluate(() => document.body?.innerText ?? ''),
    '(niet te lezen)'
  );
  const status = nav.status ?? '?';
  const naRedirect = nav.url && nav.url !== url ? ` (laatste antwoord van ${nav.url})` : '';
  return `DIAGNOSE: HTTP ${status}, URL ${url}${naRedirect}, titel "${zonderPersoonsgegevens(titel, 120)}", body: "${zonderPersoonsgegevens(body)}"`;
}

/**
 * page.goto met de stap erbij in de foutmelding als het misgaat:
 * "verbinden" (geen antwoord van de server) of "laden" (wel een antwoord,
 * maar de pagina werd niet op tijd klaar).
 */
export async function gaNaar(page, url, { timeout = 30000, waitUntil = 'domcontentloaded' } = {}) {
  const start = Date.now();
  let antwoord = null;
  const opAntwoord = (response) => {
    try {
      if (response.request().isNavigationRequest() && response.frame() === page.mainFrame()) {
        antwoord = { status: response.status(), naMs: Date.now() - start };
      }
    } catch {
      // Frame al weg.
    }
  };
  page.on('response', opAntwoord);
  try {
    return await page.goto(url, { waitUntil, timeout });
  } catch (err) {
    if (/timeout/i.test(err?.message ?? '')) {
      const stap = antwoord
        ? `laden (HTTP ${antwoord.status} na ${(antwoord.naMs / 1000).toFixed(1)} s, pagina niet klaar binnen ${timeout / 1000} s)`
        : `verbinden (geen antwoord van de server binnen ${timeout / 1000} s)`;
      err.message = `${String(err.message).split('\n')[0]} — stap: ${stap}`;
    }
    throw err;
  } finally {
    page.off('response', opAntwoord);
  }
}
