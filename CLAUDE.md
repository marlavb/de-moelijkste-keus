# Werkafspraken voor dit project

Podiumagenda (repo `de-moelijkste-keus`) scrapet elke nacht de agenda's van
Podiumpas-theaters (`src/`), schrijft `public/data/*.json` en publiceert de
app in `public/` via GitHub Pages. De workflow `refresh-data.yml` start om
05:00 Europe/Amsterdam via de Cloud Function `startNachtrun`, met de cron van
03:17 UTC als vangnet (GitHub start die soms uren later); een tweede run op
dezelfde dag stopt meteen. De workflow commit de data zelf.

## Git

- Vóór elke commit: `git restore public/data/shows.json public/data/scrape-status.json public/data/theaters.json cache/detail`
  als een lokale testrun die heeft overschreven (`cache/detail/` is de cache van
  detailpagina's tussen runs; een nieuw lokaal bestand daar: `git clean -n cache/detail`). Commit lokaal gegenereerde
  data alleen in een bewust, apart datacommit (en zeg dat in de message).
- Altijd `git diff --stat` (of `git diff --cached --stat`) vóór het committen.
- Pushen altijd via `npm run safe-push` (eventueel `-- <git push-argumenten>`):
  dat weigert zolang een `refresh-data`-run loopt of in de wachtrij staat
  (ook als `gh` het niet kan vaststellen), doet dan `git pull --ff-only`,
  draait alle testsuites (`scripts/testpoort.js`: unit, rules, functions,
  e2e; stopt bij de eerste die faalt, op de exitcode) en pas dan `git push`.
  Duurt dus ~10 minuten. `npm run safe-push -- --dry-run` doet alleen de
  refresh-controle. Nooit omheen werken (ook geen `--no-verify`); bij een
  weigering eerst de run afwachten of de test repareren.
- Dezelfde controles zitten in de pre-push-hook `.githooks/pre-push`; activeer
  die in een nieuwe clone met `git config core.hooksPath .githooks`.
  Waarom de testpoort: op 8 okt 2026 ging een push door terwijl een test
  faalde (de controle keek naar tekst in de uitvoer, niet naar de exitcode).
  Waarom: op 29 sep 2026 is er gepusht terwijl een (uitgestelde) nachtelijke
  run liep, ondanks de afspraak. De workflow zet vlak voor zijn eigen push de
  data op de nieuwste `main`, maar een push midden in een run blijft risico.
- Eén commit per stap of onderwerp; stage expliciete bestanden, geen `git add -A`.

## README

- Bij een nieuwe of gewijzigde functie ook de vaste tekst in `README.md`
  bijwerken, in dezelfde commit of branch.
- De blokken tussen `<!-- AUTO:…:start -->` en `<!-- AUTO:…:end -->` niet met
  de hand aanpassen: die maakt `scripts/readme.js` (workflow `readme.yml`, na
  elke push naar main en na de nachtelijke run; commit alleen bij een
  wijziging, met `[skip ci]`). Nieuw blok = markers in de README plus een
  sleutel in `maakBlokken`.
- Na een push naar main kan de README-bot er een commit achter zetten: eerst
  pullen voordat je op main verder werkt of merget.

## Testverkeer naar theatersites

Theaters kunnen ons weren (Isala en Kruispunt deden dat op 28 sep 2026).
Houd het testverkeer daarom zo klein mogelijk:

- Tijdens het bouwen: `SCRAPE_CACHE=1 node src/index.js --only=<id>`. Pagina's
  komen dan uit `debug/cache/` (lokaal, niet in git); elke pagina wordt hooguit
  één keer per dag echt opgehaald. In CI wordt de cache altijd genegeerd.
  Een herhaalde run die niets nieuws mag ophalen: `SCRAPE_CACHE=1
  SCRAPE_OFFLINE=1` (pagina's buiten de cache worden afgebroken; robots.txt
  komt ook uit de cache en wordt nooit echt opgehaald: ontbreekt hij, dan
  "geen regels" met een waarschuwing in de log). Let op bij
  scrapers met een grens per run (Musis, Schaffelaar): een tweede run haalt
  anders de pagina's achter die grens echt op.
- Hooguit één volledige testrun (zonder cache) per theater per dag.
- Verkenningsscripts gebruiken ook de crawl-delay: `loadRobotsRules` +
  `createPoliteWaiter` en `waitForTurn()` vóór elke request.
- Nooit `curl -L` of een kale `fetch` naar een site met onbekend
  redirectgedrag (redirectlussen via een wachtrij gaven op 27 sep honderden
  requests in seconden). Gebruik `fetchFollowingCookies` uit `src/lib/robots.js`.
- Onze user-agent verwijst naar `public/bot.html` (via `SCRAPER_CONTACT`).

## Botblokkades

- Nooit omzeilen: geen andere user-agent, geen stealth-plugins, geen
  proxy's, geen challenge-solvers. Een blokkade via robots.txt of een
  firewall/botcontrole wordt altijd gerespecteerd.
- Een theater dat ons weert, zet je in `src/lib/config.js` op
  `gepauzeerd: { sinds, reden }`: geen requests meer, status `gepauzeerd`,
  een melding in "Mijn theaters". Terugzetten = die regel weghalen.
- Eén gewone herpoging na een pauze is prima (zie Flint); meer niet.

## Podiumpas-dekking

- Altijd verifiëren, nooit gokken. Bronnen, in volgorde: de Podiumpas-pagina
  van het theater zelf, het prijstype "Podiumpas" in het echte boekingswidget,
  podiumpas.nl/waar-te-besteden. Kun je het niet vaststellen, zeg dat en
  kies niet stilletjes.
- Zet bij elke keuze in de code of config de bron-URL en de datum.
- Uitgesloten voorstellingen (verhuur, gast, prijs > €50, …) blijven in
  de data met `podiumpas: false`, zoals bij Aan de Slinger en Corrosia.
- Films worden weggelaten (geen voorstellingen), zoals bij PLT, Agnietenhof
  en Schaffelaar.
- Theaternamen in `config.js` letterlijk zoals op podiumpas.nl.

## Scrapers

- Elke scraper roept `waitForTurn()` aan vóór elke request (budget en
  vangnet hangen daarvan af).
- Sanity check: gooi een exception als de agendacontainer of -teller
  ontbreekt, in plaats van stil `[]` terug te geven.
- Test met `npm test` (unit tests, geen netwerk) en `--only=<id>` plus een
  steekproef van 5 voorstellingen tegen de site.
- Een theater dat een ruimere pauze nodig heeft dan robots.txt geeft:
  `crawlDelaySeconden` in `config.js` (nu ITA, 4 s).
- Faalt een scrape, dan staat er een `DIAGNOSE:`-regel in de log (HTTP-status,
  URL, paginatitel, begin van de body); kijk daar eerst naar.
- Scala (Amsterdam) blijft bewust zonder tijden: avondvullend programma
  (korte voorstellingen achter elkaar, geen vaste aanvangstijd per
  voorstelling). Niet "repareren". Dit is het enige theater dat bewust
  zonder tijden blijft.
- Tijden van een detailpagina of API (okt 2026): Carré via
  `/api/render/voorstelling/<slug>` (JSON, met detailcache
  `cache/detail/carre.json`), Karavaan via de detailpagina's (elke nacht
  alle ~10, zonder cache).

## Watchlist-sleutels

- Watchlist-items hangen aan een genormaliseerde titel (`watchlistSleutel`
  in `public/js/watchlist.js`, gebouwd op `normalizeTitle` en
  `EXCLUDED_NORMALIZED_TITLES` in `public/js/productions.js`).
- Elke wijziging aan die normalisatie of aan de uitsluitlijst vraagt:
  1. `NORMALISATIE_VERSIE` ophogen;
  2. `renormaliseer()` zo aanpassen dat opgeslagen items met een oudere
     versie idempotent naar de nieuwe sleutel gaan (zonder "gedaan"-vlag);
  3. een test daarvoor, en de vaste titeltest in `test/watchlist.test.js`
     bijwerken (Juf Braaksel, Titanique, Controle, Jörgen/Jorgen, Nora,
     Adem, Cabaret, Sara Kroos).
- Het oude `favorites`-veld (localStorage en Firestore) blijft onaangeroerd
  als back-up.

## Aliaslijst (stap B actief sinds 9 okt 2026)

- De lijst staat in `config/aliassen.json` (bron-sleutel → { titel, maker },
  plus "nietSamenvoegen"; logica in `src/lib/aliassen.js`) en wordt centraal
  toegepast in de nabewerking, na labels, R1, R4 en R5, ook op behouden data.
  Niet met de hand bewerken. Geen `NORMALISATIE_VERSIE`-ophoging: oude
  sleutels gaan mee via `titelBron`/`titelVoorAlias` → `samenvoegMapping`
  (ook gepland.js en `kopieSleutel` voor vrienden).
- Werkwijze bij nieuwe keuzes, altijd in deze volgorde:
  1. `npm run alias-afvinkpagina` → `debug/alias-afvinken.html` (groepen die
     al in de lijst staan, tellen als beoordeeld; filter "Nog te doen");
  2. de gebruiker vinkt af en exporteert (`alias-keuzes-<datum>.json`);
  3. `npm run alias-importeren -- <export> --droog`, daarna zonder `--droog`
     (overzicht: nieuw, gewijzigd, verwijderd, conflicten);
  4. voor/na op de huidige data (lokale nabewerking, geen scrape): titels,
     makers, watchlist-sleutels, en gebruikersitems alleen lezen;
  5. pas na akkoord van de gebruiker committen en pushen.
- Regels: bij "andere naam" is de ingevulde maker vast (ook leeg); bij
  "samenvoegen" telt de voorstelmaker, behalve als die elders de titel van een
  andere productie is (CATS / "Het meesterwerk"); een bron met twee doelen gaat
  niet in de lijst; groepen met dezelfde titel en geen botsende makers worden
  één productie.
- R2/R3 (`npm run alias-voorstel`) alleen uit de voorstellen zonder twijfel,
  met de bewakers in `src/lib/aliasVoorstel.js`; nooit voor "nietSamenvoegen",
  een afgevinkte keuze gaat voor.
- Stap A blijft: `npm run alias-kandidaten` (`debug/alias-kandidaten.md`).
- Bekende kandidaat (1 okt 2026): Jordy van Loon, "Louis Davids – De Grote
  Kleine Man" (Cpunt `jordy van loon`, Kennemer Theater `de grote kleine man |
  louis davids`). Nog geen alias.
