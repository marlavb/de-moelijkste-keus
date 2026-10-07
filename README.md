# Podiumagenda

Eén agenda voor de theaters waar je met de [Podiumpas](https://www.podiumpas.nl/)
terechtkunt. Elke nacht halen we de agenda's van de theaters op. De app
toont ze als één doorzoekbare agenda op je telefoon.

- Live: <https://marlavb.github.io/de-moelijkste-keus/>
- Over de scraper, voor theaters: [bot.html](https://marlavb.github.io/de-moelijkste-keus/bot.html)
  (wat we ophalen, hoe vaak, en hoe je bezwaar maakt)

Repo: `de-moelijkste-keus`. De blokken tussen `AUTO`-markers hieronder
worden automatisch bijgewerkt (zie [Automatisch bijgewerkt](#automatisch-bijgewerkt)).

<!-- AUTO:aantallen:start -->
- Theaters: **72** (60 ok, 1 terugval, 1 leeg, 5 gepauzeerd, 5 onbekend)
- Voorstellingen (titel per theater): **7068**
- Speeldata: **10015**
- Laatste refresh: **7 oktober 2026, 15:26** (Amsterdamse tijd)
<!-- AUTO:aantallen:end -->

## Functies

- **Agenda**: alle komende voorstellingen per dag, zoeken op titel en theater,
  standaard de komende 30 dagen ("Toon … verder in de toekomst").
- **Filters**: stad, theater, genre, alleen Podiumpas, alleen watchlist,
  "Verberg volle voorstellingen" (uitverkocht, wachtlijst, afgelast) en
  "Verberg gezien". De keuze wordt onthouden.
- **Detailscherm**: info, reserveren, Podiumpas per speeldatum, andere data en
  "Ook te zien bij" (volle data grijs en doorgestreept), in je agenda zetten.
- **Theaters per provincie**: theaters aan of uit, per theater, per stad of per
  provincie (vinkje met aan/uit/deels). Gepauzeerde theaters staan er met een
  melding.
- **Watchlist**: voorstellingen die je wilt zien, één regel per voorstelling,
  met de eerstvolgende datum en de stand: "Afgelast", "2 van 5 data afgelast" of "Niet meer in de
  agenda". Elk item heeft een eigen knop om het weg te halen; een item dat niet
  meer in de agenda staat opent een eenvoudig scherm (titel, maker, genre) met
  de bladwijzer.
- **Gepland**: een speeldatum die je wilt bezoeken, met of zonder kaarten. Na de
  speeldag (Amsterdamse tijd) gaat hij vanzelf naar Gezien; afgelast of
  verplaatst gaat stil uit de planning.
- **Gezien met sterren**: je bezoekgeschiedenis, 1 tot 5 sterren in halve
  stappen, sorteren op laatste bezoek of beoordeling. Een item zonder maker
  of genre (bv. zelf aangevinkt) wordt aangevuld zodra de voorstelling in de
  agenda staat; een bestaande maker blijft staan.
- **Profiel** (na inloggen met Google): gebruikersnaam en naam. Alles
  hierboven werkt ook zonder inloggen (alleen op dat apparaat); ingelogd
  synchroniseert het tussen je apparaten.
- **Vrienden**: zoeken op gebruikersnaam, verzoeken, eenmalige
  uitnodigingslink, blokkeren.
- **Delen**: je Gezien (met sterren) en Watchlist voor vrienden, per onderdeel
  aan of uit.
- **Uitnodigen**: een vriend uitnodigen voor een geplande voorstelling; zij
  gaan mee of kunnen niet, en je ziet wie er kaarten heeft.
- **Berichten**: uitnodigingen en reacties, met een teller in Profiel.
- **Mail**: een korte mail bij een nieuwe uitnodiging (uit te zetten in
  Profiel → Mail). Je adres is nooit zichtbaar voor anderen.

Privacy: [privacy.html](https://marlavb.github.io/de-moelijkste-keus/privacy.html).

## Hoe het werkt

- **Scraper** (`src/`, Node 20 + Playwright): haalt per theater de agenda op,
  netjes (robots.txt, crawl-delay, eigen user-agent met link naar `bot.html`)
  en schrijft `public/data/shows.json`, `scrape-status.json` en
  `theaters.json`. Faalt een theater, dan valt het terug op de vorige data van
  dat theater; een netwerkfout (DNS, verbinding) krijgt eerst één herpoging
  na een minuut. Theaters, steden, provincies en Podiumpas staan in
  `src/lib/config.js` (met bron en datum); een theater dat ons weert staat daar
  op `gepauzeerd` en krijgt geen enkel verzoek. Gedeelde modules per platform:
  `peppered.js` (Peppered), `wpTheatre.js` (Theater for WordPress) en
  `cre8ion.js` (The Cre8ion.Lab). Bellevue en Frascati lezen alle speeldata
  van de agendapagina's zelf (een verborgen paneel per productie), zonder
  detailpagina's: bij Bellevue ~25 verzoeken (~2 min) in plaats van ~205.
  Orpheus (Apeldoorn) en Agnietenhof (Tiel) werken net zo; bij Agnietenhof
  krijgt alleen een kaart met meer speeldata (knop "Speeldata", zonder
  paneel) een detailpagina, en films vallen weg.
  Van Huis Oostpool (Arnhem) nemen we uit de agenda van Theater Oostpool
  alleen de speeldata in het eigen huis; de tournee staat al bij de andere
  theaters.
  TAR (Arnhem) leest de agendapagina en daarna het eigen lijst-endpoint van
  de site (zoals de knop "meer laden"); Happy Hour, residenties en workshops
  laten we weg.
  Waar zaal, uitsluitingen of speeldata alleen op een detailpagina staan
  (Musis Arnhem; Schaffelaartheater, waar robots.txt de agenda-API verbiedt
  en we de productie-adressen uit sitemap.xml halen, hooguit 120 nieuwe
  pagina's per nacht),
  komen die uit een cache tussen runs (`detailCache.js`, bestand
  `cache/detail/<theater>.json`, door de nachtelijke run gecommit): een nieuwe
  productie meteen, een bekende hooguit één keer per week, verspreid over de
  week; die gegevens kunnen dus tot een week achterlopen. Dubbele speeldata gaan eruit binnen een
  theater en tussen vaste paren theaters met één agenda-overlap
  (`dedupe.js`). Titels: waar een theater per genre een vaste volgorde van
  maker en titel heeft, wordt dat "Titel – Maker"; content warnings,
  "met o.a. …", leeftijden en ondertitels als "reprise", "20 jaar …" of
  "In Concert" worden nooit maker maar beschrijving; een paar titels waar
  een theater artiest en voorstelling omgedraaid heeft of alleen de artiest
  noemt, staan per theater in `OMGEDRAAID` en `VOORSTELLING_BIJ_ARTIEST`
  (`titels.js`); watchlist en Gezien gaan dan mee naar de nieuwe titel
  (`titelMapping.js`). Dezelfde productie (zelfde
  watchlist-sleutel) krijgt bij elk theater dezelfde weergavetitel, hetzelfde
  genre en dezelfde maker: die van de meeste theaters
  (`weergaveMeerderheid.js`, `genreMeerderheid.js`, `makerMeerderheid.js`);
  de bronwaarde blijft bewaard. Dezelfde voorstelling met een langere titel
  bij het ene theater ("KING ME – 250 years of Donald Trump – Greg Shapiro")
  en een kortere bij het andere ("KING ME – Greg Shapiro") wordt één
  productie met de kortere titel; ook een titel die alleen de artiest is,
  met de voorstelling in de beschrijving ("Greg Shapiro", "KING ME | …").
  Niet bij een generiek begin ("Oudejaars", "Best of", jaartallen)
  (`productieSamenvoegen.js`); watchlist, Gezien en planning gaan mee naar
  de samengevoegde productie. Verschillen de makers alleen in wat ná " / "
  staat en is dat een gezelschap of producent (en de kern ervóór niet), dan
  wordt het de kern ("Nina van Tongeren / Theater Bellevue" en "… / Bellevue
  Producties" → "Nina van Tongeren"; "Theater Rotterdam / Glen Faria" blijft
  heel). Twee makers met evenveel theaters: dan blijft de maker zoals hij
  was. Een maker van maar één theater gaat alleen naar de andere als hij
  elders ook maker is en niet verdacht (cijfers, kleine letter vooraan,
  titel van een andere productie, nooit-maker). Een agendapagina die niet laadt, krijgt
  bij sommige theaters (ITA, Theater aan de Parade) één herpoging na een
  minuut; mislukt die ook, dan geldt de vorige data. Sommige bronnen dienen
  meer theaters tegelijk (één scrape per run): Het Cenakel (De Link,
  S.M.E.T.), Theater aan het Vrijthof (ook AINSI, via de zoekindex van de
  site), PLT (Heerlen, Kerkrade, Sittard) en Musis en Stadstheater Arnhem
  (één API; het Stadstheater is tot 2028 dicht en heeft een melding). Theaters zonder Podiumpas staan
  er ook in, met `podiumpas: false` (ITA, de Limburgse theaters behalve De
  Maaspoort en DOK6); de nieuwste theaters draaien achteraan in de run, elk
  met een eigen tijdbudget. Besloten verhuur (zonder kaartverkoop) laten we
  weg, openbare verhuur blijft als Overig. Een genre kan per theater anders
  gekoppeld zijn (`GENRE_PER_THEATER` in `genre.js`: Komedie is Toneel bij De
  Oranjerie en het Munttheater, behalve stand-up; elders Cabaret).
- **Nachtelijke run**: `.github/workflows/refresh-data.yml` scrapet, commit de
  data naar `main` en start de deploy. De Cloud Function `startNachtrun` start
  hem elke dag om 05:00 (Amsterdam); de cron van GitHub (03:17 UTC) blijft als
  vangnet. Is de data die dag al ververst, dan stopt een tweede run meteen
  (handmatig toch draaien: "Run workflow" met `forceer`; alleen een paar
  theaters opnieuw, bv. na een terugval: `alleen` met hun id's, de rest houdt
  zijn data).
  De run wordt alleen rood als er iets te doen is: een theater twee nachten
  op rij teruggevallen (`terugvalReeks` in `scrape-status.json`), meer dan
  drie theaters in één nacht, een scherpe daling bij hetzelfde theater twee
  nachten op rij (`dalingReeks`), een gefaalde stap of een scrape van meer dan
  80 minuten. Eén nacht terugval bij hooguit drie theaters, of één nacht een
  scherpe daling, geeft een waarschuwing. Elke run heeft een samenvatting (looptijd,
  aantallen, per teruggevallen theater de fout en de reeks). Bij rood komt
  die in één GitHub-issue "Nachtrun: aandacht nodig" (label `nachtrun`); een
  groene run zonder terugval sluit het issue weer (`nachtrunSignalen.js`).
- **App** (`public/`): een PWA zonder build-stap (HTML, CSS, JavaScript-modules,
  service worker). Gehost op **GitHub Pages** via `.github/workflows/deploy.yml`
  bij elke push naar `main`.
- **Firebase** (project `de-moeilijkste-keus`):
  - **Auth**: inloggen met Google.
  - **Firestore**: watchlist, planning, Gezien, theaterkeuze, profiel,
    vrienden, delen, plannen en berichten. Toegang via `firestore.rules`.
  - **Functions** (2nd gen, Node 22, **europe-west4**, map `functions/`):
    `uitnodigingsmail` (mail bij een uitnodiging), `stopFacturering` (stopt de
    facturering bij overschrijding van het budget; staat in DRY_RUN) en
    `startNachtrun` (Cloud Scheduler, start de nachtelijke run via de GitHub
    API). Geheimen staan in Secret Manager, nooit in de repo.

## Lokaal ontwikkelen

Vereist Node.js 20+ (Functions: Node 22) en, voor de emulators, Java 21.

```sh
npm ci
npx playwright install chromium
npm --prefix firebase ci          # Firebase CLI en emulators
npm --prefix functions ci         # alleen voor de Functions
brew install openjdk@21           # emulators; zet openjdk@21/bin in je PATH
```

- App bekijken: `npx serve public` (of `python3 -m http.server 8080 --directory public`).
  Met `?emulator=1` praat de app met lokale emulators in plaats van Firebase.
- Eén theater scrapen tijdens het bouwen, uit de lokale cache:
  `SCRAPE_CACHE=1 node src/index.js --only=<id>`. Houd testverkeer naar
  theatersites klein (zie `CLAUDE.md`).

### Testen

| Commando | Wat |
|---|---|
| `npm test` | unit-tests en UI-tests (Playwright, nep-Firebase, geen netwerk) |
| `npm run test:rules` | `firestore.rules` tegen de Firestore-emulator |
| `npm run test:e2e` | de app end-to-end met Auth- en Firestore-emulators en de echte rules |
| `npm run test:functions` | de Cloud Functions met emulators, een nep-SMTP-server en een nep-GitHub-API |

De emulators gebruiken altijd het project `demo-podiumagenda`, nooit het echte.

## Uitrollen

- **App**: merge naar `main` en push met `npm run safe-push`; de deploy-workflow
  zet `public/` op GitHub Pages. Hoog bij wijzigingen in de app de versie in
  `public/sw.js` op.
- **Rules**: na groene `test:rules`, vóór de app-code die ze nodig heeft:
  `npm run firebase -- deploy --only firestore:rules`.
- **Functions**: na groene `test:functions`:
  `npm run firebase -- deploy --only functions`.
- Pushen naar `main` altijd via `npm run safe-push`: die weigert zolang de
  nachtelijke run loopt of wacht.

## Werkafspraken

Zie [`CLAUDE.md`](CLAUDE.md): git en pushen, testverkeer naar theatersites,
botblokkades (nooit omzeilen), Podiumpas-dekking verifiëren, scrapers,
watchlist-sleutels en de README bijwerken bij nieuwe functies.

## Automatisch bijgewerkt

De blokken hieronder (en het blok met aantallen bovenaan) maakt
`scripts/readme.js`; `.github/workflows/readme.yml` draait dat na elke push
naar `main` en na de nachtelijke run, en commit alleen als er iets verandert.
Pas de tekst tussen de markers dus niet met de hand aan.

<!-- AUTO:sw:start -->
Service worker: `podiumagenda-v41`
<!-- AUTO:sw:end -->

### Theaters

Status uit de laatste refresh: `ok`, `leeg` (geen komende voorstellingen) of
`gepauzeerd` (het theater weert ons; we omzeilen dat niet). Podiumpas per
voorstelling, zoals in de app: `ja` (alle), `deels` (een deel), `nee` (geen) of
`–` (geen voorstellingen in de data). De app toont `ja` en `deels` als
"Podiumpas".

<!-- AUTO:theaters:start -->
**Noord-Holland** (25)

| Theater | Stad | Podiumpas | Status |
|---|---|---|---|
| Karavaan - Theater de Drukkerij | Alkmaar | ja | ok |
| Bostheater | Amstelveen | – | leeg |
| De Landing | Amstelveen | deels | ok |
| Schouwburg Amstelveen | Amstelveen | ja | ok |
| Amsterdams Marionetten Theater | Amsterdam | deels | ok |
| Bijlmer Parktheater | Amsterdam | ja | ok |
| CC Amstel | Amsterdam | ja | ok |
| De Kleine Komedie | Amsterdam | nee | ok |
| DeLaMar | Amsterdam | ja | ok |
| Frascati | Amsterdam | ja | ok |
| Koninklijk Theater Carré | Amsterdam | nee | ok |
| Muziekgebouw aan 't IJ | Amsterdam | ja | ok |
| Plein Theater | Amsterdam | nee | ok |
| Podium Mozaïek | Amsterdam | ja | terugval |
| Scala Theater | Amsterdam | ja | ok |
| Stadsschouwburg Amsterdam | Amsterdam | nee | ok |
| Theater Bellevue | Amsterdam | ja | ok |
| Theater De Krakeling | Amsterdam | ja | ok |
| Theater de Meervaart | Amsterdam | ja | ok |
| VU Griffioen | Amsterdam | ja | ok |
| Kennemer Theater | Beverwijk | – | gepauzeerd sinds 2026-10-01 |
| Theater de Omval | Diemen | ja | ok |
| Schuur | Haarlem | ja | ok |
| Cpunt | Hoofddorp | nee | ok |
| Zaantheater | Zaandam | ja | ok |

**Zuid-Holland** (12)

| Theater | Stad | Podiumpas | Status |
|---|---|---|---|
| Theater het Kruispunt | Barendrecht | – | gepauzeerd sinds 2026-09-28 |
| Isala theater | Capelle aan den IJssel | – | gepauzeerd sinds 2026-09-28 |
| Koninklijke Schouwburg | Den Haag | ja | ok |
| Theater aan het Spui | Den Haag | ja | ok |
| Zaal 3 | Den Haag | ja | ok |
| Theater Ins Blau | Leiden | ja | ok |
| Theater Koningshof | Maassluis | deels | ok |
| Maas theater en dans | Rotterdam | ja | ok |
| Theater Rotterdam (TR25 Schouwburg) | Rotterdam | ja | ok |
| Theater Rotterdam (TR8 William Boothlaan) | Rotterdam | ja | ok |
| Theater de Stoep | Spijkenisse | deels | ok |
| Stadsgehoorzaal | Vlaardingen | deels | ok |

**Utrecht** (5)

| Theater | Stad | Podiumpas | Status |
|---|---|---|---|
| Flint | Amersfoort | deels | ok |
| Aan de Slinger | Houten | deels | ok |
| Podium Hoge Woerd | Utrecht | ja | ok |
| Stadsschouwburg Utrecht | Utrecht | ja | ok |
| Theater Kikker | Utrecht | ja | ok |

**Flevoland** (2)

| Theater | Stad | Podiumpas | Status |
|---|---|---|---|
| Corrosia | Almere | deels | ok |
| Kunstlinie | Almere | deels | ok |

**Limburg** (9)

| Theater | Stad | Podiumpas | Status |
|---|---|---|---|
| Theater Heerlen | Heerlen | nee | ok |
| Theater Kerkrade | Kerkrade | nee | ok |
| AINSI | Maastricht | nee | ok |
| Theater aan het Vrijthof | Maastricht | nee | ok |
| DOK6 | Panningen | deels | ok |
| Theater De Oranjerie | Roermond | nee | ok |
| Toon Hermans Theater Sittard | Sittard | nee | ok |
| De Maaspoort Theater & Events | Venlo | deels | ok |
| Munttheater | Weert | nee | ok |

**Noord-Brabant** (12)

| Theater | Stad | Podiumpas | Status |
|---|---|---|---|
| Theater aan de Parade | 's-Hertogenbosch | deels | ok |
| Toonzaal Willem Twee | 's-Hertogenbosch | deels | ok |
| Kattendans | Bergeijk | deels | ok |
| Parktheater Eindhoven | Eindhoven | – | gepauzeerd sinds 2026-10-06 |
| Het Speelhuis | Helmond | ja | ok |
| De Link | Tilburg | ja | ok |
| Paradox | Tilburg | deels | ok |
| S.M.E.T. | Tilburg | ja | ok |
| Schouwburg Concertzaal | Tilburg | deels | ok |
| Theater De Nieuwe Vorst | Tilburg | ja | ok |
| Markant Theater Maashorst | Uden | deels | ok |
| Theater de Hofnar | Valkenswaard | deels | ok |

**Gelderland** (7)

| Theater | Stad | Podiumpas | Status |
|---|---|---|---|
| Theater Orpheus | Apeldoorn | – | onbekend |
| Huis Oostpool | Arnhem | – | onbekend |
| Musis Arnhem | Arnhem | – | onbekend |
| Stadstheater Arnhem | Arnhem | – | onbekend |
| TAR | Arnhem | – | onbekend |
| Schaffelaartheater | Barneveld | deels | ok |
| Schouwburg Agnietenhof | Tiel | – | gepauzeerd sinds 2026-10-07 |
<!-- AUTO:theaters:end -->
