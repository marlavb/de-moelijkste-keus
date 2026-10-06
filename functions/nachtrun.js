// Start de nachtelijke refresh (refresh-data.yml) via de GitHub API
// (workflow_dispatch op main). Gebruikt door startNachtrun in index.js
// (Cloud Scheduler, 05:00 Europe/Amsterdam): GitHub start geplande runs soms
// uren te laat; de cron in de workflow blijft als vangnet.
//
// Het token (fine-grained PAT, alleen deze repo, alleen Actions: Read and
// write) komt uit Secret Manager en komt nooit in een log: alleen de status,
// de HTTP-code en een ingekorte foutmelding van GitHub (waaruit het token
// voor de zekerheid ook nog wordt weggehaald).

export const REPO = 'marlavb/de-moelijkste-keus';
export const WORKFLOW = 'refresh-data.yml';
export const REF = 'main';

/**
 * Geeft 'gestart', 'fout' of 'geen-token'; gooit nooit (geen herhaling:
 * een tweede poging zou een dubbele run kunnen geven, de cron vangt het op).
 * log(status, { http, bericht?, fout? }).
 */
export async function startRefresh({ token, fetch = globalThis.fetch, api = 'https://api.github.com', log = () => {}, timeoutMs = 15000 }) {
  if (!token) {
    log('geen-token', { http: null });
    return 'geen-token';
  }
  const schoon = (t) => String(t ?? '').split(token).join('***').slice(0, 200);
  const url = `${api}/repos/${REPO}/actions/workflows/${WORKFLOW}/dispatches`;
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
        'User-Agent': 'podiumagenda-nachtrun',
      },
      body: JSON.stringify({ ref: REF }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (r.ok) {
      log('gestart', { http: r.status });
      return 'gestart';
    }
    const tekst = await r.text().catch(() => '');
    let bericht = tekst;
    try {
      bericht = JSON.parse(tekst).message ?? tekst;
    } catch {
      // geen JSON: de tekst zelf
    }
    log('fout', { http: r.status, bericht: schoon(bericht) });
    return 'fout';
  } catch (err) {
    log('fout', { http: null, fout: schoon(err?.name === 'TimeoutError' ? 'timeout' : err?.name ?? 'onbekend') });
    return 'fout';
  }
}
