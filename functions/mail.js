// De uitnodigingsmail: onderwerp, platte tekst en eenvoudige HTML. Alles van
// gebruikers (namen, titels, theater, stad) wordt in de HTML ge-escapet en in
// het onderwerp ontdaan van regeleinden. Geen e-mailadressen in de inhoud.

const ESCAPE = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESCAPE[c]);
// Geen stuurtekens of regeleinden (onderwerp en platte tekst op één regel).
const eenRegel = (s) => String(s ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').trim();

const AMSTERDAM = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Amsterdam', year: 'numeric', month: '2-digit', day: '2-digit' });

/** De datum in Amsterdam ('YYYY-MM-DD'), zoals in de app (public/js/plannen.js). */
export function amsterdamDatum(nu = Date.now()) {
  const d = Object.fromEntries(AMSTERDAM.formatToParts(new Date(nu)).map((p) => [p.type, p.value]));
  return `${d.year}-${d.month}-${d.day}`;
}

const WEEKDAGEN = ['zo', 'ma', 'di', 'woe', 'do', 'vr', 'za'];
const MAANDEN = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];

/** "za 18 okt" */
export function dagKort(iso) {
  const [j, m, d] = String(iso).split('-').map(Number);
  return `${WEEKDAGEN[new Date(Date.UTC(j, m - 1, d)).getUTCDay()]} ${d} ${MAANDEN[m - 1]}`;
}

const metSlash = (url) => (String(url).endsWith('/') ? String(url) : `${url}/`);

/**
 * @param uitnodiger { gebruikersnaam, naam } (uit profielen, niet uit Auth)
 * @param voorstelling { titel, theaterNaam, stad, datum, tijd } (momentopname van het plan)
 * @param appUrl de live app (https://marlavb.github.io/de-moelijkste-keus/)
 */
export function maakUitnodigingsmail({ uitnodiger, voorstelling, appUrl }) {
  const wie = `@${eenRegel(uitnodiger.gebruikersnaam)}`;
  const naam = eenRegel(uitnodiger.naam);
  const titel = eenRegel(voorstelling.titel);
  const wanneer = [dagKort(voorstelling.datum), eenRegel(voorstelling.tijd)].filter(Boolean).join(' · ');
  const waar = [eenRegel(voorstelling.theaterNaam), eenRegel(voorstelling.stad)].filter(Boolean).join(', ');
  const basis = metSlash(appUrl);
  const berichten = `${basis}#/berichten`;
  const mailUit = `${basis}#/profiel/mail`;

  const subject = `${wie} nodigt je uit voor ${titel}`;
  const text = [
    'Hoi,',
    '',
    `${wie}${naam ? ` (${naam})` : ''} nodigt je uit om samen naar een voorstelling te gaan:`,
    '',
    `  ${titel}`,
    `  ${wanneer}`,
    waar ? `  ${waar}` : null,
    '',
    'Bekijk in Podiumagenda en laat weten of je meegaat:',
    berichten,
    '',
    '—',
    `Je krijgt deze mail omdat ${wie} en jij vrienden zijn in Podiumagenda.`,
    'Geen mails meer? Zet het uit in Profiel → Mail:',
    mailUit,
  ]
    .filter((r) => r !== null)
    .join('\n');

  const e = escapeHtml;
  const html = `<!doctype html>
<html lang="nl"><body style="margin:0;padding:24px;background:#fbf4df;font-family:Helvetica,Arial,sans-serif;color:#2e0a2e;">
<div style="max-width:480px;margin:0 auto;background:#fffdf6;border:1px solid #e9ddb8;border-radius:16px;padding:24px;">
<p style="margin:0 0 12px;">Hoi,</p>
<p style="margin:0 0 16px;"><strong>${e(wie)}</strong>${naam ? ` (${e(naam)})` : ''} nodigt je uit om samen naar een voorstelling te gaan:</p>
<p style="margin:0 0 4px;font-size:18px;font-weight:bold;color:#5b0550;">${e(titel)}</p>
<p style="margin:0 0 4px;">${e(wanneer)}</p>
${waar ? `<p style="margin:0 0 20px;">${e(waar)}</p>` : ''}
<p style="margin:0 0 24px;"><a href="${e(berichten)}" style="display:inline-block;padding:12px 20px;border-radius:999px;background:#5b0550;color:#fff6bf;text-decoration:none;font-weight:bold;">Bekijk in Podiumagenda</a></p>
<p style="margin:0;font-size:13px;color:#6e4a68;">Je krijgt deze mail omdat ${e(wie)} en jij vrienden zijn in Podiumagenda.<br>
Geen mails meer? <a href="${e(mailUit)}" style="color:#5b0550;">Zet het uit in Profiel → Mail</a>.</p>
</div></body></html>`;
  return { subject, text, html };
}
