# Profiel, vrienden en uitnodigingen — ontwerp, inventarisatie en voortgang

1 okt 2026. Sinds 10 okt 2026 in `docs/` (eerder in `debug/`). Historisch ontwerp en voortgang per stap; stap 6 (account verwijderen) is nog niet gebouwd.

---

## Voortgang: stap 0 en 1 (branch `vrienden`, 1 okt 2026)

Branch `vrienden` vanaf `main` (8629394). Twee commits, **niet gepusht**,
niet gemerged, rules **niet** uitgerold.

| Commit | Stap |
|---|---|
| `fe8a4ae` | Stap 0 — testopzet voor Firestore-rules met de emulator |
| `3792789` | Stap 1 — profiel: gebruikersnaam en volledige naam |

Rules-tests gedraaid (Java 21, via PATH): 48/48 groen. Daarna fix-commit
`3f39f1e`: `getAfter(…) == null` → `existsAfter(…)`, en create/update van
het profiel gesplitst in plaats van `?:` + `resource == null`, plus 6
gerichte tests. Nu **54/54** rules-tests en **239/239** `npm test`.

### Java installeren (jij)

De Firestore-emulator in `firebase-tools` 15.32 vraagt **Java 21 of hoger**
(`MIN_SUPPORTED_JAVA_MAJOR_VERSION = 21` in de CLI). Op je Mac (Apple M5, Homebrew 6):

```sh
brew install openjdk@21
sudo ln -sfn /opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk /Library/Java/JavaVirtualMachines/openjdk-21.jdk
java -version   # moet "openjdk version 21…" tonen
```

De tweede regel (met `sudo`) zorgt dat het systeem-`java` deze JDK vindt.
Zonder `sudo` kan het ook: zet
`export PATH="/opt/homebrew/opt/openjdk@21/bin:$PATH"` in `~/.zshrc`.

### Stap 0 — testopzet

`git diff --stat` (commit `fe8a4ae`):

```
 .firebaserc                  |    5 +
 .gitignore                   |    5 +
 README.md                    |   23 +-
 firebase.json                |   15 +
 firebase/package-lock.json   | 9566 ++++++++++++++++++++++++++++++++++++++++
 firebase/package.json        |   14 +
 firebase/tests/omgeving.js   |   27 +
 firebase/tests/users.test.js |   62 +
 package.json                 |    4 +-
 9 files changed, 9719 insertions(+), 2 deletions(-)
```

- `firebase/` met een eigen `package.json`: `firebase-tools` 15.32.1,
  `@firebase/rules-unit-testing` 5.0.2, `firebase` 12.19.0. De root-`package.json`
  en `package-lock.json` zijn niet zwaarder geworden; `npm ci` in
  `refresh-data.yml` installeert alleen nog playwright. `firebase/node_modules`
  valt onder de bestaande `node_modules/`-regel in `.gitignore`.
- `firebase.json`: alleen Firestore (rules = `firestore.rules`, emulator op
  127.0.0.1:**8085**, niet 8080, want dat gebruikt de README voor de lokale
  app-server; geen emulator-UI). `.firebaserc`: standaardproject
  `de-moeilijkste-keus` (alleen voor uitrollen; de tests gebruiken altijd
  `demo-podiumagenda`, dat nooit het echte project raakt).
- Scripts in de root: `npm run test:rules` (= `npm --prefix firebase test`:
  `firebase emulators:exec … "node --test --test-concurrency=1 tests/*.test.js"`)
  en `npm run firebase -- <args>` (de CLI uit `firebase/`).
- `.gitignore`: de logbestanden van de emulator.
- README: korte sectie "Rules testen en uitrollen".
- `firebase/tests/users.test.js` legt het **huidige** gedrag vast (6 tests):
  eigen document lezen, aanmaken, mergen, bijwerken en weghalen mag;
  willekeurige velden mogen (oude app-versies); het document van een ander:
  lezen, schrijven en weghalen geweigerd; uitgelogd niets; `list` op `users`
  geweigerd; buiten `users/` alles dicht.
- Na een verse clone: `npm --prefix firebase ci`.
- Opmerking: npm 11 voert install-scripts niet meer automatisch uit (o.a.
  `re2`, `protobufjs`). De CLI werkt zonder (`firebase --version` → 15.32.1);
  of de emulator ook zonder start, blijkt bij de eerste run met Java.

### Stap 1 — profiel

`git diff --stat` (commit `3792789`):

```
 firebase/tests/profiel.test.js | 260 +++++++++++++++++++++++++++++++++
 firestore.rules                | 118 +++++++++++++++++++
 public/css/styles.css          | 152 ++++++++++++++++++++++++
 public/index.html              |  66 +++++++++++
 public/js/app.js               | 242 +++++++++++++++++++++++++++++-
 public/js/firebase.js          |   3 +-
 public/js/profiel.js           | 135 +++++++++++++++++++++
 public/sw.js                   |   3 +-
 test/detail-ui.test.js         |   8 +-
 test/gezien-ui.test.js         |   8 +-
 test/navigatie.test.js         |   8 +-
 test/nepFirebase.js            |  39 +++++++
 test/profiel-ui.test.js        | 211 +++++++++++++++++++++++++++++++
 test/profiel.test.js           | 141 ++++++++++++++++++++++
 14 files changed, 1375 insertions(+), 19 deletions(-)
```

**Wat er gebouwd is**

- `public/js/profiel.js` (zonder imports, zodat app en emulator-tests
  dezelfde code draaien):
  - `controleerGebruikersnaam`: 3–20 tekens; `a–z A–Z 0–9 . _`; begint en
    eindigt met letter of cijfer; geen twee leestekens achter elkaar; spaties
    eromheen en een `@` vooraan vallen weg; hoofdletters blijven zichtbaar
    ("MarlaVB"), de sleutel is `marlavb`.
  - Gereserveerd: `admin, administrator, anoniem, beheer, beheerder,
    berichten, bot, contact, help, helpdesk, iedereen, info, moderator, null,
    profiel, root, support, system, systeem, team, theater, theaters,
    undefined, vrienden`, plus alles met `podiumagenda` of `podiumpas` erin.
    Dezelfde lijst staat in `firestore.rules`; een unit-test houdt ze gelijk.
  - `controleerNaam`: spaties samengevoegd, 1–60 tekens, geen stuurtekens.
  - `voorstelGebruikersnaam`: uit de Google-naam ("Anna de Vries" → `anna.de.vries`).
  - `bewaarProfiel`: **één transactie**: `usernames/{nieuw}` lezen (van een
    ander → "bezet"), profiel en `usernames/{nieuw}` schrijven, en
    `usernames/{oud}` weghalen als de naam anders is. `aangemaaktOp` blijft
    staan.
- `firestore.rules`: de `users`-regel is **letterlijk gelijk** gebleven.
  Nieuw: `usernames/{laag}` (alleen `get` voor ingelogden, `list: false`;
  aanmaken/bijwerken/weghalen alleen door de eigenaar en alleen passend bij
  het eigen profiel) en `profielen/{uid}` (lezen en schrijven alleen de
  eigenaar; `hasOnly` + `hasAll` op de velden, lengtes en vorm, `v == 1`,
  tijden = servertijd, `aangemaaktOp` onveranderlijk; het
  `usernames`-document moet na de transactie van jou zijn; een andere naam
  kiezen mag alleen als de oude in dezelfde transactie vrijkomt; weghalen
  alleen samen met de naam). Gevolg: elke gebruiker heeft hooguit één naam.
- UI:
  - Na inloggen zonder profiel, op Profiel (daar log je in, en daar komen
    bestaande gebruikers vanzelf langs): **één keer** het scherm
    `#/profiel/instellen` "Kies je gebruikersnaam", met voorstel en de
    Google-naam ingevuld, plus [Opslaan] en [Later]. Onthouden in
    `users/{uid}.profielGevraagd` (dus op al je apparaten).
  - In Profiel onder het inlogblok een regel: "@Anna_V · Anna de Vries
    [Wijzigen]", of "Nog geen gebruikersnaam… [Kiezen]", of "Je profiel kon
    niet worden geladen. [Opnieuw]".
  - Firestore onbereikbaar: laden → melding met "Opnieuw proberen", geen leeg
    formulier; opslaan → na hooguit 15 s "Opslaan lukte niet. Controleer je
    verbinding…", knop weer bruikbaar, ingevulde velden blijven staan. De rest
    van de app werkt gewoon door.
  - Fouten bij het veld (`aria-invalid`, `aria-describedby`, dikkere rand +
    tekst, niet alleen kleur); focus naar het eerste foute veld.
  - Uitgelogd: niets veranderd (geen regel, het instelscherm stuurt terug naar Profiel).
  - Tokens: alleen bestaande (`--surface`, `--control-border`, `--error-text`,
    `--text-2`, `--accent`/`--on-accent` voor Opslaan, `btn-secondary` voor
    Later). Nagemeten: `--error-text` op `--surface` 6,51:1 en op `--bg`
    6,03:1; `--text-2` op `--surface` 7,26:1; `--control-border` op
    `--surface` 3,24:1 (daarom staat het formulier op een `--surface`-kaart:
    op `--bg` haalt die rand precies 3,00:1); uitgeschakelde knop
    `--text-2` op `--soldout-bg` 5,56:1. Invoervelden 48 px, knoppen ≥ 44 px,
    lettergrootte 16 px (iOS zoomt anders in).
  - Service worker `podiumagenda-v30`, `profiel.js` in `APP_SHELL`.
- De drie bestaande UI-tests deelden elk een eigen nep-`firebase.js`
  zonder `runTransaction`; dat is nu één `test/nepFirebase.js` (uitgelogd
  standaard, zoals voorheen; optioneel ingelogd, met documenten in het
  geheugen en een offline-stand).

**Tests**

| Suite | Voor | Na | Nieuw |
|---|---|---|---|
| `npm test` (unit + UI, geen netwerk) | 222 | **239** ✅ | 11 unit (`test/profiel.test.js`), 6 UI (`test/profiel-ui.test.js`) |
| `npm run test:rules` (emulator) | 0 | **54** ✅ (na fix `3f39f1e`) | 6 `users`, 48 profiel |

Rules-tests profiel (42): kiezen; uniek met andere hoofdletters ("bezet");
**gelijktijdig** dezelfde naam via de transactie (ook `Zelfde`/`zELFDE`):
precies één wint en de verliezer heeft geen profiel; gelijktijdig rechtstreeks
zonder leescontrole: één geweigerd; wijzigen geeft de oude naam vrij en een
ander kan hem kiezen; alleen hoofdletters/naam wijzigen; `aangemaaktOp` blijft;
andere naam zonder vrijgeven geweigerd; naam en profiel niet los weg te halen
(wel samen); **kapen** (overschrijven, mergen, weghalen, overnemen via eigen
profiel, profiel dat naar andermans naam wijst); naam vastleggen voor een
ander; in andermans profiel schrijven; usernames zonder profiel; een tweede
naam vasthouden; `get` op naam (ingelogd ja, uitgelogd nee); **`list`
geweigerd** (ook met `where`) op `usernames` en `profielen`; profiel alleen
voor de eigenaar leesbaar; plus 24 **ongeldige** varianten (te kort/lang,
hoofdletters in de id, spatie, accent, punt vooraan, `_` achteraan, `..`,
gereserveerd, met podiumpas erin, weergave ≠ id, naam leeg/te lang/met
regeleinde/spatie achteraan/geen tekst, extra veld in profiel of usernames,
ander uid of naam in usernames, `v: 2`, zelfgekozen `aangemaaktOp` of
`gewijzigdOp`, ontbrekend veld), met een positieve controle van dezelfde
schrijfactie; en ongeldige invoer die al vóór Firestore wordt geweigerd.

**Volledige diff van `firestore.rules`** (t.o.v. `main`):

```diff
diff --git a/firestore.rules b/firestore.rules
index 58637a5..10bf3ed 100644
--- a/firestore.rules
+++ b/firestore.rules
@@ -9,5 +9,142 @@ service cloud.firestore {
     match /users/{userId} {
       allow read, write: if request.auth != null && request.auth.uid == userId;
     }
+
+    // ---- Profiel: gebruikersnaam en naam (vrienden, stap 1, okt 2026) ----
+    // Zie public/js/profiel.js. Een profiel en zijn usernames-document worden
+    // altijd samen geschreven (één transactie); de regels hieronder kijken
+    // daarom met getAfter/existsAfter naar de stand ná die transactie.
+
+    function ingelogd() {
+      return request.auth != null;
+    }
+
+    // Bestaan en inhoud ná de transactie. Altijd eerst ...Bestaat() checken
+    // voordat ...Na().data wordt gelezen.
+    function profielBestaat(uid) {
+      return existsAfter(/databases/$(database)/documents/profielen/$(uid));
+    }
+
+    function profielNa(uid) {
+      return getAfter(/databases/$(database)/documents/profielen/$(uid)).data;
+    }
+
+    function naamBestaat(laag) {
+      return existsAfter(/databases/$(database)/documents/usernames/$(laag));
+    }
+
+    function naamNa(laag) {
+      return getAfter(/databases/$(database)/documents/usernames/$(laag)).data;
+    }
+
+    // Gebruikersnaam in kleine letters (= document-id van usernames): 3–20
+    // tekens, a–z, 0–9, punt en liggend streepje, begint en eindigt met een
+    // letter of cijfer, geen twee leestekens achter elkaar.
+    function geldigeLaag(laag) {
+      return laag is string
+        && laag.size() >= 3 && laag.size() <= 20
+        && laag.matches('^[a-z0-9]+([._][a-z0-9]+)*$')
+        && !gereserveerd(laag);
+    }
+
+    // Zelfde lijst als GERESERVEERDE_NAMEN in public/js/profiel.js (een test
+    // houdt ze gelijk).
+    function gereserveerd(laag) {
+      return laag in ['admin', 'administrator', 'anoniem', 'beheer', 'beheerder', 'berichten', 'bot',
+          'contact', 'help', 'helpdesk', 'iedereen', 'info', 'moderator', 'null', 'profiel',
+          'root', 'support', 'system', 'systeem', 'team', 'theater', 'theaters', 'undefined',
+          'vrienden']
+        || laag.matches('.*(podiumagenda|podiumpas).*');
+    }
+
+    // Weergavevorm: dezelfde naam, hoofdletters toegestaan.
+    function geldigeWeergave(naam, laag) {
+      return naam is string && naam.lower() == laag && naam.matches('^[A-Za-z0-9._]+$');
+    }
+
+    // Volledige naam: 1–60 tekens, geen spatie aan begin of eind, geen
+    // regeleinden.
+    function geldigeVolledigeNaam(naam) {
+      return naam is string
+        && naam.size() >= 1 && naam.size() <= 60
+        && naam.matches('^[^\\s](.*[^\\s])?$');
+    }
+
+    match /usernames/{laag} {
+      // Alleen opvragen op de exacte naam; nooit een lijst.
+      allow get: if ingelogd();
+      allow list: if false;
+
+      allow create: if ingelogd()
+        && geldigeLaag(laag)
+        && request.resource.data.keys().hasOnly(['uid', 'gebruikersnaam', 'naam'])
+        && request.resource.data.keys().hasAll(['uid', 'gebruikersnaam', 'naam'])
+        && request.resource.data.uid == request.auth.uid
+        && geldigeWeergave(request.resource.data.gebruikersnaam, laag)
+        && geldigeVolledigeNaam(request.resource.data.naam)
+        && profielBestaat(request.auth.uid)
+        && profielNa(request.auth.uid).gebruikersnaamLaag == laag
+        && profielNa(request.auth.uid).gebruikersnaam == request.resource.data.gebruikersnaam
+        && profielNa(request.auth.uid).naam == request.resource.data.naam;
+
+      // Alleen de eigenaar, alleen weergave en naam (bv. "anna" → "Anna").
+      allow update: if ingelogd()
+        && resource.data.uid == request.auth.uid
+        && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['gebruikersnaam', 'naam'])
+        && geldigeWeergave(request.resource.data.gebruikersnaam, laag)
+        && geldigeVolledigeNaam(request.resource.data.naam)
+        && profielBestaat(request.auth.uid)
+        && profielNa(request.auth.uid).gebruikersnaamLaag == laag
+        && profielNa(request.auth.uid).gebruikersnaam == request.resource.data.gebruikersnaam
+        && profielNa(request.auth.uid).naam == request.resource.data.naam;
+
+      // Vrijgeven: alleen de eigenaar, en niet de naam die het profiel nog
+      // gebruikt (wel samen met het profiel, bij het verwijderen van een account).
+      allow delete: if ingelogd()
+        && resource.data.uid == request.auth.uid
+        && (!profielBestaat(request.auth.uid)
+          || profielNa(request.auth.uid).gebruikersnaamLaag != laag);
+    }
+
+    // Velden, vorm en de koppeling met usernames; voor aanmaken én wijzigen.
+    function geldigProfiel(uid) {
+      return request.resource.data.keys().hasOnly(['gebruikersnaam', 'gebruikersnaamLaag', 'naam', 'aangemaaktOp', 'gewijzigdOp', 'v'])
+        && request.resource.data.keys().hasAll(['gebruikersnaam', 'gebruikersnaamLaag', 'naam', 'aangemaaktOp', 'gewijzigdOp', 'v'])
+        && geldigeLaag(request.resource.data.gebruikersnaamLaag)
+        && geldigeWeergave(request.resource.data.gebruikersnaam, request.resource.data.gebruikersnaamLaag)
+        && geldigeVolledigeNaam(request.resource.data.naam)
+        && request.resource.data.v == 1
+        && request.resource.data.gewijzigdOp == request.time
+        // De naam is (na deze transactie) van mij, met dezelfde gegevens.
+        && naamBestaat(request.resource.data.gebruikersnaamLaag)
+        && naamNa(request.resource.data.gebruikersnaamLaag).uid == uid
+        && naamNa(request.resource.data.gebruikersnaamLaag).naam == request.resource.data.naam;
+    }
+
+    match /profielen/{uid} {
+      // Stap 1: alleen de eigenaar. Vrienden komen in stap 2.
+      allow get: if ingelogd() && request.auth.uid == uid;
+      allow list: if false;
+
+      // Nieuw profiel: aangemaaktOp is nu (servertijd).
+      allow create: if ingelogd()
+        && request.auth.uid == uid
+        && geldigProfiel(uid)
+        && request.resource.data.aangemaaktOp == request.time;
+
+      // Wijzigen: aangemaaktOp blijft gelijk; een andere naam mag alleen als de
+      // oude in dezelfde transactie vrijkomt.
+      allow update: if ingelogd()
+        && request.auth.uid == uid
+        && geldigProfiel(uid)
+        && request.resource.data.aangemaaktOp == resource.data.aangemaaktOp
+        && (resource.data.gebruikersnaamLaag == request.resource.data.gebruikersnaamLaag
+          || !naamBestaat(resource.data.gebruikersnaamLaag));
+
+      // Weghalen (account verwijderen) alleen samen met de gebruikersnaam.
+      allow delete: if ingelogd()
+        && request.auth.uid == uid
+        && !naamBestaat(resource.data.gebruikersnaamLaag);
+    }
   }
 }
```

**Uitrollen (jij, pas na een groene `npm run test:rules`):**

```sh
npm run firebase -- login                               # eenmalig, opent de browser
npm run firebase -- deploy --only firestore:rules       # project uit .firebaserc: de-moeilijkste-keus
```

Uitrollen kan vóór het mergen van de app-code: de nieuwe regels voegen
alleen iets toe, de `users`-regel is gelijk, en de huidige app op `main`
raakt `usernames`/`profielen` niet. Het is ook nodig om stap 1 met twee
accounts lokaal te testen, want de branch staat niet op GitHub Pages.

**Testen met twee Google-accounts** (na het uitrollen van de rules; lokaal
`npx serve public` of `python3 -m http.server 8080 --directory public`, twee
browserprofielen A en B, `localhost` staat al bij de toegestane domeinen):

1. A logt in op Profiel → scherm "Kies je gebruikersnaam" met voorstel en
   Google-naam → [Later] → Profiel toont "Nog geen gebruikersnaam [Kiezen]".
   Herladen en op Profiel komen: het scherm komt **niet** terug. Op een tweede
   apparaat met A ook niet.
2. A kiest `Marla` → Profiel toont "@Marla · …".
3. B logt in en probeert `marla` en `MARLA` → "Deze gebruikersnaam is al bezet".
4. A wijzigt naar `MarlaVB` → B kan nu `marla` kiezen.
5. A wijzigt alleen hoofdletters (`marlavb`) en de naam → lukt; de oude
   `MarlaVB` blijft van A (zelfde naam).
6. Probeer `admin`, `podiumpas.fan`, `ab`, `marla..vb`, `anna de vries`, een
   naam van 61 tekens → nette melding bij het veld.
7. Offline (vliegtuigmodus of DevTools → Network → Offline) → Profiel openen
   → "Je profiel kon niet worden geladen [Opnieuw]"; Agenda werkt nog;
   online → [Opnieuw]. Offline opslaan → melding binnen 15 s.
8. Uitloggen → Profiel ziet er uit als voorheen; watchlist/gepland/gezien
   lokaal ongewijzigd. Inloggen → sync zoals altijd.
9. Console → Firestore → Data: `profielen/{uid}` en `usernames/marla…`
   bevatten precies de verwachte velden, **geen e-mailadres**.

**Risico's stap 1**

- **Rules-tests nog niet gedraaid** (Java). De regels gebruiken
  `getAfter` op een document dat niet bestaat (`== null`) en een ternary;
  beide horen te werken in rules v2, maar dat bevestigt pas de emulator.
- **Uitrollen vóór mergen**: zolang de rules wel en de app niet live staan,
  gebeurt er niets (niemand schrijft naar `profielen`). Andersom (app live
  zonder rules) zou elk opslaan "Opslaan lukte niet" geven: dus eerst rules.
- **Oude app-versie**: de oude app leest/schrijft alleen `users/{uid}` en
  laat het nieuwe veld `profielGevraagd` staan (merge). Een oude
  `index.html` met nieuwe `app.js` (na een deploy) heeft geen instelscherm:
  de app slaat de vraag dan over (`els.screens.profielInstellen` ontbreekt).
- **Vrijgegeven naam meteen beschikbaar** (zie "Aangenomen" hieronder).
- **Eenmalige vraag alleen op Profiel**: wie na inloggen nooit naar Profiel
  gaat, krijgt de vraag niet (bewust: geen popup boven de agenda).
- **Opslaan na een timeout alsnog gelukt**: dan zie je een foutmelding
  terwijl de naam wél van jou is; nogmaals opslaan geeft hetzelfde
  resultaat (idempotent), dus geen schade.
- `profielen/{uid}` is in stap 1 alleen voor jezelf leesbaar; stap 2 breidt
  dat uit naar vrienden.

---

## Voortgang: stap 2 — vriendschappen (2 okt 2026)

Branch `vrienden`: stap 0/1 zijn gepusht (`origin/vrienden`, 3 commits).
Stap 2 = drie commits, **niet gepusht**, rules **niet** uitgerold.

| Commit | Deel |
|---|---|
| `4ef7eb8` | Rules en datalaag (`vrienden.js`) + 39 emulator-tests + 6 unit-tests |
| `65948b7` | Vrienden-tegel en -scherm, service worker v31 + 12 UI-tests |
| `91cdded` | Persoonlijke uitnodigingslink + 9 UI-tests |

### Tests

| Suite | Vóór stap 2 | Na stap 2 |
|---|---|---|
| `npm test` | 239 | **266** ✅ (+6 unit, +12 UI vrienden, +9 UI link) |
| `npm run test:rules` | 54 | **93** ✅ (+39 vrienden) |

Mutatietests (verzwakken, testen, herstellen; telkens de juiste test rood):
1. rules: `!geblokkeerdTussen` weg bij een verzoek → "geblokkeerd: geen verzoek …";
2. rules: `!existsAfter(token)` weg → "link gebruiken zonder het token weg te halen";
3. rules: profiel `get` voor iedereen → beide profiel-leestests;
4. rules: toestemmingseis weg bij een vriendschap → 7 misbruiktests;
5. app: tegenverzoek niet meer accepteren → UI-test "meteen vrienden";
6. app: token niet weghalen bij gebruik → UI-test link + 3 emulator-tests.

### Firestore-reads (Spark-limiet: 50.000/dag)

- **Profiel openen**: 1 read (`getCountFromServer` op inkomende verzoeken).
- **Vrienden openen**: 5 queries (vrienden, inkomend, uitgaand, geblokkeerd,
  eigen links), elk het aantal documenten en minstens 1, plus per vriend 2
  (het profiel + de `exists`-controle in de rules). Voorbeeld met 5
  vrienden, 1 verzoek en verder niets: 5 + 1 + 1 + 1 + 1 + 10 = **19 reads**.
  Na elke actie (accepteren, verbreken, …) wordt opnieuw geladen: nog eens zoveel.
- **Zoeken**: 1 read. **Verzoek sturen**: 4 reads (controles) + de rules
  (~6 `get/exists`). **Link openen**: 3 reads.
- Niets is live (`onSnapshot`); bij ~10 gebruikers blijft het ver onder de limiet.

### Aannames (stuur bij als je het anders wilt)

1. **Blokkeren kan ook bij een inkomend verzoek** (via ⋯), niet alleen bij
   een vriend: anders kan een vreemde na elke weigering opnieuw een verzoek sturen.
2. **Namen in verzoeken, links en de blokkeerlijst zijn een momentopname**:
   de ontvanger is nog geen vriend en mag het profiel niet lezen. De
   vriendenlijst gebruikt wel altijd het actuele profiel.
3. **Elke tik op "Deel uitnodigingslink" maakt een nieuwe link**; je kunt er
   meer tegelijk open hebben. Verlopen eigen links worden opgeruimd bij het
   openen van Vrienden.
4. **Wie een link opent, ziet de gebruikersnaam en naam van de eigenaar**
   (die heeft de link zelf gedeeld).
5. **Alles wat de rules weigeren bij een verzoek** geeft "Verzoek kan niet
   worden verstuurd." Dus niet alleen een blokkade, zodat die niet af te
   leiden is. Bij een link: "Deze link kan niet (meer) worden gebruikt.",
   dezelfde tekst als bij een net gebruikte link.
6. **Na vrienden worden via een link** worden openstaande verzoeken tussen
   jullie opgeruimd.
7. **Verbreken en blokkeren geven de ander geen melding.**
8. **De tellers op de tegel** tellen alleen inkomende verzoeken (geen live
   update; bij openen van Profiel).

### Risico's

- **Eerst de rules uitrollen, dan testen.** Zonder de nieuwe rules weigert
  Firestore alles in de nieuwe collecties; de app toont dan "Verzoek kan
  niet worden verstuurd" of "Je vrienden konden niet worden geladen".
- **Geen limiet op verzoeken of links.** Iemand die gebruikersnamen raadt, kan
  verzoeken sturen (per persoon één tegelijk). Tegenmaatregel nu: weigeren
  en blokkeren. Een echte limiet vraagt een Cloud Function (stap 5, Blaze).
- **Delen na het opslaan**: op een traag netwerk kan de browser het
  deelmenu weigeren; dan wordt de link gekopieerd en staat hij in beeld.
- **Dode velden**: `token` blijft in het vriendschapsdocument staan na
  gebruik via een link (onschadelijk; het token bestaat niet meer).
- **`getCountFromServer`** werkt alleen online; offline is de teller leeg
  (geen foutmelding, de tegel werkt gewoon).
- **Oude app-versies** raken de nieuwe collecties niet; `users/{uid}` is
  ongewijzigd.
- Account verwijderen (opruimen van vriendschappen, links, verzoeken,
  blokkades) volgt in stap 6.

### Uitrollen (jij)

```sh
npm run test:rules                                   # 93 groen
npm run firebase -- deploy --only firestore:rules
```

### Afvinklijst (A = gewoon Chrome, B = incognito; beide met profiel)

Lokaal: `python3 -m http.server 8080 --bind 127.0.0.1 --directory public`,
open `http://localhost:8080`.

1. [ ] **Tegel**: A en B zien in Profiel de tegel "Vrienden" (zonder teller).
   Uitgelogd: geen tegel.
2. [ ] **Zoeken**: A zoekt `@b` (deel van de naam) → "Vul een volledige
   gebruikersnaam in"; een onbekende naam → "Niemand gevonden"; zijn eigen
   naam → "Dat ben je zelf"; de naam van B in HOOFDLETTERS →
   "@B · Naam" [Verzoek sturen].
3. [ ] **Verzoek**: A stuurt; staat onder "Verstuurd". B herlaadt Profiel →
   tegel "1 nieuw verzoek" met teller; in Vrienden onder "Verzoeken voor jou".
4. [ ] **Weigeren en intrekken**: B weigert → weg bij beiden (A herlaadt).
   A stuurt opnieuw en trekt in → weg bij beiden.
5. [ ] **Accepteren**: A stuurt, B accepteert → bij beiden onder "Vrienden",
   met de actuele naam. A wijzigt zijn naam in Profiel → B ziet na herladen
   de nieuwe naam.
6. [ ] **Tegenverzoek**: verbreek (A: ⋯ → Vriendschap verbreken → Ja). B stuurt
   A een verzoek; A zoekt B → "Heeft jou een verzoek gestuurd" [Accepteren] →
   direct vrienden.
7. [ ] **Verbreken**: B verbreekt via ⋯ (eerst Annuleren proberen) → bij
   beiden weg.
8. [ ] **Link**: A tikt "Deel uitnodigingslink" → deelmenu of "Link
   gekopieerd"; de link staat onder "Openstaande links" met "Geldig tot …"
   (7 dagen). Plak de link in het incognitovenster (B) → "Word vrienden met
   @A?" → Ja → vrienden; bij A is de link verdwenen.
9. [ ] **Link opnieuw gebruiken**: open dezelfde link nog eens in B → "Deze
   link werkt niet (meer)…". Open de link in A → "Dit is je eigen
   uitnodigingslink" (maak daarvoor een nieuwe).
10. [ ] **Link intrekken**: A maakt een link en trekt hem in; B opent hem →
    "werkt niet (meer)".
11. [ ] **Link uitgelogd**: log B uit, open een nieuwe link van A → "Log in om
    de uitnodiging te bekijken" → inloggen → vraag verschijnt. (Optioneel
    met een derde account zonder profiel: eerst "Kies eerst een
    gebruikersnaam", na opslaan terug naar de link.)
12. [ ] **Blokkeren**: A ⋯ bij B → Blokkeren → bevestigen → vriendschap weg
    bij beiden; B staat bij A onder "Geblokkeerd". B zoekt A en stuurt een
    verzoek → **"Verzoek kan niet worden verstuurd."** (geen hint over
    blokkeren). A maakt een link, B opent hem → vraag verschijnt, maar
    "Ja" → "Deze link kan niet (meer) worden gebruikt."
13. [ ] **A probeert B**: A zoekt B en stuurt een verzoek → "Je hebt @B
    geblokkeerd. Deblokkeer eerst…".
14. [ ] **Deblokkeren**: A → Geblokkeerd → Deblokkeren → B kan weer een
    verzoek sturen.
15. [ ] **Terug en history**: Profiel → Vrienden → terug = Profiel. Een
    link direct geopend → terug = Profiel. Browserterug en vegen doen hetzelfde.
16. [ ] **Offline** (DevTools → Network → Offline): Vrienden openen → "Je
    vrienden konden niet worden geladen" [Opnieuw proberen]; online →
    werkt. Agenda blijft werken.
17. [ ] **Console**: in `vriendverzoeken`, `vrienden`, `uitnodigingslinks`,
    `blokkades` staan alleen de verwachte velden, **geen e-mailadressen**.

### Volledige diff van `firestore.rules` t.o.v. de uitgerolde versie (`3f39f1e`)

```diff
diff --git a/firestore.rules b/firestore.rules
index 10bf3ed..5639b9c 100644
--- a/firestore.rules
+++ b/firestore.rules
@@ -122,8 +122,9 @@ service cloud.firestore {
     }
 
     match /profielen/{uid} {
-      // Stap 1: alleen de eigenaar. Vrienden komen in stap 2.
-      allow get: if ingelogd() && request.auth.uid == uid;
+      // De eigenaar en vrienden (stap 2). Er staan alleen gebruikersnaam en
+      // naam in; wie geen vriend is, ziet alleen wat usernames/{naam} geeft.
+      allow get: if ingelogd() && (request.auth.uid == uid || isVriendVan(uid, request.auth.uid));
       allow list: if false;
 
       // Nieuw profiel: aangemaaktOp is nu (servertijd).
@@ -146,5 +147,165 @@ service cloud.firestore {
         && request.auth.uid == uid
         && !naamBestaat(resource.data.gebruikersnaamLaag);
     }
+
+    // ---- Vriendschappen (vrienden, stap 2, okt 2026) ----
+    // Zie public/js/vrienden.js.
+    //   vriendverzoeken/{van}_{naar}       openstaand verzoek
+    //   vrienden/{eigenaar}/lijst/{vriend}  één document per richting; altijd
+    //                                       samen aangemaakt (batch)
+    //   uitnodigingslinks/{token}           eenmalig, 7 dagen geldig
+    //   blokkades/{uid}/lijst/{ander}       alleen voor uid zelf zichtbaar
+    // Een vriendschap ontstaat alleen met toestemming van de ander: diens
+    // verzoek aan jou (dat in dezelfde batch verdwijnt) of diens geldige
+    // link (die in dezelfde batch verdwijnt).
+
+    // `eigenaar` heeft `lezer` als vriend.
+    function isVriendVan(eigenaar, lezer) {
+      return exists(/databases/$(database)/documents/vrienden/$(eigenaar)/lijst/$(lezer));
+    }
+
+    function heeftGeblokkeerd(wie, wien) {
+      return exists(/databases/$(database)/documents/blokkades/$(wie)/lijst/$(wien));
+    }
+
+    function geblokkeerdTussen(a, b) {
+      return heeftGeblokkeerd(a, b) || heeftGeblokkeerd(b, a);
+    }
+
+    function heeftProfiel(uid) {
+      return exists(/databases/$(database)/documents/profielen/$(uid));
+    }
+
+    function profielNu(uid) {
+      return get(/databases/$(database)/documents/profielen/$(uid)).data;
+    }
+
+    // 24 willekeurige bytes als base64url (192 bits).
+    function geldigToken(token) {
+      return token is string && token.matches('^[A-Za-z0-9_-]{32}$');
+    }
+
+    function linkPad(token) {
+      return /databases/$(database)/documents/uitnodigingslinks/$(token);
+    }
+
+    // Verzoek-id "van_naar"; Firebase-uids bevatten geen liggend streepje.
+    function betrokkenBijVerzoek(id) {
+      return ingelogd()
+        && id.split('_').size() == 2
+        && (id.split('_')[0] == request.auth.uid || id.split('_')[1] == request.auth.uid);
+    }
+
+    match /vriendverzoeken/{id} {
+      // Opvragen en weghalen (intrekken, weigeren, na accepteren, bij
+      // blokkeren) op id, ook als het verzoek niet (meer) bestaat.
+      allow get, delete: if betrokkenBijVerzoek(id);
+      // Lijsten: alleen je eigen inkomende of uitgaande verzoeken.
+      allow list: if ingelogd()
+        && (resource.data.van == request.auth.uid || resource.data.naar == request.auth.uid);
+      allow update: if false;
+
+      allow create: if ingelogd()
+        && request.resource.data.keys().hasOnly(['van', 'naar', 'vanGebruikersnaam', 'vanNaam', 'naarGebruikersnaam', 'naarNaam', 'aangemaaktOp'])
+        && request.resource.data.keys().hasAll(['van', 'naar', 'vanGebruikersnaam', 'vanNaam', 'naarGebruikersnaam', 'naarNaam', 'aangemaaktOp'])
+        && request.resource.data.van == request.auth.uid
+        && request.resource.data.naar is string
+        && request.resource.data.naar != request.auth.uid
+        && id == request.auth.uid + '_' + request.resource.data.naar
+        && request.resource.data.aangemaaktOp == request.time
+        // Afzender: gegevens uit het eigen profiel.
+        && heeftProfiel(request.auth.uid)
+        && request.resource.data.vanGebruikersnaam == profielNu(request.auth.uid).gebruikersnaam
+        && request.resource.data.vanNaam == profielNu(request.auth.uid).naam
+        // Ontvanger: gevonden op de exacte gebruikersnaam.
+        && request.resource.data.naarGebruikersnaam is string
+        && request.resource.data.naarGebruikersnaam.matches('^[A-Za-z0-9._]{3,20}$')
+        && exists(/databases/$(database)/documents/usernames/$(request.resource.data.naarGebruikersnaam.lower()))
+        && get(/databases/$(database)/documents/usernames/$(request.resource.data.naarGebruikersnaam.lower())).data.uid == request.resource.data.naar
+        && request.resource.data.naarNaam == get(/databases/$(database)/documents/usernames/$(request.resource.data.naarGebruikersnaam.lower())).data.naam
+        // Geen vrienden al, geen verzoek de andere kant op (dan accepteren),
+        // geen blokkade in een van beide richtingen.
+        && !isVriendVan(request.auth.uid, request.resource.data.naar)
+        && !exists(/databases/$(database)/documents/vriendverzoeken/$(request.resource.data.naar + '_' + request.auth.uid))
+        && !geblokkeerdTussen(request.auth.uid, request.resource.data.naar);
+    }
+
+    // `ander` gaf `ik` toestemming: een verzoek van ander aan ik, of een
+    // geldige link van ander. Dat verzoek of die link verdwijnt in dezelfde batch.
+    function toestemmingVan(ander, ik) {
+      return (request.resource.data.via == 'verzoek'
+          && !('token' in request.resource.data)
+          && exists(/databases/$(database)/documents/vriendverzoeken/$(ander + '_' + ik))
+          && !existsAfter(/databases/$(database)/documents/vriendverzoeken/$(ander + '_' + ik)))
+        || (request.resource.data.via == 'link'
+          && geldigToken(request.resource.data.token)
+          && exists(linkPad(request.resource.data.token))
+          && get(linkPad(request.resource.data.token)).data.uid == ander
+          && request.time < get(linkPad(request.resource.data.token)).data.aangemaaktOp + duration.value(7, 'd')
+          && !existsAfter(linkPad(request.resource.data.token)));
+    }
+
+    match /vrienden/{eigenaar}/lijst/{vriend} {
+      allow read: if ingelogd() && request.auth.uid == eigenaar;
+      allow update: if false;
+      // Verbreken (en blokkeren) mag elk van beiden, ook als het document al weg is.
+      allow delete: if ingelogd() && (request.auth.uid == eigenaar || request.auth.uid == vriend);
+
+      allow create: if ingelogd()
+        && eigenaar != vriend
+        && request.resource.data.keys().hasOnly(['uid', 'sinds', 'via', 'token'])
+        && request.resource.data.keys().hasAll(['uid', 'sinds', 'via'])
+        && request.resource.data.uid == vriend
+        && request.resource.data.sinds == request.time
+        && request.resource.data.via in ['verzoek', 'link']
+        && heeftProfiel(request.auth.uid)
+        // Beide richtingen in dezelfde batch.
+        && existsAfter(/databases/$(database)/documents/vrienden/$(vriend)/lijst/$(eigenaar))
+        && !geblokkeerdTussen(eigenaar, vriend)
+        && ((request.auth.uid == eigenaar && toestemmingVan(vriend, eigenaar))
+          || (request.auth.uid == vriend && toestemmingVan(eigenaar, vriend)));
+    }
+
+    match /uitnodigingslinks/{token} {
+      // Alleen het exacte token opvragen; een lijst alleen van je eigen links.
+      allow get: if ingelogd();
+      allow list: if ingelogd() && resource.data.uid == request.auth.uid;
+      allow update: if false;
+
+      allow create: if ingelogd()
+        && geldigToken(token)
+        && request.resource.data.keys().hasOnly(['uid', 'gebruikersnaam', 'naam', 'aangemaaktOp'])
+        && request.resource.data.keys().hasAll(['uid', 'gebruikersnaam', 'naam', 'aangemaaktOp'])
+        && request.resource.data.uid == request.auth.uid
+        && request.resource.data.aangemaaktOp == request.time
+        && heeftProfiel(request.auth.uid)
+        && request.resource.data.gebruikersnaam == profielNu(request.auth.uid).gebruikersnaam
+        && request.resource.data.naam == profielNu(request.auth.uid).naam;
+
+      // Intrekken door de eigenaar, of gebruiken: wie in dezelfde batch via
+      // precies deze link vriend van de eigenaar wordt.
+      allow delete: if ingelogd()
+        && (resource.data.uid == request.auth.uid
+          || (existsAfter(/databases/$(database)/documents/vrienden/$(resource.data.uid)/lijst/$(request.auth.uid))
+            && getAfter(/databases/$(database)/documents/vrienden/$(resource.data.uid)/lijst/$(request.auth.uid)).data.get('token', '') == token));
+    }
+
+    match /blokkades/{uid}/lijst/{ander} {
+      // Alleen voor jezelf. Anderen kunnen een blokkade niet zien of weghalen
+      // (de rules hierboven gebruiken exists(), dat geen leesrecht vraagt).
+      allow read: if ingelogd() && request.auth.uid == uid;
+      allow update: if false;
+      allow delete: if ingelogd() && request.auth.uid == uid;
+      allow create: if ingelogd()
+        && request.auth.uid == uid
+        && ander != uid
+        && request.resource.data.keys().hasOnly(['uid', 'gebruikersnaam', 'naam', 'sinds'])
+        && request.resource.data.keys().hasAll(['uid', 'gebruikersnaam', 'naam', 'sinds'])
+        && request.resource.data.uid == ander
+        && request.resource.data.gebruikersnaam is string
+        && request.resource.data.gebruikersnaam.matches('^[A-Za-z0-9._]{3,20}$')
+        && geldigeVolledigeNaam(request.resource.data.naam)
+        && request.resource.data.sinds == request.time;
+    }
   }
 }
```

---

## Voortgang: stap 3 — privacy-instellingen en vriendenprofiel (2 okt 2026)

Branch `vrienden`, gepusht tot `aafd7f5`. Niet uitgerold, niet gemerged.

| Commit | Deel | Stat |
|---|---|---|
| `ebfc643` | (aanscherping stap 2) vriendschap alleen samen weghalen | 2 bestanden, +48 −2 |
| `8c3917e` | Rules en datalaag `gedeeld.js` + 27 emulator- en 6 unit-tests | 4 bestanden, +613 |
| `9f0524d` | Instelling, eenmalige melding, kopie schrijven, sw v32 + 6 UI-tests | 6 bestanden, +598 −5 |
| `1cfb001` | Vriendenprofiel + eenvoudig itemscherm + 8 UI-tests | 5 bestanden, +584 −8 |
| `aafd7f5` | `privacy.html` + links + 2 tests | 7 bestanden, +198 −3 |

Tests: `npm test` 266 → **288** ✅; `npm run test:rules` 97 → **124** ✅.

Opslag: één document per onderdeel (`gedeeld/{uid}/onderdelen/{gezien|watchlist}`),
instelling in `gedeeld/{uid}` (niet in `profielen`: profiel-rules en -tests
blijven ongewijzigd; het bestaan van het document = de keuze is gemaakt).
Item ~250–350 bytes; max 1000 items → < ~350 KB (limiet 1 MiB). De rules
controleren de buitenkant (velden, types, ≤ 1000 items, `stand` niet lager,
servertijd) maar niet de items één voor één (rules kunnen geen lijst
doorlopen); de app maakt items schoon bij schrijven én lezen. Alternatief
(één document per item, wel per veld te controleren) kost ~1 read per item
per vriendenprofiel.

Optioneel ("Ook op de watchlist van …") **weggelaten**: per vriend per
sessie 2 documenten + ~3 rules-reads, dus meer dan de gevraagde 1 read per vriend.

Mergen naar main: (1) `npm run test:rules` → deploy rules; (2) contactadres
invullen in `privacy.html`; (3) merge, `npm test`, `npm run safe-push`.
Afvinklijst en aannames: zie het chatrapport van 2 okt.

### Volledige diff van `firestore.rules` t.o.v. de uitgerolde versie (`ebfc643`)

```diff
diff --git a/firestore.rules b/firestore.rules
index 63fbb35..c650708 100644
--- a/firestore.rules
+++ b/firestore.rules
@@ -311,5 +311,71 @@ service cloud.firestore {
         && geldigeVolledigeNaam(request.resource.data.naam)
         && request.resource.data.sinds == request.time;
     }
+
+    // ---- Delen met vrienden (vrienden, stap 3, okt 2026) ----
+    // Zie public/js/gedeeld.js.
+    //   gedeeld/{uid}                      instelling { gezien, watchlist }
+    //   gedeeld/{uid}/onderdelen/{gezien|watchlist}  uitgeklede kopie
+    // Lezen: de eigenaar, en vrienden zolang het onderdeel gedeeld wordt
+    // (ook als de kopie er na het uitzetten nog zou staan). Schrijven: alleen
+    // de eigenaar, alleen een gedeeld onderdeel, en nooit een oudere stand
+    // over een nieuwere heen. De rules kunnen de items in de lijst niet één
+    // voor één controleren; de app maakt ze schoon bij schrijven en lezen.
+
+    function deeltMetVrienden(eigenaar, onderdeel) {
+      return exists(/databases/$(database)/documents/gedeeld/$(eigenaar))
+        && get(/databases/$(database)/documents/gedeeld/$(eigenaar)).data[onderdeel] == true;
+    }
+
+    function geldigeKopie(uid, onderdeel) {
+      return ingelogd()
+        && request.auth.uid == uid
+        && onderdeel in ['gezien', 'watchlist']
+        && existsAfter(/databases/$(database)/documents/gedeeld/$(uid))
+        && getAfter(/databases/$(database)/documents/gedeeld/$(uid)).data[onderdeel] == true
+        && request.resource.data.keys().hasOnly(['items', 'stand', 'nv', 'v', 'bijgewerktOp'])
+        && request.resource.data.keys().hasAll(['items', 'stand', 'nv', 'v', 'bijgewerktOp'])
+        && request.resource.data.items is list
+        && request.resource.data.items.size() <= 1000
+        && request.resource.data.stand is int
+        && request.resource.data.stand >= 0
+        && request.resource.data.nv is int
+        && request.resource.data.nv >= 1
+        && request.resource.data.v == 1
+        && request.resource.data.bijgewerktOp == request.time;
+    }
+
+    match /gedeeld/{uid} {
+      // Vrienden mogen de instelling zien (alleen twee ja/nee-velden), zodat
+      // de app "@naam deelt dit niet" kan tonen.
+      allow get: if ingelogd() && (request.auth.uid == uid || isVriendVan(uid, request.auth.uid));
+      allow list: if false;
+      allow create, update: if ingelogd()
+        && request.auth.uid == uid
+        && request.resource.data.keys().hasOnly(['gezien', 'watchlist', 'gewijzigdOp'])
+        && request.resource.data.keys().hasAll(['gezien', 'watchlist', 'gewijzigdOp'])
+        && request.resource.data.gezien is bool
+        && request.resource.data.watchlist is bool
+        && request.resource.data.gewijzigdOp == request.time;
+      // Weghalen (account verwijderen) alleen samen met de kopieën.
+      allow delete: if ingelogd()
+        && request.auth.uid == uid
+        && !existsAfter(/databases/$(database)/documents/gedeeld/$(uid)/onderdelen/gezien)
+        && !existsAfter(/databases/$(database)/documents/gedeeld/$(uid)/onderdelen/watchlist);
+
+      match /onderdelen/{onderdeel} {
+        allow get: if ingelogd()
+          && onderdeel in ['gezien', 'watchlist']
+          && (request.auth.uid == uid
+            || (isVriendVan(uid, request.auth.uid) && deeltMetVrienden(uid, onderdeel)));
+        allow list: if false;
+        allow delete: if ingelogd() && request.auth.uid == uid;
+        allow create: if geldigeKopie(uid, onderdeel);
+        // Nooit een oudere stand over een nieuwere (een tweede apparaat dat
+        // nog niet gesynchroniseerd is).
+        allow update: if geldigeKopie(uid, onderdeel)
+          && request.resource.data.stand >= resource.data.stand;
+      }
+    }
   }
 }
```

---

## Voortgang: stap 4 — uitnodigen voor een voorstelling (2 okt 2026)

Branch `vrienden` (bijgewerkt vanaf main `1f55da9`), gepusht tot `07d38c6`.
Niet uitgerold, niet gemerged.

| Commit | Deel |
|---|---|
| `cdcb10e` | 4a-1 rules (plannen, leden, inbox) + `plannen.js` + koppelPlan/zetMetWie + 23 emulator- en 10 unit-tests |
| `f64325f` | 4a-2 uitnodigen, "met wie", kaarten, weggaan/opheffen, sw v33 + 6 UI-tests |
| `4b9c558` | 4b Berichten, teller (enige onSnapshot), Ik ga mee/Kan niet, metWie in Gezien + 11 UI-tests + 1 unit-test |
| `07d38c6` | "Uit je planning halen" bij een gedeeld plan ook voor de organisator + 1 UI-test |

Tests: `npm test` 290 → **319** ✅; `npm run test:rules` 124 → **147** ✅.
Mail (stap 5): de functie reageert op het aanmaken van
`plannen/{planId}/leden/{uid}` met rol `gast` en status `uitgenodigd`.
Afvinklijst, aannames en risico's: zie het chatrapport van 2 okt (stap 4).

---

## Beslissingen (1 okt 2026)

Door jou genomen:

- **Persoonlijke uitnodigingslink**: maakt direct vrienden, maar is
  **eenmalig bruikbaar en 7 dagen geldig**. Ontwerpwijziging voor stap 2:
  `uitnodigingslinks/{token}` krijgt `verlooptOp ≤ nu + 7 dagen`; een
  vriendschap "via link" mag alleen ontstaan als het token vóór de batch
  bestaat (`exists`/`get`), niet verlopen is, van de ander is, **én in
  dezelfde batch wordt weggehaald** (`!existsAfter`). Een tweede gebruik
  vindt geen token meer. Een doorgestuurde link werkt dus voor precies één
  persoon, en de eigenaar ziet in Vrienden wie hem gebruikte (en kan
  verbreken of blokkeren).
- Mail bij uitnodiging **standaard aan**, uit te zetten in Profiel; geen mail
  bij een vriendschapsverzoek.
- Gasten nodigen niet zelf uit (v1); geen vrije tekst bij uitnodigingen (v1).
- "Kaarten" zichtbaar voor wie meegaan, alleen binnen het plan (veld
  `kaarten` in het deelnemer-document).
- Blokkeren: simpel, in stap 2.
- Firestore-locatie volgt; de functieregio wordt pas in stap 5 vastgelegd.
- Blaze pas vlak vóór stap 5; stap 0 t/m 4 werken zonder Blaze (alleen
  Firestore, Auth en rules; geen functions, geen Secret Manager, geen TTL nodig).
  TTL-beleid (berichten na 90 dagen) is pas in stap 5 met Blaze; tot dan
  worden berichten niet automatisch opgeruimd (bij 10 gebruikers geen punt).
- De console-rules zijn inhoudelijk gelijk aan `firestore.rules`.

### Aangenomen (mijn advies; stuur bij als je het anders wilt)

1. **Vrijgegeven gebruikersnaam** is meteen beschikbaar voor een ander (geen
   wachttijd). Vrienden en plannen hangen aan de uid, dus een naamswijziging
   breekt niets. *Gebouwd zo in stap 1.*
2. **Gezien delen**: per voorstelling titel, sterren, "laatst gezien"
   (datum) en aantal bezoeken; geen zaal, status, url of podiumpas. *Stap 3.*
3. **Geen eigen domein** voorlopig: mail via een apart Gmail-account met
   app-wachtwoord. *Stap 5.*
4. **Budget voor de automatische stop: €5 per maand**, alarmen op 25/50/90/100%,
   stop bij > 100%. *Vóór stap 5.*
5. **Firebase-gereedschap in een eigen map** `firebase/` met eigen
   `package.json`. *Gebouwd zo in stap 0.*
6. **"Tijd gewijzigd / afgelast"** alleen in Gepland en het detailscherm
   (zoals nu, per persoon uit `shows.json`), niet als bericht in Berichten.
   Later eventueel afgeleid in Berichten, zonder Firestore-writes. *Stap 4.*

---

# Oorspronkelijk ontwerp (stap 1 van het onderzoek, 1 okt 2026)


## Samenvatting in vijf punten

1. **`users/{uid}` blijft privé en blijft zoals het is.** Firestore-rules werken
   per document: wie een document mag lezen, ziet *alle* velden. In dat ene
   document staan nu watchlist, gepland, gezien, tombstones, favorieten en
   theaterkeuze. Profiel, gedeelde lijsten, vriendschappen en plannen komen
   daarom in **nieuwe, aparte collecties**. Oude app-versies blijven gewoon
   naar `users/{uid}` schrijven; die regel blijft ongewijzigd.
2. **Vrienden lezen een kopie, niet het origineel.** Je eigen app schrijft een
   uitgeklede kopie van je Gezien (met sterren) en Watchlist naar
   `gedeeld/{uid}/onderdelen/{gezien|watchlist}`. Uitzetten in Profiel = die
   kopie weghalen; de rules controleren de vriendschap én de instelling.
3. **E-mailadressen komen nooit in Firestore.** De mailfunctie haalt het adres
   server-side uit Firebase Auth (Admin SDK) op basis van een uid. Clients
   kunnen de mail-collecties niet lezen of schrijven. Daardoor kan niemand mail
   naar een willekeurig adres laten sturen.
4. **Server-side alleen twee functies:** `stuurUitnodigingsmail` (op het
   aanmaken van een uitnodiging) en `stopFacturering` (op de budgetmelding).
   Al het andere (profiel, verzoeken, accepteren, plannen, berichten,
   account verwijderen) gaat client-side, bewaakt door de rules.
5. **Mail: een apart Gmail-account met app-wachtwoord**, tenzij je een eigen
   domein wilt. Brevo kan zonder eigen domein geen gmail.com-afzender
   authenticeren en zet er dan een `…@…brevosend.com`-adres voor (zie D.3).

---

## A. Inventarisatie van wat er nu is

### A.1 Firebase-bestanden en uitrol

| Wat | Status |
|---|---|
| `firestore.rules` | Bestaat (repo-root, 13 regels). |
| `firebase.json` | **Bestaat niet.** |
| `.firebaserc` | **Bestaat niet.** |
| `functions/` | **Bestaat niet.** |
| `firebase` CLI lokaal | Niet geïnstalleerd (`which firebase` → niets). |
| Java (nodig voor de Firestore-emulator) | **Niet geïnstalleerd** ("Unable to locate a Java Runtime"). |
| Node lokaal / in CI | v26.7.0 lokaal; `refresh-data.yml` gebruikt Node 20. |

**Uitrol van de rules gebeurt nu met de hand in de console**: README stap 3
("Firestore Database → Rules → plak de inhoud van `firestore.rules` →
Publish"). Er is dus geen garantie dat de console gelijkloopt met het bestand.
Vóór stap 1 van het bouwplan: in de console de huidige rules bekijken en
vergelijken met het bestand.

Huidige rules (volledig):

```
match /users/{userId} {
  allow read, write: if request.auth != null && request.auth.uid == userId;
}
```

Alles daarbuiten is dicht.

Hosting: GitHub Pages via `.github/workflows/deploy.yml` (upload van
`public/`), URL `https://marlavb.github.io/de-moelijkste-keus/`. Firebase
Hosting wordt niet gebruikt. Project-id: `de-moeilijkste-keus` (let op: met
"ei", de repo heet `de-moelijkste-keus`).

### A.2 Inloggen

- `public/js/firebase.js`: Firebase 12.17.1 via de gstatic-CDN, alleen Auth +
  Firestore. Geëxporteerd: `signInWithPopup`, `signOut`, `onAuthStateChanged`,
  `doc`, `getDoc`, `setDoc`, `serverTimestamp`.
- **Eén provider: Google** (`GoogleAuthProvider`, popup). Gevolg: elk account
  heeft een geverifieerd e-mailadres in Auth. Dat gebruiken we voor de mail.
- De knop "Inloggen met Google" staat in `#authBox` bovenaan het
  **Profiel**-scherm (`renderAuthBox`, [app.js:1692](public/js/app.js#L1692)).
  De README zegt nog "op het Theaters-scherm"; dat klopt niet meer.
- De ingelogde weergave toont `displayName`/`email` en de Google-foto
  (`photoURL`). Die komen uit Auth en worden **niet** in Firestore opgeslagen.

### A.3 Firestore-structuur nu

Eén document per gebruiker: **`users/{uid}`**. Alle velden staan in de root
van het document en worden geschreven met `setDoc(ref, …, { merge: true })`:

```jsonc
// users/{uid}
{
  "favorites": ["delamar::Rüdsichtlos", …],   // oud, blijft als back-up (CLAUDE.md)
  "favoritesMigrated": true,
  "enabledTheaters": { "delamar": true, … },
  "updatedAt": <serverTimestamp>,            // alleen bij aanmaken

  // watchlist.js
  "watchlist": [{ "sleutel": "rudsichtlos | ruud smulders", "titel": "Rüdsichtlos – Ruud Smulders",
                  "theaterId": "delamar", "toegevoegdOp": 1759300000000, "v": 4 }],
  "watchlistVerwijderd": [{ "sleutel": "…", "verwijderdOp": 1759300000000 }],

  // gepland.js — sleutel = theaterId|datum|tijd|ruimeTitel
  "gepland": [{ "sleutel": "delamar|2026-10-01|20:30|rudsichtlos | ruud smulders",
                "titel": "…", "theaterId": "delamar", "theaterNaam": "DeLaMar", "stad": "Amsterdam",
                "datum": "2026-10-01", "tijd": "20:30", "reserverenUrl": "…",
                "status": "gepland" | "kaarten", "toegevoegdOp": …, "gewijzigdOp": …,
                "vervallen?": "afgelast" | "verplaatst", "maker?", "genre?", "locatie?", "zaal?", "podiumpas?": true }],
  "geplandVerwijderd": [{ "sleutel": "…", "verwijderdOp": … }],

  // gezien.js
  "gezien": [{ "sleutel": "…", "titel": "…", "sleutelTitel": "…", "theaterId": "…",
               "bron": "planning" | "handmatig", "toegevoegdOp": …, "gewijzigdOp": …, "v": 4,
               "beoordeling?": 4.5, "beoordeeldOp?": …,
               "bezoeken": [{ "datum", "tijd", "theaterId", "theaterNaam?", "stad?", "locatie?", "zaal?",
                              "titel?", "maker?", "genre?", "status?", "url?", "podiumpas?" }] }],
  "gezienVerwijderd": [{ "sleutel": "…", "verwijderdOp": … }]
}
```

Tombstones (`…Verwijderd`) en tijdstempels zorgen dat bij samenvoegen de
laatste actie wint (`voegSamen`, `voegGeplandSamen`, `voegGezienSamen`).
Onbekende velden op items blijven bij samenvoegen behouden (de functies
kopiëren items met `{ ...item }`). Dat is belangrijk voor de migratie (B.9).

### A.4 Sync en samenvoegen

- `handleAuthChange` ([app.js:1596](public/js/app.js#L1596)): bij inloggen één
  **`getDoc`** (geen `onSnapshot`; wijzigingen op een ander apparaat zie je pas
  na herladen).
  - Document bestaat: cloud is leidend voor `favorites`/`enabledTheaters`;
    `cloudWatchlist/cloudGepland/cloudGezien` worden gevuld.
  - Document bestaat niet: aanmaken met favorieten, theaterkeuze,
    `favoritesMigrated`, `updatedAt`; lege cloudlijsten.
- `syncProfielForCurrentUser` ([app.js:824](public/js/app.js#L824)): voegt de
  lokale (uitgelogde) lijsten samen met de cloudlijsten (`laadWatchlist/
  laadGepland/laadGezien` met `extra`), schrijft alleen bij een verschil, en
  draait daarna `verwerkVoorbijePlannen` (kaarten → Gezien).
- `saveWatchlist/saveGepland/saveGezien`: ingelogd en cloud geladen →
  `setDoc(merge)` naar `users/{uid}`; anders `localStorage`.
- Uitgelogd: alles in `localStorage` (`podiumagenda:watchlist`, `:gepland`,
  `:gezien`, `:favorites`, `:enabledTheaters`, …). **Dat blijft precies zo.**

### A.5 UI-structuur nu

- Eén pagina (`public/index.html`) met `<section class="screen">`'s:
  `screen-agenda`, `screen-detail`, `screen-gezien`, `screen-theaters`,
  `screen-profiel`. Hash-routes: `#/`, `#/show/<id>`, `#/gezien/<sleutel>`,
  `#/theaters`, `#/profiel` (`#/favorieten` → `#/profiel`).
- Eigen navigatiegeschiedenis met `diepte` en scrollpositie (`navigate`,
  `vervang`, `terug`, sinds 1 okt). Nieuwe schermen moeten via `navigate()`
  en een terugknop met `terug('#/profiel')`, net als `screen-gezien`.
- Onderbalk `#bottomNav`: Agenda · Theaters · Profiel (`.nav-item`, 52 px hoog).
  Verborgen op detail- en gezien-schermen.
- **Profiel** (van boven naar beneden): kop "Profiel", `#authBox`
  (inloggen/uitloggen), dan in `.profile-lists` een linkerkolom met
  "Ben je geweest?" (`#vraagSection`, alleen als er iets te vragen is),
  "Gepland", "Gezien", en rechts (desktop) of eronder (telefoon) "Watchlist".
- Er bestaat al een `.badge`-stijl (accent-cirkel, 20 px, voor het
  filtericoon) die we kunnen hergebruiken voor de ongelezen-teller.
- Service worker `sw.js` (`podiumagenda-v29`): JS/CSS/HTML network-first,
  `APP_SHELL`-lijst met alle modules. Nieuwe modules moeten in `APP_SHELL`
  (offline) en `CACHE_NAME` omhoog.
- Feedbackformulier op Theaters gaat via Formspree (staat los van dit ontwerp,
  maar hoort wel in de privacytekst).

### A.6 Tests nu

`npm test` = `node --test test/*.test.js`. UI-tests (`navigatie`, `detail-ui`,
`gezien-ui`) draaien de echte app in Playwright met een **nep-`firebase.js`**
(uitgelogd) via `ctx.route`. Er zijn nog geen tests tegen Firestore of de rules.

---

## B. Ontwerp

### B.1 Overzicht van de collecties

| Pad | Wat | Leesbaar voor | Schrijfbaar door |
|---|---|---|---|
| `users/{uid}` | bestaand privédocument + mailvoorkeur | alleen jij | alleen jij (ongewijzigd) |
| `usernames/{naamLaag}` | uniekheid + exact zoeken | ingelogd, **alleen `get`** | eigenaar |
| `profielen/{uid}` | gebruikersnaam, naam, deelinstellingen | jij + vrienden | jij |
| `gedeeld/{uid}/onderdelen/{gezien\|watchlist}` | kopie voor vrienden | jij + vrienden als gedeeld | jij |
| `vriendverzoeken/{van}_{naar}` | openstaand verzoek | van en naar | aanmaken: van; weghalen: van of naar |
| `vrienden/{uid}/lijst/{vriendUid}` | "ik deel met deze vriend" | jij | zie rules (B.3) |
| `uitnodigingslinks/{token}` | persoonlijke link | ingelogd, **alleen `get`** | eigenaar |
| `blokkades/{uid}/lijst/{anderUid}` | geblokkeerd | jij | jij |
| `plannen/{planId}` | gedeeld plan (momentopname voorstelling) | deelnemers | eigenaar (aanmaken/weghalen) |
| `plannen/{planId}/deelnemers/{uid}` | uitnodiging + reactie per persoon | deelnemers | eigenaar (uitnodigen), persoon zelf (reageren) |
| `inbox/{uid}/berichten/{id}` | Berichten in de app | jij | afzender (gekoppeld aan een echte actie), jij (gelezen/weg) |
| `mailLog/{id}`, `mailTellers/{datum}` | idempotentie en limieten | **niemand** (alleen Admin SDK) | **niemand** (alleen Admin SDK) |

Waarom geen profiel in `users/{uid}` (zoals in je voorstel): vrienden moeten
je naam kunnen lezen, en een read-regel op `users/{uid}` zou ook je hele
Gepland, tombstones en theaterkeuze vrijgeven. Bovendien schrijven oude
app-versies vrij naar `users/{uid}`, dus validatie op dat document zou ze
breken.

### B.2 Datamodel met voorbeelddocumenten

**`users/{uid}`** (bestaand; alleen een veld erbij, privé):

```jsonc
{ …alles van nu…,
  "meldingen": { "mailUitnodigingen": true },   // "geen mails meer" in Profiel
  "profielGevraagd": true }                      // eenmalige vraag na inloggen al getoond/overgeslagen
```

**`profielen/{uid}`**:

```jsonc
{
  "gebruikersnaam": "MarlaVB",          // weergave, met hoofdletters
  "gebruikersnaamLaag": "marlavb",      // = id van het usernames-document
  "naam": "Marla van Broekhoven",
  "delen": { "gezien": true, "watchlist": true },   // standaard aan
  "aangemaaktOp": <serverTimestamp>, "gewijzigdOp": <serverTimestamp>,
  "v": 1
}
```

Gebruikersnaam: 3–20 tekens `a–z 0–9 . _`, opgeslagen als `toLowerCase()` na
`normalize('NFKC')`; geen spaties; gereserveerd: `admin`, `podiumagenda`,
`support`, `help`, `beheer`, `bot`, `null`, … (lijst in code + rules-regex
voor de vorm; de lijst zelf in code is genoeg).

**`usernames/{naamLaag}`**:

```jsonc
{ "uid": "abc123", "gebruikersnaam": "MarlaVB", "naam": "Marla van Broekhoven" }
```

Zoeken = `getDoc(usernames/<invoer laag>)`. `list` is dicht, dus geen
openbare lijst en geen zoeken op een deel van een naam. (Raden van exacte
namen kan wel; dan zie je alleen gebruikersnaam en naam, zoals je wilt.)

Wijzigen = één **batch** (de rules maken het een transactie-achtige check):
nieuw `usernames`-doc aanmaken (faalt als het bestaat), oud weghalen,
`profielen` bijwerken. Vrienden en plannen hangen aan de uid, dus een
naamswijziging breekt niets. Wel geldt: de oude naam is meteen vrij voor
iemand anders (zie Open vragen).

**`gedeeld/{uid}/onderdelen/watchlist`**:

```jsonc
{ "v": 4,  // NORMALISATIE_VERSIE van de schrijver
  "items": [{ "sleutel": "rudsichtlos | ruud smulders", "titel": "Rüdsichtlos – Ruud Smulders", "theaterId": "delamar" }],
  "bijgewerktOp": <serverTimestamp> }
```

**`gedeeld/{uid}/onderdelen/gezien`**:

```jsonc
{ "v": 4,
  "items": [{ "sleutel": "…", "titel": "…", "theaterId": "delamar",
              "beoordeling": 4.5,                    // alleen als gezet
              "laatsteBezoek": "2026-09-12", "aantalBezoeken": 2 }],
  "bijgewerktOp": <serverTimestamp> }
```

Bewust niet gedeeld: tombstones, tijdstempels, `bron`, de bezoekdetails
(zaal, status kaarten/gepland, url, podiumpas). De kopie wordt door je eigen
app geschreven na elke `saveWatchlist`/`saveGezien` (2 s debounce, alleen als
de inhoud anders is) en bij inloggen. Staat `delen.gezien` uit, dan wordt het
document weggehaald.

Matchen bij de lezer ("Ook op de watchlist van …"): als `v` gelijk is aan de
eigen `NORMALISATIE_VERSIE`, de `sleutel` gebruiken; anders de sleutel
**opnieuw berekenen** met `watchlistSleutel(titel, theaterId)`. Zo werken
vriendenlijsten ook als een vriend een oudere of nieuwere app heeft, en straks
met de aliaslijst van stap B (de alias zit dan in `watchlistSleutel` zelf).

**`vriendverzoeken/{van}_{naar}`**:

```jsonc
{ "van": "uidA", "naar": "uidB",
  "vanNaam": "Anna de Vries", "vanGebruikersnaam": "anna",
  "aangemaaktOp": <serverTimestamp> }
```

**`vrienden/{uid}/lijst/{vriendUid}`** — één per richting, dus twee per vriendschap:

```jsonc
{ "uid": "uidB", "sinds": <serverTimestamp>, "via": "verzoek" | "link", "token?": "…" }
```

Het bestaan van `vrienden/A/lijst/B` betekent: *A deelt met B*. Lezen van A's
profiel en gedeelde lijsten vereist dat dit document bestaat. Verbreken =
beide documenten weg (dat mag elk van beiden).

**`uitnodigingslinks/{token}`** (token = 22 tekens base64url uit
`crypto.getRandomValues`, 128 bit):

```jsonc
{ "uid": "uidA", "gebruikersnaam": "anna", "naam": "Anna de Vries",
  "verlooptOp": <Timestamp, max. 14 dagen> }
```

Link: `https://marlavb.github.io/de-moelijkste-keus/#/vriend-link/<token>`.
Wie hem opent (ingelogd, met profiel) ziet "Word vrienden met Anna (anna)?" en
na "Ja" worden beide vriendschapsdocumenten in één batch gemaakt; de rules
checken het token. "Nieuwe link maken" haalt de oude weg.

**`blokkades/{uid}/lijst/{anderUid}`**: `{ "sinds": … }`. Blokkeren haalt in
dezelfde batch ook de vriendschap en openstaande verzoeken weg.

**`plannen/{planId}`** (planId = automatisch Firestore-id):

```jsonc
{
  "eigenaar": "uidA",
  "sleutel": "delamar|2026-10-01|20:30|rudsichtlos | ruud smulders",   // geplandSleutel() bij aanmaken
  "sleutelV": 4,
  "voorstelling": { "titel": "Rüdsichtlos – Ruud Smulders", "theaterId": "delamar", "theaterNaam": "DeLaMar",
                    "stad": "Amsterdam", "datum": "2026-10-01", "tijd": "20:30",
                    "reserverenUrl": "…", "maker?": "…", "genre?": "…" },
  "start": <Timestamp 2026-10-01T20:30+02:00>,   // voor de rules: niet in het verleden
  "aangemaaktOp": <serverTimestamp>
}
```

Het plan is, net als een gepland-item, een **momentopname**. Het plan wordt na
aanmaken niet meer gewijzigd. Gewijzigde tijd of afgelast hoeft daarom niet in
het plan: elke deelnemer heeft het plan ook als gewoon gepland-item, en elke
app koppelt dat zelf aan dezelfde `shows.json` (`koppel()` → "Tijd gewijzigd
(was 20:30)", `markeerVervallen` → "Afgelast"). Iedereen ziet de wijziging dus
vanzelf, zonder dat apparaten het plan om het hardst gaan bijwerken (dat zou
schrijfconflicten en kosten geven).

**`plannen/{planId}/deelnemers/{uid}`**:

```jsonc
{ "uid": "uidB", "planId": "…",
  "rol": "eigenaar" | "gast",
  "naam": "Bas", "gebruikersnaam": "bas",                 // momentopname voor weergave
  "status": "gaat" | "uitgenodigd" | "afgeslagen" | "afgemeld",
  "uitgenodigdDoor": "uidA", "uitgenodigdOp": <ts>, "reactieOp?": <ts>,
  "kaarten?": true,                                        // optioneel, zie Open vragen
  "start": <Timestamp>,  "titel": "…", "datum": "2026-10-01"   // voor de lijst "mijn uitnodigingen" zonder extra reads
}
```

"Mijn plannen/uitnodigingen" = collection-group-query
`collectionGroup('deelnemers').where('uid','==',ik)`.

**Koppeling met je eigen Gepland.** Bij accepteren (en voor de eigenaar bij
het aanmaken) krijgt het gewone gepland-item één extra veld:

```jsonc
{ "sleutel": "delamar|2026-10-01|20:30|…", …, "planId": "Xy12…" }
```

- `planId` is de vaste koppeling. De `sleutel` kan veranderen (titel
  uitgebreid via `werkPlannenBij`, of een nieuwe normalisatie); `planId` niet.
- `voegGeplandSamen` moet `planId` doorgeven zoals nu `vervallen`/`INFO_VELDEN`
  (een kopie met `planId` vult een kopie zonder aan).
- Status "kaarten" blijft in het eigen gepland-item, per persoon.
- Uit je planning halen (tombstone) → je app zet je deelnemer-status op
  `afgemeld`. Opnieuw plannen met dezelfde sleutel → status weer `gaat`.
- Normalisatie v4 / stap B: het plan bewaart titel, theaterId, datum en tijd,
  dus `geplandSleutel()` kan altijd opnieuw worden berekend; `sleutelV` zegt
  met welke versie de opgeslagen sleutel is gemaakt. Een aliaslijst in stap B
  verandert dus niets aan de koppeling.

**`inbox/{uid}/berichten/{id}`** — vaste id's per gebeurtenis, zodat dubbel
tikken of twee apparaten geen dubbele berichten geven:

| soort | id | geschreven door | gekoppeld aan |
|---|---|---|---|
| `vriendverzoek` | `verzoek_{van}` | verzoeker | `vriendverzoeken/{van}_{ik}` bestaat |
| `vriend-geaccepteerd` | `vriend_{van}` | accepteerder | `vrienden/{ik}/lijst/{van}` bestaat |
| `uitnodiging` | `uitnodiging_{planId}` | eigenaar plan | deelnemer-doc met `uitgenodigdDoor = van` |
| `reactie` | `reactie_{planId}_{van}` | gast | gast heeft gereageerd; ontvanger = eigenaar |

```jsonc
{ "soort": "uitnodiging", "van": "uidA", "vanNaam": "Anna de Vries",
  "planId": "…", "titel": "Rüdsichtlos – Ruud Smulders", "datum": "2026-10-01", "tijd": "20:30",
  "status?": "gaat",                 // alleen bij soort reactie
  "gelezen": false, "aangemaaktOp": <serverTimestamp>, "verlooptOp": <ts + 90 dagen> }
```

Geen vrije tekst in berichten (geen spam- of misbruikkanaal, zie Open vragen).
Opruimen: Firestore **TTL-beleid** op `verlooptOp` (90 dagen).

**`mailLog/{uitnodiging_{planId}_{uid}}`** en **`mailTellers/{JJJJ-MM-DD}`**:
alleen voor de Cloud Function (idempotentie en dagtellers), ook met TTL
(30 dagen). Er is géén `mail`-collectie waar clients in schrijven.

### B.3 Security rules (ontwerp)

Uitgangspunten: alles wat niet genoemd is, is dicht; `list` alleen waar een
query nodig is; velden vastgelegd met `keys().hasOnly(...)`; namen en titels
in berichten/verzoeken moeten overeenkomen met de bron (geen nep-afzender).

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    function ingelogd() { return request.auth != null; }
    function ik(uid) { return ingelogd() && request.auth.uid == uid; }
    function docPad(p) { return /databases/$(database)/documents/$(p); }   // alleen ter illustratie;
    // in de echte rules schrijven we de paden uit, bv. /databases/$(database)/documents/vrienden/$(a)/lijst/$(b)
    function deeltMet(eigenaar, lezer) {      // eigenaar deelt met lezer
      return exists(/databases/$(database)/documents/vrienden/$(eigenaar)/lijst/$(lezer));
    }
    function profiel(uid) { return get(/databases/$(database)/documents/profielen/$(uid)).data; }
    function geblokkeerd(door, wie) {
      return exists(/databases/$(database)/documents/blokkades/$(door)/lijst/$(wie));
    }
    function naamOk(s) { return s is string && s.size() >= 1 && s.size() <= 80; }

    // ---- Bestaand, ONGEWIJZIGD (oude app-versies schrijven hier vrij) ----
    match /users/{userId} {
      allow read, write: if ik(userId);
    }

    // ---- Gebruikersnamen ----
    match /usernames/{laag} {
      allow get: if ingelogd();
      allow list: if false;
      allow create: if ik(request.resource.data.uid)
        && laag.matches('^[a-z0-9._]{3,20}$')
        && request.resource.data.keys().hasOnly(['uid', 'gebruikersnaam', 'naam'])
        && request.resource.data.gebruikersnaam.lower() == laag
        && naamOk(request.resource.data.naam)
        && getAfter(/databases/$(database)/documents/profielen/$(request.auth.uid)).data.gebruikersnaamLaag == laag
        && getAfter(/databases/$(database)/documents/profielen/$(request.auth.uid)).data.naam == request.resource.data.naam;
      allow update: if ik(resource.data.uid)
        && request.resource.data.uid == resource.data.uid
        && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['naam', 'gebruikersnaam'])
        && request.resource.data.gebruikersnaam.lower() == laag
        && getAfter(/databases/$(database)/documents/profielen/$(request.auth.uid)).data.naam == request.resource.data.naam;
      allow delete: if ik(resource.data.uid);
    }

    // ---- Profiel ----
    match /profielen/{uid} {
      allow get: if ik(uid) || (ingelogd() && deeltMet(uid, request.auth.uid));
      allow list: if false;
      allow create, update: if ik(uid)
        && request.resource.data.keys().hasOnly(['gebruikersnaam', 'gebruikersnaamLaag', 'naam', 'delen', 'aangemaaktOp', 'gewijzigdOp', 'v'])
        && naamOk(request.resource.data.naam)
        && request.resource.data.delen.keys().hasOnly(['gezien', 'watchlist'])
        && request.resource.data.delen.gezien is bool && request.resource.data.delen.watchlist is bool
        && getAfter(/databases/$(database)/documents/usernames/$(request.resource.data.gebruikersnaamLaag)).data.uid == uid
        // naam gewijzigd → de oude naam moet in dezelfde batch vrijkomen
        && (resource == null || resource.data.gebruikersnaamLaag == request.resource.data.gebruikersnaamLaag
            || !existsAfter(/databases/$(database)/documents/usernames/$(resource.data.gebruikersnaamLaag)));
      allow delete: if ik(uid);
    }

    // ---- Gedeelde kopie van Gezien / Watchlist ----
    match /gedeeld/{uid}/onderdelen/{onderdeel} {
      allow get: if ik(uid)
        || (ingelogd() && deeltMet(uid, request.auth.uid) && profiel(uid).delen[onderdeel] == true);
      allow list: if false;
      allow write: if ik(uid) && onderdeel in ['gezien', 'watchlist']
        && request.resource.data.keys().hasOnly(['items', 'v', 'bijgewerktOp'])
        && request.resource.data.items is list;
      allow delete: if ik(uid);
    }

    // ---- Vriendschapsverzoeken ----
    match /vriendverzoeken/{id} {
      allow read: if ingelogd() && (resource.data.van == request.auth.uid || resource.data.naar == request.auth.uid);
      allow create: if ingelogd()
        && request.resource.data.van == request.auth.uid
        && id == request.auth.uid + '_' + request.resource.data.naar
        && request.resource.data.naar != request.auth.uid
        && request.resource.data.keys().hasOnly(['van', 'naar', 'vanNaam', 'vanGebruikersnaam', 'aangemaaktOp'])
        && exists(/databases/$(database)/documents/profielen/$(request.resource.data.naar))
        && !deeltMet(request.auth.uid, request.resource.data.naar)               // nog geen vrienden
        && !geblokkeerd(request.resource.data.naar, request.auth.uid)
        && request.resource.data.vanNaam == profiel(request.auth.uid).naam
        && request.resource.data.vanGebruikersnaam == profiel(request.auth.uid).gebruikersnaam;
      allow update: if false;
      allow delete: if ingelogd() && (resource.data.van == request.auth.uid || resource.data.naar == request.auth.uid);
    }

    // ---- Vriendschappen (één document per richting) ----
    match /vrienden/{eigenaar}/lijst/{vriend} {
      function ander() { return request.auth.uid == eigenaar ? vriend : eigenaar; }
      allow read: if ik(eigenaar);
      allow create: if ingelogd()
        && (request.auth.uid == eigenaar || request.auth.uid == vriend)
        && eigenaar != vriend
        && request.resource.data.uid == vriend
        && !geblokkeerd(eigenaar, vriend) && !geblokkeerd(vriend, eigenaar)
        && (
          // accepteren: de ander heeft MIJ een verzoek gestuurd (toestemming van de ander)
          (request.resource.data.via == 'verzoek'
            && exists(/databases/$(database)/documents/vriendverzoeken/$(ander() + '_' + request.auth.uid)))
          ||
          // persoonlijke link van de ander, niet verlopen
          (request.resource.data.via == 'link'
            && get(/databases/$(database)/documents/uitnodigingslinks/$(request.resource.data.token)).data.uid == ander()
            && get(/databases/$(database)/documents/uitnodigingslinks/$(request.resource.data.token)).data.verlooptOp > request.time)
        );
      allow update: if false;
      allow delete: if ingelogd() && (request.auth.uid == eigenaar || request.auth.uid == vriend);
    }

    match /uitnodigingslinks/{token} {
      allow get: if ingelogd();
      allow list: if false;
      allow create: if ik(request.resource.data.uid) && token.size() >= 22
        && request.resource.data.keys().hasOnly(['uid', 'gebruikersnaam', 'naam', 'verlooptOp'])
        && request.resource.data.verlooptOp <= request.time + duration.value(14, 'd')
        && request.resource.data.naam == profiel(request.auth.uid).naam;
      allow update: if false;
      allow delete: if ik(resource.data.uid);
    }

    match /blokkades/{uid}/lijst/{ander} {
      allow read, write: if ik(uid);
    }

    // ---- Gedeelde plannen ----
    match /plannen/{planId} {
      function isDeelnemer() {
        return exists(/databases/$(database)/documents/plannen/$(planId)/deelnemers/$(request.auth.uid));
      }
      allow get: if ingelogd() && (resource.data.eigenaar == request.auth.uid || isDeelnemer());
      allow list: if false;
      allow create: if ingelogd() && request.resource.data.eigenaar == request.auth.uid
        && request.resource.data.keys().hasOnly(['eigenaar', 'sleutel', 'sleutelV', 'voorstelling', 'start', 'aangemaaktOp'])
        && request.resource.data.start > request.time
        && getAfter(/databases/$(database)/documents/plannen/$(planId)/deelnemers/$(request.auth.uid)).data.rol == 'eigenaar';
      allow update: if false;
      allow delete: if ingelogd() && resource.data.eigenaar == request.auth.uid;

      match /deelnemers/{uid} {
        function plan() { return get(/databases/$(database)/documents/plannen/$(planId)).data; }
        function planNa() { return getAfter(/databases/$(database)/documents/plannen/$(planId)).data; }
        allow read: if ingelogd() && (isDeelnemer() || plan().eigenaar == request.auth.uid);
        allow create: if ingelogd() && request.resource.data.uid == uid && request.resource.data.planId == planId && (
          // eigenaar zet zichzelf erin bij het aanmaken
          (ik(uid) && planNa().eigenaar == uid
            && request.resource.data.rol == 'eigenaar' && request.resource.data.status == 'gaat')
          ||
          // eigenaar nodigt een vriend uit (die vriend deelt met de eigenaar = heeft geaccepteerd)
          (planNa().eigenaar == request.auth.uid && uid != request.auth.uid
            && deeltMet(uid, request.auth.uid) && deeltMet(request.auth.uid, uid)
            && !geblokkeerd(uid, request.auth.uid)
            && request.resource.data.rol == 'gast' && request.resource.data.status == 'uitgenodigd'
            && request.resource.data.uitgenodigdDoor == request.auth.uid
            && request.resource.data.naam == profiel(uid).naam
            && planNa().start > request.time)
        );
        // reageren, afmelden, kaarten: alleen je eigen document, alleen deze velden
        allow update: if ik(uid)
          && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['status', 'reactieOp', 'kaarten'])
          && request.resource.data.status in ['gaat', 'afgeslagen', 'afgemeld'];
        // zelf weggaan / account verwijderen; eigenaar trekt uitnodiging in of heft plan op
        allow delete: if ik(uid) || (ingelogd() && plan().eigenaar == request.auth.uid);
      }
    }

    // collection-group-query "mijn plannen en uitnodigingen"
    match /{pad=**}/deelnemers/{uid} {
      allow read: if ingelogd() && resource.data.uid == request.auth.uid;
    }

    // ---- Berichten ----
    match /inbox/{uid}/berichten/{id} {
      function b() { return request.resource.data; }
      allow read: if ik(uid);
      allow update: if ik(uid) && b().diff(resource.data).affectedKeys().hasOnly(['gelezen']);
      allow delete: if ik(uid) || (ingelogd() && resource.data.van == request.auth.uid);
      allow create: if ingelogd() && uid != request.auth.uid
        && b().van == request.auth.uid && b().gelezen == false
        && b().keys().hasOnly(['soort', 'van', 'vanNaam', 'planId', 'titel', 'datum', 'tijd', 'status', 'gelezen', 'aangemaaktOp', 'verlooptOp'])
        && b().vanNaam == profiel(request.auth.uid).naam
        && !geblokkeerd(uid, request.auth.uid)
        && (
          (b().soort == 'vriendverzoek' && id == 'verzoek_' + request.auth.uid
            && existsAfter(/databases/$(database)/documents/vriendverzoeken/$(request.auth.uid + '_' + uid)))
          || (b().soort == 'vriend-geaccepteerd' && id == 'vriend_' + request.auth.uid
            && existsAfter(/databases/$(database)/documents/vrienden/$(uid)/lijst/$(request.auth.uid)))
          || (b().soort == 'uitnodiging' && id == 'uitnodiging_' + b().planId
            && getAfter(/databases/$(database)/documents/plannen/$(b().planId)/deelnemers/$(uid)).data.uitgenodigdDoor == request.auth.uid
            && getAfter(/databases/$(database)/documents/plannen/$(b().planId)).data.voorstelling.titel == b().titel)
          || (b().soort == 'reactie' && id == 'reactie_' + b().planId + '_' + request.auth.uid
            && getAfter(/databases/$(database)/documents/plannen/$(b().planId)).data.eigenaar == uid
            && getAfter(/databases/$(database)/documents/plannen/$(b().planId)/deelnemers/$(request.auth.uid)).data.status == b().status)
        );
    }

    // ---- Alleen voor de Cloud Function (Admin SDK negeert de rules) ----
    match /mailLog/{id}     { allow read, write: if false; }
    match /mailTellers/{id} { allow read, write: if false; }
  }
}
```

Aandachtspunten bij de rules:

- **Limiet op `get/exists`-aanroepen**: 10 per enkel verzoek, 20 per batch/
  transactie. De zwaarste regel (uitnodiging + bericht in één batch) blijft
  daar ruim onder; de emulator-tests moeten dat bevestigen.
- `exists()`/`get()` zien de stand **vóór** de batch, `existsAfter()/
  getAfter()` erna. Daarom kan accepteren in één batch: beide
  vriendschapsdocs aanmaken, het verzoek weghalen en een bericht sturen.
- Elke `get`/`exists` in de rules telt als een gefactureerde read (verwaarloosbaar, zie B.6).
- Een gast die zelf mensen uitnodigt kan in deze versie niet (alleen de
  eigenaar). Zie Open vragen.
- Vriendschap verbreken haalt de rechten op profiel en gedeelde lijsten meteen
  weg; leesrechten op een gedeeld plan hangen aan het deelnemerschap, niet aan
  de vriendschap (zie Randgevallen).

**Testen met de Firebase Emulator** (`@firebase/rules-unit-testing`):

- Nieuwe devDependencies: `firebase-tools` (lokaal, voor `firebase emulators:exec`),
  `@firebase/rules-unit-testing`, `firebase` (modulair SDK voor Node). Java 21
  installeren (`brew install openjdk@21`); de Firestore-emulator draait op Java.
- `firebase.json` met alleen `firestore.rules` en de emulator-poorten
  (+ later `functions`). Geen geheimen.
- Testbestand `test/rules/*.test.js`, **niet** in de gewone `npm test`-glob
  (die draait ook in de nachtelijke workflow en heeft geen emulator):
  - `npm test` blijft zoals hij is (unit + UI, geen netwerk);
  - nieuw: `npm run test:rules` =
    `firebase emulators:exec --only firestore --project demo-podiumagenda "node --test test/rules/"`.
    Een `demo-`-project-id raakt nooit het echte project.
- Per regel een "mag"- en een "mag niet"-test met `assertSucceeds`/`assertFails`
  voor drie soorten gebruikers (eigenaar, vriend, vreemde) plus niet-ingelogd.
  Verplichte gevallen: zie het bouwplan per stap.
- Optioneel later: een GitHub Action die `test:rules` draait op de branch
  `vrienden` (Java + emulator kost ~1 minuut).

### B.4 Server-side vs client-side

| Onderdeel | Waar | Waarom |
|---|---|---|
| Profiel, gebruikersnaam | client (batch) | uniekheid via `create` op `usernames/{laag}` + rules |
| Verzoek, accepteren, verbreken, blokkeren | client (batch) | rules dwingen toestemming af |
| Persoonlijke link | client | token in Firestore, check in rules |
| Gedeelde kopie Gezien/Watchlist | client | eigen data, eigen app weet wanneer die verandert |
| Plan maken, uitnodigen, reageren | client (batch) | rules |
| Berichten in de app | client (batch met de actie) | rules koppelen bericht aan echte actie |
| Tijd gewijzigd / afgelast | client (bestaande `koppel()`) | iedereen leest dezelfde `shows.json` |
| **Mail versturen** | **Cloud Function** | SMTP-geheim, e-mailadres uit Auth, limieten |
| **Facturering stoppen** | **Cloud Function** | Pub/Sub van Cloud Billing |
| Account verwijderen | client | alle opruimrechten bestaan al in de rules; geen functie nodig |

**`stuurUitnodigingsmail`** (Functions v2, Node 22, regio = locatie van je
Firestore-database, bv. `europe-west1`/`eur3`; nakijken in de console):

```
onDocumentCreated('plannen/{planId}/deelnemers/{uid}', { secrets: [SMTP_USER, SMTP_PASS],
  maxInstances: 1, timeoutSeconds: 30, memory: '256MiB', retry: false })
1. Alleen rol 'gast' en status 'uitgenodigd'; anders stoppen.
2. Plan lezen; start in het verleden → stoppen.
3. Nog steeds vrienden (beide vrienden-docs) en niet geblokkeerd → anders stoppen.
4. users/{uid}.meldingen.mailUitnodigingen === false → stoppen.
5. Transactie:
   - mailLog/uitnodiging_{planId}_{uid} bestaat al → stoppen (idempotent; Firestore-
     triggers kunnen dubbel afgaan);
   - mailTellers/{vandaag}: perAfzender[eigenaar] < 10, perOntvanger[uid] < 5,
     totaal < 100 (Gmail-limiet ~500/dag, ruim eronder) → anders stoppen (mailLog 'limiet');
   - mailLog aanmaken (status 'bezig') + tellers ophogen.
6. E-mailadres: admin.auth().getUser(uid).email (alleen als emailVerified).
7. Versturen met nodemailer (smtp.gmail.com:465). mailLog → 'verstuurd' of 'mislukt'.
```

Bescherming tegen kostenlussen:
- De functie schrijft alleen `mailLog` en `mailTellers`; daar luistert geen
  trigger op. Ze schrijft **nooit** het deelnemer-document dat haar triggert.
- `retry: false` (een mislukte mail wordt niet eindeloos herhaald) en
  `maxInstances: 1`.
- Alleen `onDocumentCreated`, niet `onDocumentWritten`: reacties (updates)
  triggeren niets.
- Clients kunnen niets in `mailLog`/`mailTellers` schrijven; een client kan wel
  veel uitnodigingen maken, maar alleen voor echte vrienden en elke mail telt
  mee in de dagtellers.

**`stopFacturering`** (Pub/Sub-trigger op topic `budget-meldingen`):

```
onMessagePublished('budget-meldingen')
- data = JSON uit het bericht; als data.costAmount <= data.budgetAmount → niets doen.
- Cloud Billing API (@google-cloud/billing):
    getProjectBillingInfo('projects/de-moeilijkste-keus') → als billingEnabled:
    updateProjectBillingInfo({ name, projectBillingInfo: { billingAccountName: '' } })
- Loggen.
```

Belangrijk om te weten (Google-documentatie "Disable billing usage with
notifications"):
- Budgetmeldingen lopen **uren achter**; dit is geen harde limiet, wel een
  vangnet tegen een op hol geslagen lus.
- Facturering uitzetten **stopt alle betaalde diensten**: Functions houden op,
  en Google waarschuwt dat resources dan kunnen worden verwijderd. Firestore-
  data blijft normaal staan, maar maak vóór het aanzetten een export
  (zie C, stap 9). Daarna moet je zelf de facturering weer koppelen.
- Testen van deze functie: alleen in de emulator met een nep-Billing-client.
  Nooit een echte testmelding sturen op het echte project, want dan gaat de
  facturering echt uit.

### B.5 Mail

**Inhoud** (platte tekst + eenvoudige HTML, Nederlands):

```
Van:      Podiumagenda <podiumagenda.uitnodiging@gmail.com>
Onderwerp: Anna nodigt je uit voor Rüdsichtlos – Ruud Smulders

Hoi,

Anna de Vries (anna) wil samen met je naar:

  Rüdsichtlos – Ruud Smulders
  donderdag 1 oktober 2026 · 20:30
  DeLaMar, Amsterdam

Laat in de app weten of je meegaat:
https://marlavb.github.io/de-moelijkste-keus/#/uitnodiging/<planId>

Je krijgt deze mail omdat Anna en jij vrienden zijn in Podiumagenda.
Geen mails meer? Zet ze uit in Profiel → Meldingen:
https://marlavb.github.io/de-moelijkste-keus/#/profiel/meldingen
```

- Geen privégegevens behalve naam/gebruikersnaam van de uitnodiger en de
  voorstelling. Geen e-mailadressen van anderen, geen andere deelnemers.
- Link naar `#/uitnodiging/<planId>`, niet naar `#/show/<id>`: show-id's
  bevatten een titelslug (`delamar-ruud-smulders-2026-10-01-2030`) en kunnen
  veranderen. De app zoekt de voorstelling via `koppel()`.
- `List-Unsubscribe`-header met een `mailto:` naar het afzenderadres (een
  one-click-https-variant vraagt een extra HTTP-functie; voor dit volume niet nodig).
- Afmelden = `users/{uid}.meldingen.mailUitnodigingen = false`, schakelaar in
  Profiel → Meldingen. Standaard aan (zie Open vragen).

**SMTP-advies: een apart Gmail-account met app-wachtwoord.**

| | Gmail (apart account) | Brevo gratis |
|---|---|---|
| Eigen domein nodig | nee | eigenlijk ja |
| SPF/DKIM/DMARC | Google tekent als gmail.com: afzender en DKIM-domein komen overeen, dus komt goed aan | een gmail.com-afzender kan Brevo niet authenticeren; Brevo vervangt het adres dan door `…@<nummer>.brevosend.com` |
| Limiet | ~500/dag | 300/dag |
| Instellen | 2-stapsverificatie aan, app-wachtwoord maken | account, afzender verifiëren, SMTP-sleutel |
| Risico | Google kan app-wachtwoorden ooit uitfaseren; het account moet actief blijven | rare afzender zonder domein |

Gebruik **niet je eigen Gmail**: dan zien ontvangers je privéadres als
afzender, en het app-wachtwoord geeft toegang tot je hele mailbox. Maak een
apart account, bv. `podiumagenda.uitnodiging@gmail.com`.

Met een eigen domein (±€10/jaar) wordt **Brevo** de betere keuze: je zet
SPF (`include:spf.brevo.com`), de DKIM-records van Brevo en een DMARC-record
in de DNS, en de afzender wordt `uitnodiging@<jouwdomein>`.

### B.6 Firestore-gebruik (~10 gebruikers)

Aannames per gebruiker per dag: 5× app openen, 1× Profiel, 1× een
vriendenprofiel, 5 wijzigingen aan watchlist/gezien/gepland, 1 uitnodiging
per week per gebruiker.

| Actie | Reads | Writes |
|---|---|---|
| App openen (ingelogd): `users/{uid}` (al zo), `profielen/{uid}`, inbox-listener (ongelezen, min. 1 read), deelnemers-query (≈3), vriendenlijst (≈5) | ≈ 11 | 0 |
| Detailscherm "Ook op de watchlist van …" (vriendenkopieën 1× per sessie, ≈5 vrienden × 2) | ≈ 10 per sessie | 0 |
| Vriendenprofiel openen (2 docs + rules-checks) | ≈ 4 | 0 |
| Wijziging watchlist/gezien → ook de gedeelde kopie | +1 (rules) | +1 |
| Uitnodiging (plan + 2 deelnemers + bericht, met rules-checks) | ≈ 10 | 4 |
| Mailfunctie per uitnodiging | ≈ 5 | 2 |

Per dag voor 10 gebruikers ruwweg **1.000–1.500 reads en 100–200 writes**.
De gratis Firestore-limiet is 50.000 reads en 20.000 writes per dag, dus
ruim ×30 eronder. Functions: een paar aanroepen per dag (gratis: 2 mln/maand).
Eén kleine kostenpost bij Blaze: de containerimages van Functions in
**Artifact Registry** (gratis tot 0,5 GB; `firebase deploy` biedt een
opruimbeleid aan, accepteer dat met 1 dag). Verwachte rekening: **€0**.

**Live of op aanvraag:**
- **Live (`onSnapshot`)** alleen voor je eigen inbox met
  `where('gelezen','==',false).limit(20)`, voor de teller. Eén listener per
  ingelogde sessie, en Firestore rekent alleen gewijzigde documenten.
- **Op aanvraag (`getDoc`)** voor de Gezien/Watchlist van vrienden, met een
  geheugencache per sessie (verversen = scherm opnieuw openen). Deze lijsten
  veranderen zelden, en live zou per vriend een listener kosten.
- De deelnemers van een plan: op aanvraag bij het openen van Profiel/
  detailscherm. Live alleen zolang het plan-detail open is (optioneel).
- Je eigen `users/{uid}` blijft `getDoc` zoals nu (niet in dit project veranderen).

### B.7 Privacy / AVG

We slaan nu ook gegevens over **relaties tussen mensen** op: naam,
gebruikersnaam, wie met wie bevriend is, wie met wie naar een voorstelling
gaat, en (in Auth, niet in Firestore) e-mailadressen.

- **Nieuwe pagina `public/privacy.html`** (in dezelfde stijl als `bot.html`,
  dat over de scraper gaat; daar alleen een link naar de privacypagina bij).
  Link vanuit Profiel (onderaan) en vanuit het profiel-invulscherm. Inhoud:
  - wie de verwerkingsverantwoordelijke is (jij, met contactadres);
  - welke gegevens: Google-account (uid, e-mail, naam, foto: alleen in Auth
    en op je eigen scherm), gebruikersnaam en naam, je lijsten, vriendschappen,
    plannen, berichten; feedback via Formspree;
  - wie wat ziet (de zichtbaarheidstabel uit punt 3 van je opdracht);
  - waar het staat (Google Firebase, regio van de database) en dat mail via
    Gmail-SMTP gaat;
  - grondslag: uitvoering van de dienst waar je zelf om vraagt; mail:
    gerechtvaardigd belang, met afmelden in elke mail;
  - bewaartermijnen: berichten 90 dagen, maillog 30 dagen, de rest tot je je
    account verwijdert;
  - je rechten: inzien (alles staat in de app), verwijderen (knop), contact.
- **Account verwijderen** (Profiel → Account → "Account verwijderen", met
  bevestiging; client-side, idempotent, zodat een tweede poging afmaakt wat de
  eerste niet afkreeg). Volgorde:
  1. opnieuw inloggen (`reauthenticateWithPopup`; nodig voor `deleteUser`);
  2. vriendschappen: per vriend `vrienden/{ik}/lijst/{v}` en `vrienden/{v}/lijst/{ik}` weg;
  3. verzoeken van en aan mij weg (twee queries);
  4. plannen waar ik eigenaar ben: alle deelnemer-docs + plan weg;
     plannen waar ik gast ben: mijn deelnemer-doc weg;
  5. berichten: mijn inbox leeg; berichten die ik stuurde
     (`collectionGroup('berichten').where('van','==',ik)`, rule `delete` voor `van`) weg;
  6. `uitnodigingslinks` van mij, `blokkades/{ik}`, `gedeeld/{ik}/…`,
     `usernames/{laag}`, `profielen/{ik}`, `users/{ik}` weg;
  7. `deleteUser(auth.currentUser)`;
  8. `localStorage` op dit apparaat: vragen "Ook van dit apparaat wissen?"
     (anders werkt de app daarna gewoon uitgelogd verder met je lokale lijsten).
  - `mailLog`/`mailTellers` bevatten uids zonder naam en verlopen na 30 dagen (TTL).
  - Voor de collection-group-query op berichten is een rule nodig:
    `match /{pad=**}/berichten/{id} { allow read, delete: if resource.data.van == request.auth.uid; }`.

### B.8 Randgevallen

| Geval | Gedrag |
|---|---|
| Vriend verwijdert account | Diens vriendschapsdocs, profiel en gedeelde lijsten zijn weg → verdwijnt uit je Vrienden. Plannen van die vriend: plan weg; jouw gepland-item blijft met `planId` naar een plan dat niet meer bestaat → toont "Gedeeld plan opgeheven", verder gewoon je eigen plan. Deelnemer-doc van die vriend in jouw plan weg → "met wie" toont hem/haar niet meer. |
| Vriendschap verbroken, plan staat open | Het plan blijft bestaan; deelnemers zien elkaar daarin (lezen hangt aan deelnemerschap, de naam staat als momentopname in het deelnemer-doc). Nieuwe uitnodigingen tussen hen kunnen niet meer. Blokkeren haalt de geblokkeerde ook uit je eigen plannen (zie Open vragen). |
| Voorstelling verdwijnt uit de agenda | Per deelnemer, zoals nu: "Niet meer in de agenda" via `koppel()`. Het plan houdt de momentopname. |
| Tijd gewijzigd / afgelast | Bij iedereen via de eigen `koppel()`/`markeerVervallen` op dezelfde `shows.json`. Geen bericht in de inbox, wel in het gepland-item. Een melding "gewijzigd" in Berichten kan later client-side, afgeleid zonder Firestore-writes. |
| Uitgenodigde niet ingelogd op dit apparaat | Uitnodigen kan alleen voor vrienden, en die hebben een account. Het bericht wacht in de inbox; de mail-link opent de app → "Log in om de uitnodiging te zien" → na inloggen naar `#/uitnodiging/<planId>`. |
| Uitgenodigde heeft geen account | Niet uitnodigbaar. Eerst je persoonlijke vriendlink sturen. |
| Uitnodiging voor een voorbije datum | Rules: `start > request.time` bij plan en uitnodiging. Functie: geen mail als het voorbij is. Na de datum toont de uitnodiging "Verlopen" en kun je niet meer reageren (client). |
| Twee apparaten tegelijk | Deelnemer-updates raken alleen je eigen document (laatste schrijver wint, één veld). Dubbele berichten/mails: vaste id's + `mailLog` maken het idempotent. Gepland/watchlist/gezien: bestaande tombstone-samenvoeging. |
| Oude app-versie tegen nieuwe data | `users/{uid}`-regel blijft ongewijzigd. Oude `voegGeplandSamen` kopieert items met `{...item}`, dus `planId` blijft staan. Wel: een oude app die een plan uit de planning haalt, meldt niet af in het plan; de nieuwe app ziet bij laden een tombstone voor een item met `planId` en zet dan alsnog `afgemeld`. Service worker: `CACHE_NAME` ophogen en nieuwe modules in `APP_SHELL`. |
| Gebruikersnaam al bezet | `create` op `usernames/{laag}` faalt → "Deze gebruikersnaam is al bezet". |
| Gelijktijdig dezelfde naam | Eén `create` wint; de ander krijgt dezelfde melding. |
| Kruislings verzoek (A→B en B→A) | Bij het versturen eerst kijken of er al een verzoek van de ander is; zo ja: direct "Accepteren" tonen. |
| Persoonlijke link gelekt | Verloopt na 14 dagen; "Nieuwe link" maakt de oude ongeldig; vriendschap verbreken/blokkeren kan altijd. |
| Profiel nog niet ingevuld | Geen vrienden, verzoeken of plannen mogelijk (rules eisen `profielen/{uid}`); de rest van de app werkt zoals nu. |

### B.9 Migratie van bestaande gebruikers

- Er wordt **niets** aan bestaande data omgezet. `users/{uid}` blijft hetzelfde.
- Bestaande ingelogde gebruikers zien één keer (na het laden van de
  clouddata) een kaart bovenaan Profiel: "Kies een gebruikersnaam om vrienden
  te kunnen toevoegen" met [Invullen] [Later]. "Later" zet
  `users/{uid}.profielGevraagd = true`; de kaart verdwijnt dan, en in Profiel
  blijft een rij "Profiel invullen" staan. Geen blokkerende popup.
- Naamveld vooraf gevuld met `user.displayName` van Google (aanpasbaar);
  gebruikersnaam leeg met een suggestie.
- De gedeelde kopieën worden pas aangemaakt nadat het profiel is ingevuld
  (daarvoor kan niemand ze lezen).
- Gepland-items krijgen alleen een `planId` als je een gedeeld plan maakt of
  accepteert.
- Uitgelogd gebruik: geen enkele verandering; de nieuwe onderdelen tonen
  uitgelogd alleen "Log in om vrienden toe te voegen".

### B.10 Front-end in woorden

Algemeen: bestaande tokens (`--surface`, `--primary`, `--text-2`, `--accent`,
`--tint`, `--control-border`, `--radius-card`, `--touch: 44px`), bestaande
klassen (`.profile-section`, `.section-head`, `.plan-row`, `.status-badge`,
`.text-btn-small`, `.badge`). Gecontroleerde contrasten (zelf nagerekend):

| Combinatie | Contrast | Eis |
|---|---|---|
| `--on-accent` op `--accent` (tekst in teller) | 5,15 | ≥ 4,5 ✓ |
| `--accent` op `--surface` (tellerbol als grafisch element) | 3,34 | ≥ 3 ✓ |
| `--text-2` op `--surface` (subregels) | 7,26 | ✓ |
| `--nav-inactive` op `--surface` (tabs) | 4,88 | ✓ |
| `--control-border` op `--surface` (randen invoervelden) | 3,24 | ≥ 3 ✓ |
| `--primary` op `--tint` (status "gaat") | 10,35 | ✓ |
| `--podiumpas-text` op `--podiumpas-bg` (status "uitgenodigd", hergebruik) | 5,39 | ✓ |

Let op: `--icon-muted` (#b9a3b4) haalt op `--surface` geen 3:1; niet gebruiken
voor betekenisvolle iconen in de nieuwe schermen.

**Plek in de app.** Tabs Agenda · Theaters · Profiel blijven. Profiel krijgt
bovenaan (onder `#authBox`) een rij met twee grote tegels/knoppen:
**Berichten** (met teller) en **Vrienden** (met aantal openstaande
verzoeken). De **ongelezen-teller** komt als `.badge` op het Profiel-icoon in
de onderbalk (`aria-label="Profiel, 2 ongelezen berichten"`). Zo zie je hem
vanuit elke tab, zonder een vierde tab. Nieuwe routes (met `navigate()` en een
terugknop zoals `screen-gezien`):

`#/profiel/instellen` · `#/berichten` · `#/vrienden` · `#/vriend/<uid>` ·
`#/vriend-link/<token>` · `#/uitnodiging/<planId>` · `#/profiel/meldingen`

1. **Profiel invullen** (`#/profiel/instellen`): kop "Jouw profiel". Velden
   "Gebruikersnaam" (met hulptekst "3–20 tekens: letters, cijfers, punt of
   liggend streepje. Hiermee kunnen vrienden je vinden.") en "Volledige naam".
   Live controle op vorm; bezet-melding na Opslaan. Onder de velden de
   zichtbaarheid: "Vrienden zien je Gezien (met sterren)" en "… je Watchlist"
   als schakelaars (bestaande switch-stijl), aan. Tekst: "Je planning zien
   vrienden niet, alleen wie je uitnodigt." Knop Opslaan (44 px+), link naar
   de privacypagina. Hetzelfde scherm dient later om te wijzigen.
2. **Vrienden** (`#/vrienden`): zoekveld "Gebruikersnaam van een vriend"
   + knop Zoeken; resultaat precies één kaart (naam, @gebruikersnaam,
   [Vriendschapsverzoek sturen]) of "Niemand gevonden met deze
   gebruikersnaam". Daaronder "Of deel je persoonlijke link" met [Link
   kopiëren] / [Delen] (Web Share API) en "Geldig tot 15 okt · Nieuwe link".
   Secties: **Verzoeken voor jou** (Accepteren / Weigeren), **Verstuurd**
   (Intrekken), **Vrienden** (rij met naam en @naam, tik → vriendenprofiel).
3. **Vriendenprofiel** (`#/vriend/<uid>`): kop met naam en @gebruikersnaam;
   secties **Gezien** (zelfde rijen als je eigen Gezien, met `maakSterren` in
   alleen-lezen) en **Watchlist** (rijen met eerstvolgende datum in jouw
   agenda, tikbaar naar het detailscherm). Niet gedeeld → "Anna deelt haar
   Gezien niet." (neutraal: "Dit deelt Anna niet."). Onderaan in een menu:
   Vriendschap verbreken / Blokkeren, met bevestiging.
4. **Uitnodigen**: in het detailscherm bij een geplande speeldatum en in de
   Gepland-rij een knop "Vrienden uitnodigen". Sheet (zelfde als filtersheet)
   met je vrienden als selectievakjes (44 px rijen), al uitgenodigden
   uitgeschakeld met hun status, knop "Uitnodiging sturen (2)". Daarna een
   bevestiging "Anna en Bas krijgen een bericht en een mail."
5. **Berichten** (`#/berichten`): lijst, nieuwste boven; ongelezen vet met een
   stip (niet alleen kleur: ook "Nieuw" voor schermlezers). Soorten:
   - "Anna wil vrienden worden" → [Accepteren] [Weigeren];
   - "Anna nodigt je uit voor Rüdsichtlos – Ruud Smulders, do 1 okt 20:30"
     → [Ik ga mee] [Nee, dank je] → bij "Ik ga mee" staat hij in je Gepland;
   - "Bas gaat mee naar …" / "Bas kan niet naar …";
   - "Anna en jij zijn nu vrienden".
   Openen van het scherm zet zichtbare berichten op gelezen.
6. **"Met wie" bij Gepland**: in de `plan-row` onder de theaterregel een regel
   "Met Anna, Bas · Cas heeft nog niet gereageerd · Dirk kan niet", met kleine
   statusbadges in bestaande stijlen (gaat = `--tint`/`--primary`,
   uitgenodigd = podiumpas-kleuren, afgeslagen = `--text-2` doorgestreept
   zonder kleurbetekenis). Op het detailscherm een blok "Je gaat met" met
   dezelfde info en, als je de eigenaar bent, "Meer vrienden uitnodigen".
   Kaarten blijft per persoon ("Kaarten ✓" is jouw status).
7. **Optioneel in het detailscherm**: onder de watchlist-knop een regel
   "Ook op de watchlist van Anna en Bas" en "Cas heeft dit gezien ★ 4"
   (sterren met `aria-label` "4 van 5 sterren").
8. **Meldingen** (`#/profiel/meldingen`, ook vanuit Profiel bereikbaar):
   schakelaar "Mail bij een uitnodiging", plus de twee deelschakelaars.

---

## C. Wat je zelf moet doen (console)

Volgorde aanhouden; niets hiervan hoeft vóór stap 1–4 van het bouwplan,
behalve stap 1 hieronder. Mail (stap 5 bouwplan) vraagt stappen 2–9.

1. **Nu al**: Firebase-console → Firestore → Rules: kijk of de gepubliceerde
   rules gelijk zijn aan `firestore.rules`. Noteer de **databaselocatie**
   (Firestore → Settings), want de functies moeten in die regio.
2. **Blaze aanzetten**: Firebase-console → tandwiel → Usage and billing →
   Details & settings → Modify plan → Blaze → betaalrekening kiezen/aanmaken.
3. **Budget + alarm**: Google Cloud-console → Billing → Budgets & alerts →
   Create budget. Scope: alleen project `de-moeilijkste-keus`. Bedrag: **€5**
   per maand (verwacht €0). Drempels 25%, 50%, 90%, 100% (actual) met mail
   aan billing-admins.
4. **Pub/Sub voor de automatische stop**: in hetzelfde budget → "Manage
   notifications" → "Connect a Pub/Sub topic" → nieuw topic
   `budget-meldingen` in dit project.
5. **Rechten voor de stopfunctie**: APIs & Services → **Cloud Billing API**
   inschakelen. Na de eerste deploy van `stopFacturering`: IAM → het
   service-account van die functie (standaard
   `<projectnummer>-compute@developer.gserviceaccount.com`, of een eigen
   service-account dat we in de code vastleggen, aanbevolen:
   `budget-stop@de-moeilijkste-keus.iam.gserviceaccount.com`) de rol
   **Project Billing Manager** geven op dit project.
6. **Gmail-account voor de mail**: nieuw Google-account (bv.
   `podiumagenda.uitnodiging@gmail.com`) → Beveiliging → **2-stapsverificatie**
   aan → **App-wachtwoorden** → maak er een ("Podiumagenda functie"). Bewaar
   het alleen in je wachtwoordmanager.
7. **Geheimen in Secret Manager** (via de CLI, nooit in de repo):
   `firebase functions:secrets:set SMTP_USER` en
   `firebase functions:secrets:set SMTP_PASS` (vraagt om de waarde op de
   prompt). Ze komen in Google Secret Manager; de functie krijgt er toegang
   toe via `defineSecret`. (Secret Manager: 6 actieve versies gratis.)
8. **TTL-beleid**: Firestore → TTL → regels op `berichten.verlooptOp`
   (collection group `berichten`), `mailLog.verlooptOp`,
   `mailTellers.verlooptOp`.
9. **Back-up vóór de stopfunctie live gaat**: `gcloud firestore export` naar
   een bucket, of handmatig: de data is klein. Dan weet je zeker dat er niets
   verloren gaat als de facturering ooit wordt uitgezet.
10. **Geen extensie installeren.** "Trigger Email from Firestore" verstuurt
    wat er in een `mail`-collectie staat. Dan heb je alsnog een eigen functie
    nodig om het adres veilig in te vullen, dus twee functies in plaats van één.

**Deployen: lokaal met `firebase deploy` (advies), niet via GitHub Actions.**

| | Lokaal (`firebase deploy --only firestore:rules` / `--only functions`) | GitHub Action |
|---|---|---|
| Geheimen | Je eigen login (`firebase login`), niets in GitHub | Service-account-sleutel of Workload Identity Federation in GitHub nodig |
| Controle | Jij beslist wanneer; past bij "niets naar main zonder akkoord" | Automatisch bij push; risico dat rules live gaan voordat de app er klaar voor is |
| Reproduceerbaar | Afhankelijk van je laptop | Altijd dezelfde stappen |
| Volgorde rules ↔ app | Handmatig: eerst rules, dan app (GitHub Pages) | Ook te regelen, maar meer werk |

Voor een project van deze grootte is lokaal duidelijker. Wil je later toch
automatiseren: Workload Identity Federation (geen sleutelbestand), en alleen
`firestore:rules` met een handmatige `workflow_dispatch`. Vastleggen in
CLAUDE.md: rules altijd **vóór** de app-code die ze nodig heeft, en
`npm run test:rules` groen voor elke rules-deploy.

---

## D. Bouwplan

Alles op branch **`vrienden`**. Pushen van die branch kan (CLAUDE.md:
`npm run safe-push -- origin vrienden`); **niet mergen naar main** zonder
jouw akkoord. Let op: `deploy.yml` deployt alleen vanaf `main`, dus de branch
zelf komt niet op GitHub Pages. Testen in de browser gaat lokaal
(`npx http-server public` of vergelijkbaar, `localhost` staat bij de
toegestane domeinen) tegen het **echte** Firebase-project. Daarvoor moeten de
nieuwe rules gepubliceerd zijn. Dat is veilig, want de nieuwe rules zijn
alleen uitbreidingen en `users/{uid}` blijft ongewijzigd.

Per stap: eerst `npm test` en `npm run test:rules` groen, dan rules deployen,
dan lokaal testen op twee Google-accounts (A en B; gebruik twee
browserprofielen), dan commit.

### Stap 0 — Gereedschap (geen functionaliteit)
- Bestanden: `firebase.json` (rules + emulator-poorten), `.firebaserc`
  (project-alias), `package.json` (devDeps `firebase-tools`,
  `@firebase/rules-unit-testing`, `firebase`; script `test:rules`),
  `test/rules/helpers.js`, `test/rules/bestaand.test.js` (de huidige
  `users/{uid}`-regel: eigenaar mag, ander/uitgelogd niet).
- Jij: Java 21 installeren; de console-rules vergelijken (C.1).
- Risico: `npm ci` in de nachtelijke workflow trekt nu ook `firebase-tools`
  binnen (groot). Voorkomen door ze als devDependencies te zetten en in
  `refresh-data.yml` `npm ci --omit=dev` te gebruiken. Dat is een wijziging
  aan de workflow, dus apart overleggen, of de rules-tests in een eigen map
  met een eigen `package.json` zetten (advies: eigen map `firebase/`).

### Stap 1 — Profiel (gebruikersnaam, naam) + rules + emulator-tests
- Bestanden: `firestore.rules` (usernames, profielen), nieuw
  `public/js/profiel.js` (pure functies: `normaliseerGebruikersnaam`,
  `isGeldigeGebruikersnaam`, gereserveerde namen), `public/js/firebase.js`
  (extra exports: `writeBatch`, `deleteDoc`, …), `app.js` (eenmalige vraag,
  scherm `#/profiel/instellen`), `index.html`, `styles.css`, `sw.js`
  (`APP_SHELL`, `CACHE_NAME`).
- Tests: `test/profiel.test.js` (normalisatie, vorm, gereserveerd);
  `test/rules/profiel.test.js`: unieke naam, hoofdletterongevoelig (`Anna` vs
  `anna`), naam wijzigen geeft oude vrij, zonder `usernames`-doc geen profiel,
  geen `list` op usernames, vreemde kan `profielen/{A}` niet lezen;
  UI-test met nep-firebase: uitgelogd verandert er niets.
- Risico: de eenmalige vraag mag het laden niet blokkeren; nep-`firebase.js` in
  de UI-tests moet de nieuwe exports krijgen, anders breken
  `navigatie/detail-ui/gezien-ui`.
- Testen met A en B: A kiest "Marla", B probeert "marla" → bezet; A wijzigt
  naar "MarlaVB", B kan nu "marla" nemen; uitloggen → app werkt als vanouds;
  "Later" → vraag komt niet terug, ook niet op een tweede apparaat.

### Stap 2 — Vriendschapsverzoeken + Vrienden-scherm
- Bestanden: rules (vriendverzoeken, vrienden, uitnodigingslinks, blokkades),
  `public/js/vrienden.js` (id's, batch-opbouw als pure functies),
  `app.js` (`#/vrienden`, `#/vriend-link/<token>`), html/css.
- Tests: rules: niemand kan `vrienden/{B}/lijst/{A}` maken zonder verzoek van
  B of link van B; verlopen link faalt; geblokkeerde kan geen verzoek sturen;
  verzoek met valse `vanNaam` faalt; beide kunnen verbreken; vreemde kan
  verzoeken van anderen niet lezen. Unit: batch-inhoud voor accepteren.
- Risico: kruislingse verzoeken; dubbel tikken (vaste id's).
- Testen: A zoekt B exact (deel van de naam → niets); verzoek, B weigert;
  opnieuw, B accepteert; A trekt een tweede verzoek in; link van A openen als
  B (en na "Nieuwe link" werkt de oude niet meer); verbreken; blokkeren.

### Stap 3 — Privacy-instellingen + vriendenprofiel
- Bestanden: rules (gedeeld), `public/js/gedeeld.js` (kopie maken uit
  watchlist/gezien, matchen met versie-check), `app.js` (schrijven na
  save*, `#/vriend/<uid>`, optioneel "Ook op de watchlist van"), html/css.
- Tests: unit: kopie bevat geen tombstones/bezoekdetails; matchen bij andere
  `v` herberekent de sleutel (inclusief de vaste titeltest-namen uit
  `watchlist.test.js`). Rules: vriend leest wel, vreemde niet, uitgezet → ook
  vriend niet; gepland nergens leesbaar.
- Risico: extra writes bij elke wijziging (debounce); oude app-versie werkt
  de kopie niet bij → kopie loopt achter (acceptabel, `bijgewerktOp` tonen?).
- Testen: A zet sterren op een voorstelling → B ziet ze na herladen; A zet
  Watchlist uit → B ziet "Dit deelt A niet"; B ziet nooit A's Gepland.

### Stap 4 — Uitnodigingen + "met wie" + Berichten
- Bestanden: rules (plannen, deelnemers, inbox, collection-group),
  `public/js/plannen.js`, `gepland.js` (`planId` in `voegGeplandSamen`),
  `app.js` (sheet uitnodigen, `#/uitnodiging/<planId>`, `#/berichten`,
  teller op de Profiel-tab, "met wie" in `renderPlanRow`/detail), html/css, sw.js.
- Tests: unit: `voegGeplandSamen` behoudt/vult `planId` aan (ook in
  `werkPlannenBij`/`markeerVervallen`); tombstone op item met `planId` →
  afmelden. Rules: alleen vrienden uitnodigen; niet in het verleden; gast kan
  alleen eigen status wijzigen; bericht zonder bijbehorende actie faalt;
  vreemde kan plan niet lezen. UI: teller verschijnt/verdwijnt.
- Risico: grootste stap; mogelijk opsplitsen in 4a (plan + Berichten) en 4b
  ("met wie" + detailscherm). Collection-group-index nodig (de console geeft
  bij de eerste query een link; vastleggen in `firestore.indexes.json`).
- Testen: A plant en nodigt B uit → B ziet teller + bericht → "Ik ga mee" →
  bij beiden "met B/A"; B zet "kaarten" → alleen bij B; A haalt het plan weg →
  B ziet "A gaat niet meer"; voorstelling met andere tijd (tijdelijk een
  aangepaste `shows.json` lokaal) → bij beiden "Tijd gewijzigd".

### Stap 5 — Cloud Function voor mail + limieten (+ stopFacturering)
- Bestanden: `functions/package.json`, `functions/index.js`,
  `functions/mail.js` (tekst opbouwen: pure functie),
  `functions/limieten.js`, `functions/budget.js`; `firebase.json` (functions).
- Tests: unit (gewone `node --test`): mailtekst bevat geen e-mailadressen of
  andere deelnemers, juiste link, afmeldregel; limietlogica; budgetbericht onder/
  boven budget. Emulator (`--only firestore,functions`): dubbele trigger → één
  mail (nep-transport); afgemelde ontvanger → geen mail; 6e mail aan dezelfde
  ontvanger op één dag → geen mail.
- Jij: console-stappen C.2–C.9; daarna `firebase deploy --only functions`.
- Risico: SMTP-fout → geen herhaling (bewust); regio moet kloppen met de database.
- Testen: A nodigt B uit → mail bij B's Gmail (spammap checken), link opent de
  uitnodiging; B zet mails uit → volgende uitnodiging wel in-app, geen mail.

### Stap 6 — Account verwijderen + privacytekst
- Bestanden: `public/privacy.html`, `bot.html` (link), `app.js`
  (verwijderflow), `firestore.rules` (collection-group-delete berichten), sw.js.
- Tests: rules: alle opruimstappen mogen voor de eigenaar en niet voor een
  ander; unit: de opruimlijst bij een gegeven stand.
- Risico: halverwege mislukken → idempotent maken en opnieuw kunnen starten;
  `deleteUser` vraagt recent inloggen.
- Testen: B (met vriend A, plan, berichten) verwijdert account → bij A
  verdwijnt B uit Vrienden en uit "met wie"; B's gebruikersnaam is weer vrij;
  in de console is niets van B meer te vinden (behalve maillog tot 30 dagen).

---

## E. Open vragen (met advies)

1. **Persoonlijke link: direct vrienden of een verzoek dat je nog moet
   accepteren?** *Advies: direct*, want wie de link stuurt heeft al
   toestemming gegeven. Met 14 dagen geldigheid en "Nieuwe link".
2. **Gebruikersnaam wijzigen: vrijgegeven naam meteen beschikbaar voor een
   ander?** Risico: iemand pakt je oude naam en lijkt op jou. *Advies:* bij
   10 gebruikers meteen vrijgeven; vrienden zien elkaar toch op uid.
3. **Mail bij uitnodigingen standaard aan of uit?** *Advies: aan*, met afmelden
   in elke mail en in Profiel. Geen mail bij vriendschapsverzoeken (alleen in de app).
4. **Mogen gasten zelf ook mensen uitnodigen voor een plan?** *Advies: nee in
   v1* (alleen de eigenaar). Dat maakt de rules veel eenvoudiger.
5. **"Kaarten" zichtbaar voor medegangers?** Je wilt de status per persoon;
   tonen dat iemand al kaarten heeft voorkomt dubbel kopen. *Advies: ja,
   alleen binnen het plan* (veld `kaarten` in het deelnemer-doc).
6. **Vrije tekst bij een uitnodiging** ("zin in?")? *Advies: nee in v1*
   (geen moderatie nodig, geen misbruikkanaal); later max. 140 tekens, alleen
   in de app, niet in de mail.
7. **Blokkeren**: in v1 meenemen? *Advies: ja, simpel* (verbreekt vriendschap,
   blokkeert verzoeken en uitnodigingen, haalt uit jouw plannen). Het kost
   weinig extra en geeft een uitweg.
8. **Gezien delen: ook de bezoekdatum?** In het ontwerp: alleen
   "laatst gezien" + aantal + sterren, geen zaal/status/url. Akkoord?
9. **Eigen domein?** Alleen nodig als je Brevo wilt of een nette afzender.
   *Advies: voorlopig niet*, apart Gmail-account.
10. **Budgetbedrag voor de automatische stop:** €5/maand? Lager (€1) kan,
    maar dan valt de app sneller stil bij een meevaller in de verkeerde
    richting. *Advies: €5.*
11. **Rules-tests en `firebase-tools` buiten de hoofd-`package.json`**
    (map `firebase/` met eigen `package.json`), zodat de nachtelijke workflow
    niet zwaarder wordt? *Advies: ja.*
12. **Firestore-databaselocatie**: welke is het (Settings)? Bepaalt de regio
    van de functies; niet te wijzigen.
13. **Melding "tijd gewijzigd / afgelast" ook in Berichten** (afgeleid,
    zonder Firestore), of genoeg in Gepland? *Advies: eerst alleen in Gepland
    en het detailscherm; later afgeleid in Berichten.*

---

Bronnen voor de mail- en billingkeuzes:
- Brevo, domeinauthenticatie (gratis maildomeinen kunnen niet worden geauthenticeerd; vervanging door brevosend.com): https://help.brevo.com/hc/en-us/articles/16045394674066
- Google Cloud, "Disable billing usage with notifications": https://docs.cloud.google.com/billing/docs/how-to/disable-billing-with-notifications
