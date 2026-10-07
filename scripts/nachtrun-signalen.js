// Laatste stap van refresh-data.yml (altijd, ook na een gefaalde stap):
// beoordeelt de run (src/lib/nachtrunSignalen.js), schrijft de job summary,
// zet ::warning:: of ::error::, en houdt één issue "Nachtrun: aandacht
// nodig" (label nachtrun) bij: aanmaken of bijwerken bij rood, sluiten bij
// een groene run zonder terugval. Exit 1 alleen bij rood.
//
// Invoer (env): SCRAPE_SECONDEN, STAP_SCRAPE, STAP_DATACHECK, STAP_COMMIT,
// STAP_DEPLOY (outcomes van de stappen), GITHUB_STEP_SUMMARY, en voor de
// run-link GITHUB_SERVER_URL, GITHUB_REPOSITORY, GITHUB_RUN_ID. Het issue
// gaat via `gh` met GH_TOKEN (het GITHUB_TOKEN van de run, issues: write).

import { readFileSync, appendFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { beoordeelNachtrun, samenvatting, issueActie, amsterdamDatum, ISSUE_TITEL, ISSUE_LABEL } from '../src/lib/nachtrunSignalen.js';

/**
 * Voert de issue-actie uit met `gh` (een functie die de argumenten krijgt en
 * stdout teruggeeft, zodat tests een nep kunnen geven). Geeft terug wat er
 * gebeurd is: 'aangemaakt', 'bijgewerkt', 'gesloten' of 'niets'.
 */
export function verwerkIssue(actie, body, { gh, datum }) {
  if (actie === 'niets') return 'niets';
  const open = JSON.parse(gh(['issue', 'list', '--label', ISSUE_LABEL, '--state', 'open', '--json', 'number,title', '--limit', '20']) || '[]');
  const issue = open.find((i) => i.title === ISSUE_TITEL);
  const dir = mkdtempSync(path.join(tmpdir(), 'nachtrun-'));
  const bestand = path.join(dir, 'body.md');
  writeFileSync(bestand, body);
  if (actie === 'bijwerken') {
    if (issue) {
      gh(['issue', 'edit', String(issue.number), '--body-file', bestand]);
      gh(['issue', 'comment', String(issue.number), '--body-file', bestand]);
      return 'bijgewerkt';
    }
    // Het label bestaat misschien nog niet; --force maakt of werkt het bij.
    gh(['label', 'create', ISSUE_LABEL, '--color', 'B60205', '--description', 'Nachtelijke refresh vraagt aandacht', '--force']);
    gh(['issue', 'create', '--title', ISSUE_TITEL, '--label', ISSUE_LABEL, '--body-file', bestand]);
    return 'aangemaakt';
  }
  if (actie === 'sluiten' && issue) {
    gh(['issue', 'close', String(issue.number), '--comment', `Nachtrun van ${datum} zonder terugval of fouten: automatisch gesloten.`]);
    return 'gesloten';
  }
  return 'niets';
}

function main() {
  const env = process.env;
  let status = { theaters: {} };
  try {
    status = JSON.parse(readFileSync('public/data/scrape-status.json', 'utf-8'));
  } catch {
    // geen status: de beoordeling valt dan terug op de stappen
  }
  const seconden = Number.parseInt(env.SCRAPE_SECONDEN ?? '', 10);
  const b = beoordeelNachtrun({
    status,
    scrapeSeconden: Number.isFinite(seconden) ? seconden : null,
    stappen: { scrape: env.STAP_SCRAPE, datacheck: env.STAP_DATACHECK, commit: env.STAP_COMMIT, deploy: env.STAP_DEPLOY },
  });
  const datum = amsterdamDatum(Date.now());
  const runUrl = env.GITHUB_RUN_ID ? `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}` : null;
  const md = samenvatting(b, { datum, runUrl });
  console.log(md);
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `${md}\n`);

  const lijn = b.redenen.join('; ');
  if (b.niveau === 'rood') console.log(`::error title=Nachtrun: aandacht nodig::${lijn}`);
  if (b.niveau === 'waarschuwing') console.log(`::warning title=Terugval::${lijn} — zie de job summary; wordt rood als het morgen weer zo is.`);

  // Het issue mag de uitkomst niet veranderen: een fout daar is een waarschuwing.
  try {
    const gh = (args) => execFileSync('gh', args, { encoding: 'utf-8' });
    const gedaan = verwerkIssue(issueActie(b), md, { gh, datum });
    console.log(`Issue "${ISSUE_TITEL}": ${gedaan}.`);
  } catch (err) {
    console.log(`::warning title=Issue niet bijgewerkt::${err.message.split('\n')[0]}`);
  }
  process.exit(b.niveau === 'rood' ? 1 : 0);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
