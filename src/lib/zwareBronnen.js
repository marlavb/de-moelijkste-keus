// Afbeeldingen, video en lettertypen van theatersites niet laden: de
// scrapers lezen alleen HTML. Scheelt verkeer bij het theater (bij De
// Maaspoort laadde één pagina ~35 afbeeldingen, sep 2026) en tijd. Met
// `ookScripts` ook scripts en stylesheets, voor sites waar de agenda al in
// de HTML staat (server-rendered). Met `ookOverig` ook verzoeken van het type
// "other" (svg-logo's, prefetches): bij Theater aan de Parade waren dat er ~14
// per pagina, ook naar tix.theateraandeparade.nl (okt 2026). Ook iframes
// (documenten buiten het hoofdframe): Parade laadt op elke pagina het
// kaartverkoop-iframe tix.theateraandeparade.nl/nl/itix, dat we niet lezen.
//
// Werkt samen met de lokale cache (devCache.js): die registreert eerder een
// route op '**/*'; deze route is later geregistreerd en komt dus eerst, en
// geeft alles wat niet zwaar is door met route.fallback(). `verzoeken()`
// telt wat wél doorging (voor de log: verzoeken per run).

const ZWAAR = new Set(['image', 'media', 'font']);
const OOK_SCRIPTS = new Set(['script', 'stylesheet']);
const OVERIG = new Set(['other']);

function isIframe(page, request) {
  if (request.resourceType() !== 'document') return false;
  try {
    return request.frame() !== page.mainFrame();
  } catch {
    return false;
  }
}

export async function blokkeerZwareBronnen(page, { ookScripts = false, ookOverig = false } = {}) {
  let geblokkeerd = 0;
  let doorgelaten = 0;
  await page.route('**/*', (route) => {
    const type = route.request().resourceType();
    if (ZWAAR.has(type) || (ookScripts && OOK_SCRIPTS.has(type)) || (ookOverig && (OVERIG.has(type) || isIframe(page, route.request())))) {
      geblokkeerd++;
      return route.abort('blockedbyclient').catch(() => {});
    }
    doorgelaten++;
    return route.fallback().catch(() => {});
  });
  return { geblokkeerd: () => geblokkeerd, verzoeken: () => doorgelaten };
}
