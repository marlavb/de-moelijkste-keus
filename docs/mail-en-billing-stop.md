# Stap 5: mail bij uitnodigingen aanzetten — instructies

> Sinds 10 okt 2026 in `docs/` (eerder `debug/stap5-instructies.md`). De mail is
> uitgerold; de billing-stop staat nog in DRY_RUN (§9 beschrijft de test en het
> aanzetten). Waar hieronder branch `vrienden` staat: nu gewoon `main`.

Voor project **`de-moeilijkste-keus`** (projectnummer `836341833360`),
Firestore-locatie **europe-west4**. Doe de stappen in deze volgorde. Waar
`npm run firebase -- …` staat: in de map van de repo
(`~/Documents/coding/de_moelijkste_keus`), op branch `vrienden`.

Wat je nodig hebt: een computer met de repo, de Firebase CLI (zit in de repo:
`npm run firebase -- --version`), en de Google Cloud CLI `gcloud`
(installeren: `brew install --cask google-cloud-sdk`, daarna
`gcloud auth login` en `gcloud config set project de-moeilijkste-keus`).

Kosten: met ~10 gebruikers verwacht je **€0 per maand**. Het budget van €5 en
de automatische stop zijn een vangnet.

---

## 1. Een apart Gmail-account met een app-wachtwoord

Gebruik niet je eigen Gmail: dan zien ontvangers je privéadres, en een
app-wachtwoord geeft toegang tot de hele mailbox.

1. Maak een nieuw Google-account: <https://accounts.google.com/signup>
   (bijvoorbeeld `podiumagenda.uitnodiging@gmail.com`). Gebruik een sterk
   wachtwoord en zet het in je wachtwoordmanager.
2. Log in met dat account en zet **tweestapsverificatie** aan:
   <https://myaccount.google.com/signinoptions/twosv>.
3. Maak een **app-wachtwoord**: <https://myaccount.google.com/apppasswords>.
   Naam: `Podiumagenda functie`. Je krijgt 16 tekens (zonder spaties
   gebruiken). Bewaar ze **alleen** in je wachtwoordmanager; niet in de repo,
   niet in een chat, niet in een notitie.
4. Stuur vanuit dat account één gewone mail naar jezelf, zodat het account
   "in gebruik" is.

## 2. Blaze aanzetten

1. Open <https://console.firebase.google.com/project/de-moeilijkste-keus/usage/details>.
2. Klik **Modify plan** → **Blaze (pay as you go)** → kies of maak een
   factureringsaccount (betaalkaart nodig) → bevestigen.
3. Controleer bovenaan dat er **Blaze** staat.

## 3. Back-up van Firestore (export)

1. Maak een bucket in dezelfde regio:
   ```sh
   gcloud storage buckets create gs://de-moeilijkste-keus-backup --location=europe-west4 --project=de-moeilijkste-keus
   ```
   (of via <https://console.cloud.google.com/storage/browser?project=de-moeilijkste-keus> → **Create**,
   naam `de-moeilijkste-keus-backup`, regio `europe-west4`).
2. Maak de export:
   ```sh
   gcloud firestore export gs://de-moeilijkste-keus-backup/voor-stap5 --project=de-moeilijkste-keus
   ```
3. Controleer dat de map `voor-stap5` in de bucket staat:
   <https://console.cloud.google.com/storage/browser/de-moeilijkste-keus-backup?project=de-moeilijkste-keus>.

## 4. Budget van €5 met alarmen en een Pub/Sub-topic

1. Maak eerst het topic:
   ```sh
   gcloud pubsub topics create budget-meldingen --project=de-moeilijkste-keus
   ```
   (of <https://console.cloud.google.com/cloudpubsub/topic/list?project=de-moeilijkste-keus> → **Create topic**,
   ID `budget-meldingen`, zonder standaardabonnement). De naam moet gelijk
   zijn aan `BUDGET_TOPIC` in `functions/.env`.
2. Open de budgetten: <https://console.cloud.google.com/billing/budgets?project=de-moeilijkste-keus>
   (kies zo nodig je factureringsaccount) → **Create budget**.
   - **Name**: `Podiumagenda`.
   - **Scope**: alleen project `de-moeilijkste-keus`; alle services.
   - **Amount**: *Specified amount*, **€5**, per maand.
   - **Thresholds**: 50%, 90% en 100% van *Actual*.
   - **Notifications**: vink *Email alerts to billing admins and users* aan.
   - Vink **Connect a Pub/Sub topic to this budget** aan en kies
     `projects/de-moeilijkste-keus/topics/budget-meldingen`.
3. **Finish**. Google stuurt nu een paar keer per dag de stand naar het topic;
   de functie doet alleen iets als de kosten boven €5 komen.

## 5. Cloud Billing API en de rol voor de stopfunctie

1. Zet de API aan: <https://console.cloud.google.com/apis/library/cloudbilling.googleapis.com?project=de-moeilijkste-keus>
   → **Enable** (of `gcloud services enable cloudbilling.googleapis.com --project=de-moeilijkste-keus`).
2. De functies draaien als het standaard service-account
   `836341833360-compute@developer.gserviceaccount.com`. Geef dat de rol
   **Project Billing Manager** op dit project:
   ```sh
   gcloud projects add-iam-policy-binding de-moeilijkste-keus \
     --member=serviceAccount:836341833360-compute@developer.gserviceaccount.com \
     --role=roles/billing.projectManager
   ```
   (of <https://console.cloud.google.com/iam-admin/iam?project=de-moeilijkste-keus> → **Grant access**).
   Bestaat het service-account nog niet, doe dit dan na stap 7 (de eerste
   deploy maakt het aan).

## 6. Geheimen instellen

In de map van de repo (elke opdracht vraagt de waarde; plak die, niets
verschijnt op het scherm):

```sh
npm run firebase -- login
npm run firebase -- functions:secrets:set GMAIL_USER
#   waarde: het nieuwe Gmail-adres uit stap 1
npm run firebase -- functions:secrets:set GMAIL_APP_PASSWORD
#   waarde: het app-wachtwoord uit stap 1 (16 tekens, zonder spaties)
```

De geheimen staan daarna in Secret Manager
(<https://console.cloud.google.com/security/secret-manager?project=de-moeilijkste-keus>),
niet in de repo. De CLI vraagt zo nodig of hij de Secret Manager API mag
aanzetten: **Yes**.

## 7. Rules en functions deployen

1. Alle tests groen (geen deploy bij rood):
   ```sh
   npm test && npm run test:rules && npm run test:e2e && npm run test:functions
   ```
2. Pakketten van de functies installeren:
   ```sh
   npm --prefix functions ci
   ```
3. Eerst de rules, dan de functions:
   ```sh
   npm run firebase -- deploy --only firestore:rules
   npm run firebase -- deploy --only functions
   ```
   Bij de eerste keer vraagt de CLI om API's aan te zetten (Cloud Functions,
   Cloud Build, Artifact Registry, Eventarc, Cloud Run, Pub/Sub): **Yes**.
   Vraagt hij om een **cleanup policy** voor Artifact Registry: **Yes**, 1 dag.
4. Controleer dat beide functies er staan, in **europe-west4**:
   <https://console.firebase.google.com/project/de-moeilijkste-keus/functions>
   (`uitnodigingsmail` en `stopFacturering`).
5. Doe stap 5.2 alsnog als het service-account er eerst niet was.
6. De app zelf (scherm Mail in Profiel) gaat live met de merge naar `main`;
   de mail werkt ook zonder die merge.

## 8. Testmail naar jezelf

Je hebt twee eigen Google-accounts nodig, **A** (organisator) en **B**
(ontvanger; daar komt de mail).

1. Log op <https://marlavb.github.io/de-moelijkste-keus/> in met A (gewoon
   venster) en met B (incognito). Beide met profiel, en vrienden van elkaar.
2. A plant een voorstelling in de toekomst → Profiel → Gepland →
   **Vrienden uitnodigen** → B aanvinken → **Uitnodigen**.
3. Binnen een minuut: in de inbox van B een mail van **Podiumagenda**,
   onderwerp "@A nodigt je uit voor …". Kijk ook in **Spam** (markeer hem dan
   als "Geen spam").
4. Controleer in de mail: titel, datum, tijd, theater en stad kloppen; de
   knop "Bekijk in Podiumagenda" opent Berichten; de link "Zet het uit in
   Profiel → Mail" opent het mailscherm; er staat geen e-mailadres van A in.
5. Controleer in Firestore
   (<https://console.firebase.google.com/project/de-moeilijkste-keus/firestore/data/~2FmailLog>):
   `mailLog/{planId}_{uid van B}` heeft `status: "verstuurd"`, en nergens staat
   een e-mailadres.
6. Controleer de logs (<https://console.cloud.google.com/logs/query;query=resource.labels.service_name%3D%22uitnodigingsmail%22?project=de-moeilijkste-keus>):
   `{"status":"verstuurd","planId":"…"}`, geen e-mailadres.
7. Mail uit: B zet Profiel → Mail uit; A nodigt B uit voor een andere
   voorstelling → geen mail; in de log staat `mail-uit`. Zet het daarna weer aan.

## 9. De billing-stop testen (DRY_RUN staat aan)

1. Stuur een nepbericht met een bedrag **boven** het budget:
   ```sh
   gcloud pubsub topics publish budget-meldingen --project=de-moeilijkste-keus \
     --message='{"budgetDisplayName":"Podiumagenda","costAmount":6,"budgetAmount":5,"currencyCode":"EUR"}'
   ```
2. Kijk in de logs van `stopFacturering`
   (<https://console.cloud.google.com/logs/query;query=resource.labels.service_name%3D%22stopfacturering%22?project=de-moeilijkste-keus>):
   je hoort `"status":"dry-run"` te zien. De facturering staat nog aan
   (<https://console.cloud.google.com/billing/projects>).
   - Zie je `PERMISSION_DENIED`: stap 5.2 is niet (goed) gedaan.
3. Stuur een bericht **onder** het budget (`"costAmount":1`) → `"status":"onder-budget"`.
4. Pas daarna de echte stop aanzetten: zet in `functions/.env`
   `DRY_RUN=false`, commit dat, en deploy alleen deze functie:
   ```sh
   npm run firebase -- deploy --only functions:stopFacturering
   ```
5. **Stuur na DRY_RUN=false géén bericht boven het budget**: dan gaat de
   facturering echt uit. Test alleen nog met een bedrag eronder
   (`"costAmount":1` → `onder-budget`).

**Wat er gebeurt als de facturering echt stopt:** het project valt terug
op het gratis Spark-abonnement. De functies (mail en deze stop) werken niet
meer; Firestore werkt door binnen de gratis dagquota (daarboven worden
reads/writes geweigerd tot de volgende dag). De app op GitHub Pages en het
inloggen blijven werken. Weer aanzetten: zie 10.4.

## 10. Alles weer uitzetten als het misgaat

1. **Alleen de mail stoppen** (snelst):
   ```sh
   npm run firebase -- functions:delete uitnodigingsmail --region europe-west4 --force
   ```
   De app blijft werken; uitnodigingen komen alleen nog in Berichten.
2. **De stopfunctie verwijderen**:
   ```sh
   npm run firebase -- functions:delete stopFacturering --region europe-west4 --force
   ```
3. **Rules terug naar de vorige versie**: in de console onder Firestore →
   **Rules** → geschiedenis een eerdere versie terugzetten, of
   ```sh
   git show 1d93fa1:firestore.rules > /tmp/rules-stap4.rules
   cp /tmp/rules-stap4.rules firestore.rules && npm run firebase -- deploy --only firestore:rules
   git checkout firestore.rules
   ```
4. **Facturering weer aan** (na een automatische stop):
   <https://console.cloud.google.com/billing/projects> → bij
   `de-moeilijkste-keus` **Change billing** → kies je factureringsaccount.
   Deploy daarna de functions opnieuw (stap 7.3).
5. **Terug naar Spark** (helemaal geen kosten meer): eerst beide functies
   verwijderen (10.1 en 10.2), dan
   <https://console.firebase.google.com/project/de-moeilijkste-keus/usage/details>
   → **Modify plan** → **Spark**.
6. **Gegevens terugzetten** uit de back-up van stap 3 (overschrijft
   documenten met dezelfde naam):
   ```sh
   gcloud firestore import gs://de-moeilijkste-keus-backup/voor-stap5 --project=de-moeilijkste-keus
   ```
7. **Geheimen weghalen** (bijvoorbeeld als het app-wachtwoord gelekt is):
   eerst het app-wachtwoord intrekken op <https://myaccount.google.com/apppasswords>,
   dan
   ```sh
   npm run firebase -- functions:secrets:destroy GMAIL_APP_PASSWORD
   ```
