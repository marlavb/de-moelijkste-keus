// Nepgeheimen voor de Functions-emulator (functions/.secret.local, in
// .gitignore), zodat de emulator alle functies kan laden. Gebruikt door
// npm run test:e2e (ronde met de functies); test:functions maakt hetzelfde
// bestand zelf aan. Nooit echte geheimen.

import { writeFile, rename } from 'node:fs/promises';

// Atomair (tijdelijk bestand + rename): in de parallelle testpoort schrijft
// de functions-baan (test-functions.js) hetzelfde bestand.
const tijdelijk = `functions/.secret.local.${process.pid}`;
await writeFile(tijdelijk, 'GMAIL_USER=podiumagenda-test@localhost.invalid\nGMAIL_APP_PASSWORD=nep-wachtwoord\nGITHUB_DISPATCH_TOKEN=github_pat_NEP0000emulator0000geheim\n');
await rename(tijdelijk, 'functions/.secret.local');
