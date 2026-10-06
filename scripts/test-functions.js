// npm run test:functions — de Cloud Functions lokaal testen met de emulators
// (project demo-podiumagenda), in twee rondes:
//   1. Firestore + Auth: de kernlogica (controles, tellers, inhoud, billing).
//   2. Functions + Firestore + Auth: de echte trigger met een lokale SMTP-vanger.
// Daarna wordt de uitvoer van de emulators (o.a. de logs van de functies)
// gecontroleerd: er mag geen e-mailadres van een testgebruiker in staan, en
// geen (nep-)GitHub-token.
// Het nepgeheim voor de emulator (functions/.secret.local) wordt hier
// aangemaakt; het staat in .gitignore.

import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';

const FIREBASE = 'firebase/node_modules/.bin/firebase';
const NEP_GITHUB_TOKEN = 'github_pat_NEP0000emulator0000geheim';
await writeFile(
  'functions/.secret.local',
  `GMAIL_USER=podiumagenda-test@localhost.invalid\nGMAIL_APP_PASSWORD=nep-wachtwoord\nGITHUB_DISPATCH_TOKEN=${NEP_GITHUB_TOKEN}\n`
);

function ronde(only, bestanden) {
  return new Promise((klaar) => {
    const kind = spawn(
      FIREBASE,
      ['emulators:exec', '--config', 'firebase.json', '--only', only, '--project', 'demo-podiumagenda', `node --test --test-concurrency=1 ${bestanden}`],
      { stdio: ['ignore', 'pipe', 'pipe'] }
    );
    let uitvoer = '';
    const neem = (stuk) => {
      uitvoer += stuk;
      process.stdout.write(stuk);
    };
    kind.stdout.on('data', neem);
    kind.stderr.on('data', neem);
    kind.on('close', (code) => klaar({ code, uitvoer }));
  });
}

const een = await ronde('firestore,auth', 'functions/test/mail.test.js functions/test/facturering.test.js functions/test/uitnodiging.test.js functions/test/nachtrun.test.js');
const twee = await ronde('functions,firestore,auth', 'functions/test/trigger.test.js');

// Testgebruikers hebben adressen op @mail.test; geen daarvan mag in de logs.
const adressen = [...`${een.uitvoer}\n${twee.uitvoer}`.matchAll(/[A-Za-z0-9._%+-]+@mail\.test/g)].map((m) => m[0]);
if (adressen.length) {
  console.error(`\n✖ E-mailadressen in de uitvoer van de emulators: ${[...new Set(adressen)].join(', ')}`);
  process.exit(1);
}
console.log('\n✔ geen e-mailadres in de uitvoer van de emulators');
// Het nep-token van de emulator en dat van functions/test/nachtrun.test.js.
const tokens = [NEP_GITHUB_TOKEN, 'github_pat_NEP0000geheim0000nachtrun'].filter((t) => `${een.uitvoer}\n${twee.uitvoer}`.includes(t));
if (tokens.length) {
  console.error(`\n✖ GitHub-token in de uitvoer van de emulators (${tokens.length})`);
  process.exit(1);
}
console.log('✔ geen GitHub-token in de uitvoer van de emulators');
process.exit(een.code || twee.code ? 1 : 0);
