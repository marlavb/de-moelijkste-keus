// Afbeeldingen, video en lettertypen van theatersites niet laden: de
// scrapers lezen alleen HTML. Scheelt verkeer bij het theater (bij De
// Maaspoort laadde één pagina ~35 afbeeldingen, sep 2026) en tijd. Met
// `ookScripts` ook scripts en stylesheets, voor sites waar de agenda al in
// de HTML staat (server-rendered).
//
// Werkt samen met de lokale cache (devCache.js): die registreert eerder een
// route op '**/*'; deze route is later geregistreerd en komt dus eerst, en
// geeft alles wat niet zwaar is door met route.fallback(). `verzoeken()`
// telt wat wél doorging (voor de log: verzoeken per run).

const ZWAAR = new Set(['image', 'media', 'font']);
const OOK_SCRIPTS = new Set(['script', 'stylesheet']);

export async function blokkeerZwareBronnen(page, { ookScripts = false } = {}) {
  let geblokkeerd = 0;
  let doorgelaten = 0;
  await page.route('**/*', (route) => {
    const type = route.request().resourceType();
    if (ZWAAR.has(type) || (ookScripts && OOK_SCRIPTS.has(type))) {
      geblokkeerd++;
      return route.abort('blockedbyclient').catch(() => {});
    }
    doorgelaten++;
    return route.fallback().catch(() => {});
  });
  return { geblokkeerd: () => geblokkeerd, verzoeken: () => doorgelaten };
}
