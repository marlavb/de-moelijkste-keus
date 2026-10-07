// Nachtrun: rood alleen als er iets te doen is (okt 2026). Pure functies,
// gebruikt door scrapeRun (terugvalReeks) en scripts/nachtrun-signalen.js
// (laatste stap van refresh-data.yml).
//
// - terugvalReeks: het aantal nachten (Amsterdamse datums) dat een theater
//   op rij terugvalt, gerekend vanaf terugvalSinds tot en met vandaag. Een
//   tweede run op dezelfde dag telt niet dubbel; gepauzeerd telt niet.
// - Groen met waarschuwing: hooguit MAX_TERUGVAL theaters vallen terug en
//   geen enkel theater ROOD_REEKS of meer nachten op rij.
// - Rood: een theater ROOD_REEKS+ nachten op rij, meer dan MAX_TERUGVAL
//   theaters in één nacht, een scherpe daling bij hetzelfde theater
//   ROOD_REEKS+ nachten op rij (dalingReeks; de eerste nacht is een
//   waarschuwing), een gefaalde stap (scrapen, datacheck, commit, deploy) of
//   een scrape langer dan MAX_SCRAPE_MINUTEN.

export const MAX_TERUGVAL = 3;
export const ROOD_REEKS = 2;
export const MAX_SCRAPE_MINUTEN = 80;
export const ISSUE_TITEL = 'Nachtrun: aandacht nodig';
export const ISSUE_LABEL = 'nachtrun';

const AMSTERDAM = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Amsterdam', year: 'numeric', month: '2-digit', day: '2-digit' });

/** 'YYYY-MM-DD' in Amsterdam. */
export function amsterdamDatum(moment) {
  const d = Object.fromEntries(AMSTERDAM.formatToParts(new Date(moment)).map((p) => [p.type, p.value]));
  return `${d.year}-${d.month}-${d.day}`;
}

/** Aantal nachten van `sinds` tot en met `nu` (Amsterdamse datums); 0 zonder `sinds`. */
export function nachtenSinds(sinds, nu) {
  if (!sinds || Number.isNaN(Date.parse(sinds))) return 0;
  const dag = (iso) => Date.parse(`${amsterdamDatum(iso)}T00:00:00Z`);
  return Math.max(1, Math.round((dag(nu) - dag(sinds)) / 86_400_000) + 1);
}

const TERUGVAL = new Set(['terugval', 'fout']);
const STAPPEN = { scrape: 'scrapen', datacheck: 'controle op dubbele voorstellingen', commit: 'data committen en pushen', deploy: 'deploy starten' };

/**
 * Beoordeelt een run. `status`: scrape-status.json; `scrapeSeconden`: duur
 * van de scrape-stap (of null); `stappen`: { scrape, datacheck, commit,
 * deploy } met de outcome van GitHub ('success', 'failure', 'skipped', …).
 * Geeft { niveau: 'ok' | 'waarschuwing' | 'rood', redenen, terugval, aantallen, scrapeSeconden }.
 */
export function beoordeelNachtrun({ status, scrapeSeconden = null, stappen = {} }) {
  const theaters = Object.entries(status?.theaters ?? {});
  const aantallen = { ok: 0, leeg: 0, gepauzeerd: 0, terugval: 0 };
  const terugval = [];
  const dalingen = [];
  for (const [id, t] of theaters) {
    if (t.status === 'gepauzeerd') aantallen.gepauzeerd++;
    else if (TERUGVAL.has(t.status)) {
      aantallen.terugval++;
      terugval.push({ id, status: t.status, fout: t.fout ?? null, reeks: Math.max(1, t.terugvalReeks ?? 1) });
    } else if (t.status === 'leeg') aantallen.leeg++;
    else aantallen.ok++;
    if (t.status !== 'gepauzeerd' && /scherpe daling/i.test(t.waarschuwing ?? '')) dalingen.push({ id, waarschuwing: t.waarschuwing, reeks: Math.max(1, t.dalingReeks ?? 1) });
  }
  terugval.sort((a, b) => b.reeks - a.reeks || a.id.localeCompare(b.id));

  const rood = [];
  for (const t of terugval) if (t.reeks >= ROOD_REEKS) rood.push(`${t.id} valt ${t.reeks} nachten op rij terug`);
  if (terugval.length > MAX_TERUGVAL) rood.push(`${terugval.length} theaters vallen terug (meer dan ${MAX_TERUGVAL})`);
  for (const d of dalingen) if (d.reeks >= ROOD_REEKS) rood.push(`scherpe daling bij ${d.id}, ${d.reeks} nachten op rij`);
  for (const [stap, naam] of Object.entries(STAPPEN)) {
    if (stappen[stap] === 'failure' || stappen[stap] === 'cancelled') rood.push(`stap "${naam}" mislukt`);
  }
  if (scrapeSeconden != null && scrapeSeconden > MAX_SCRAPE_MINUTEN * 60) {
    rood.push(`scrapen duurde ${Math.round(scrapeSeconden / 60)} min (grens ${MAX_SCRAPE_MINUTEN})`);
  }

  if (rood.length) return { niveau: 'rood', redenen: rood, terugval, aantallen, scrapeSeconden };
  const waarschuwing = [
    ...(terugval.length ? [`${terugval.length} theater(s) teruggevallen (1e nacht)`] : []),
    ...dalingen.map((d) => `scherpe daling bij ${d.id} (1e nacht): ${d.waarschuwing}`),
  ];
  return { niveau: waarschuwing.length ? 'waarschuwing' : 'ok', redenen: waarschuwing, terugval, aantallen, scrapeSeconden };
}

const KOP = { ok: '✅ Nachtrun ok', waarschuwing: '⚠️ Nachtrun ok, met terugval', rood: '❌ Nachtrun: aandacht nodig' };
const kort = (t, max = 160) => (t && t.length > max ? `${t.slice(0, max - 1)}…` : t ?? '');

/** Markdown voor de job summary en het issue. */
export function samenvatting(b, { datum = null, runUrl = null } = {}) {
  const regels = [`## ${KOP[b.niveau]}${datum ? ` (${datum})` : ''}`, ''];
  if (b.redenen.length) regels.push(...b.redenen.map((r) => `- ${r}`), '');
  const duur = b.scrapeSeconden == null ? 'onbekend' : `${Math.floor(b.scrapeSeconden / 60)} min ${b.scrapeSeconden % 60} s`;
  regels.push(`Looptijd scrapen: ${duur}`, '');
  const a = b.aantallen;
  regels.push('| ok | leeg | gepauzeerd | terugval |', '|---|---|---|---|', `| ${a.ok} | ${a.leeg} | ${a.gepauzeerd} | ${a.terugval} |`, '');
  if (b.terugval.length) {
    regels.push('| Theater | Nachten op rij | Fout |', '|---|---|---|');
    for (const t of b.terugval) regels.push(`| ${t.id} | ${t.reeks} | ${kort(t.fout).replace(/\|/g, '\\|')} |`);
    regels.push('');
  }
  if (runUrl) regels.push(`Run: ${runUrl}`, '');
  return regels.join('\n');
}

/**
 * Wat er met het issue "Nachtrun: aandacht nodig" moet gebeuren:
 * 'bijwerken' (rood: aanmaken of bijwerken), 'sluiten' (groen zonder
 * terugval) of 'niets' (groen met waarschuwing: laten zoals het is).
 */
export function issueActie(b) {
  if (b.niveau === 'rood') return 'bijwerken';
  if (b.niveau === 'ok') return 'sluiten';
  return 'niets';
}
