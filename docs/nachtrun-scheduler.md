# Nachtelijke run om 05:00: wat je zelf doet

> Sinds 10 okt 2026 in `docs/` (eerder `debug/onderhoud-instructies.md`). Uitgevoerd
> in okt 2026; opnieuw nodig bij een nieuw of verlopen token (stap 1–2).

Na akkoord en merge van de branch `onderhoud` naar `main`. De volgorde is belangrijk:
de workflow-wijziging (job "vandaag", invoer `forceer`) moet op `main` staan
voordat de functie de eerste run start.

Project: `de-moeilijkste-keus`. Alle `npm run firebase -- …`-commando's draai je
in de root van de repo. Het token komt nooit in de repo, in een chat of in een
log.

## 1. Token maken op GitHub (fine-grained)

1. Ga naar <https://github.com/settings/personal-access-tokens/new>
   (Settings → Developer settings → Personal access tokens → Fine-grained tokens
   → Generate new token).
2. Vul in:
   - **Token name**: `podiumagenda-nachtrun`
   - **Description**: `Start refresh-data.yml om 05:00 (Cloud Function startNachtrun)`
   - **Resource owner**: `marlavb`
   - **Expiration**: Custom, maximaal 1 jaar (zet een herinnering in je agenda,
     zie stap 7).
   - **Repository access**: **Only select repositories** → kies alleen
     `marlavb/de-moelijkste-keus`.
   - **Permissions → Repository permissions**: alleen **Actions** op
     **Read and write**. *Metadata: Read-only* komt er vanzelf bij en is
     verplicht; verder niets aanzetten. Geen account-permissies.
3. **Generate token** en kopieer het meteen (je ziet het maar één keer). Plak
   het nergens anders dan in stap 2 hieronder.

## 2. Token als geheim opslaan (Secret Manager)

```sh
npm run firebase -- functions:secrets:set GITHUB_DISPATCH_TOKEN
```

Plak het token als erom gevraagd wordt (je ziet het niet terug). Controleren
zonder de waarde te tonen:

```sh
npm run firebase -- functions:secrets:get GITHUB_DISPATCH_TOKEN
```

Dat toont alleen de versies. Wis daarna het token van je klembord, bijvoorbeeld
door iets anders te kopiëren.

## 3. De functie deployen

```sh
export PATH="/opt/homebrew/opt/openjdk@21/bin:$PATH"   # alleen nodig voor de tests
npm run test:functions                                  # eerst groen
npm run firebase -- deploy --only functions:startNachtrun
```

- De eerste keer vraagt de CLI misschien de **Cloud Scheduler API** aan te zetten
  (`cloudscheduler.googleapis.com`): bevestig met `y`.
- Kosten: Cloud Scheduler heeft 3 gratis jobs per factuuraccount; dit is er één.
  De functie draait één keer per dag, een paar seconden.
- De andere functies (`uitnodigingsmail`, `stopFacturering`) blijven
  ongemoeid door `--only functions:startNachtrun`.

## 4. Controleren in Cloud Scheduler

<https://console.cloud.google.com/cloudscheduler?project=de-moeilijkste-keus>

Je ziet een job met een naam als `firebase-schedule-startNachtrun-europe-west4`:

- **Region**: europe-west4
- **Frequency**: `0 5 * * *`
- **Timezone**: Europe/Amsterdam (Central European Time)
- **Target**: Pub/Sub (zo werkt Firebase; dat is goed)

## 5. Eén keer handmatig starten

1. In de lijst van stap 4: de drie puntjes (⋮) bij de job → **Force run**.
2. Binnen een minuut verschijnt op
   <https://github.com/marlavb/de-moelijkste-keus/actions/workflows/refresh-data.yml>
   een nieuwe run met als trigger **workflow_dispatch**, gestart door `marlavb`.
3. Was de data die dag al ververst, dan zegt job **vandaag**
   "Overslaan: de data is vandaag … al ververst" en wordt **refresh**
   overgeslagen (grijs). Dat is goed: de start zelf werkt. Wil je een volledige
   run zien, kies dan een ochtend vóór de nachtelijke run, of start hem via
   GitHub met **Run workflow** → `forceer` aan.
4. Logs van de functie:
   <https://console.cloud.google.com/logs/query?project=de-moeilijkste-keus>,
   zoek op `startNachtrun`. Bij succes: `status: "gestart", http: 204`. Bij een
   fout: `status: "fout"` met de HTTP-code (401 = token ongeldig of verlopen,
   404 = geen toegang tot de repo of de workflow). Het token staat nooit in de
   log.
5. Let op: tijdens de run weigert `npm run safe-push` (zoals altijd).

## 6. Weer uitzetten

- **Tijdelijk**: in Cloud Scheduler (stap 4) → ⋮ → **Pause**. Weer aan:
  **Resume**. De cron van GitHub blijft als vangnet draaien.
- **Helemaal**:
  1. Haal `startNachtrun` uit `functions/index.js` (anders komt hij bij de
     volgende deploy terug) en commit dat.
  2. `npm run firebase -- functions:delete startNachtrun --region europe-west4`
  3. `npm run firebase -- functions:secrets:destroy GITHUB_DISPATCH_TOKEN`
  4. Het token intrekken: <https://github.com/settings/personal-access-tokens>
     → `podiumagenda-nachtrun` → **Delete**.

  De workflow werkt daarna gewoon verder op de cron, met de controle "vandaag
  al ververst".

## 7. Token verlopen of vernieuwen

GitHub mailt een week voor het verlopen. Dan:

1. Maak een nieuw token zoals in stap 1, of kies **Regenerate token** bij het
   bestaande.
2. `npm run firebase -- functions:secrets:set GITHUB_DISPATCH_TOKEN`
3. Deploy de functie opnieuw (`npm run firebase -- deploy --only functions:startNachtrun`).
   De functie gebruikt de versie van het geheim van het moment van deployen.
4. Daarna eventueel de oude versie opruimen:
   `npm run firebase -- functions:secrets:prune`.
