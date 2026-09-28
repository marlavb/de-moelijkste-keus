# Werkafspraken voor dit project

Podiumagenda (repo `de-moelijkste-keus`) scrapet elke nacht de agenda's van
Podiumpas-theaters (`src/`), schrijft `public/data/*.json` en publiceert de
app in `public/` via GitHub Pages. De workflow `refresh-data.yml` draait om
04:00 UTC (in de praktijk vaak later) en commit de data zelf.

## Git

- Vóór elke commit: `git restore public/data/shows.json public/data/scrape-status.json public/data/theaters.json`
  als een lokale testrun die heeft overschreven. Commit lokaal gegenereerde
  data alleen in een bewust, apart datacommit (en zeg dat in de message).
- Altijd `git diff --stat` (of `git diff --cached --stat`) vóór het committen.
- `git pull --ff-only` vóór elke push.
- Niet pushen terwijl `refresh-data` draait (`gh run list --workflow=refresh-data.yml --limit 1`).
  De workflow zet vlak voor zijn eigen push de data op de nieuwste `main`,
  maar een push midden in een run blijft onnodig risico.
- Eén commit per stap of onderwerp; stage expliciete bestanden, geen `git add -A`.

## Testverkeer naar theatersites

Theaters kunnen ons weren (Isala en Kruispunt deden dat op 28 sep 2026).
Houd het testverkeer daarom zo klein mogelijk:

- Tijdens het bouwen: `SCRAPE_CACHE=1 node src/index.js --only=<id>`. Pagina's
  komen dan uit `debug/cache/` (lokaal, niet in git); elke pagina wordt hooguit
  één keer per dag echt opgehaald. In CI wordt de cache altijd genegeerd.
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
- Uitgesloten voorstellingen (film, verhuur, gast, prijs > €50, …) blijven in
  de data met `podiumpas: false`, zoals bij Aan de Slinger en Corrosia.
- Theaternamen in `config.js` letterlijk zoals op podiumpas.nl.

## Scrapers

- Elke scraper roept `waitForTurn()` aan vóór elke request (budget en
  vangnet hangen daarvan af).
- Sanity check: gooi een exception als de agendacontainer of -teller
  ontbreekt, in plaats van stil `[]` terug te geven.
- Test met `npm test` (unit tests, geen netwerk) en `--only=<id>` plus een
  steekproef van 5 voorstellingen tegen de site.

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
