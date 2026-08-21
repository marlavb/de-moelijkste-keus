# De Moeilijkste Keus

Twee onderdelen:

1. **Scraper** (`src/`) — command-line tool die theateragenda's van
   Amsterdamse theaters ophaalt en normaliseert naar één gedeeld
   JSON-formaat (`data/shows.json`).
2. **App** (`public/`) — mobile-first PWA die die data toont als
   doorzoekbare, filterbare agenda. Puur HTML/CSS/JS, geen build-stap, leest
   `public/data/shows.json` (een kopie die de scraper er automatisch
   naartoe zet).

Ondersteunde theaters: **DeLaMar Theater**, **Theater Bellevue**, **De Meervaart**.

## Installeren

Vereist Node.js 20+.

```bash
npm install
npx playwright install chromium
```

## Draaien

```bash
npm run scrape
```

Dit scraped alle drie theaters en schrijft (samengevoegd) naar `data/shows.json`.

Om maar één theater te (her)scrapen zonder de rest te overschrijven:

```bash
node src/index.js --only=delamar
node src/index.js --only=bellevue
node src/index.js --only=meervaart
node src/index.js --only=delamar,meervaart
```

Elke run vervangt alleen de entries van de gescrapete theater(s) in
`data/shows.json` — de rest blijft staan.

### Hoe lang duurt het?

- **DeLaMar**: ~1 minuut. Eén agendapagina, alle voorstellingen staan er al
  op (met "Toon meer" bijgeladen).
- **Meervaart**: ~1-2 minuten. Agendapagina + één detailpagina per productie
  (nodig om per-datum ticketlinks te krijgen).
- **Bellevue**: **~15-20 minuten**. Bellevue's `robots.txt` vraagt expliciet
  om een crawl-delay van 5 seconden, en omdat de agendapagina alleen
  startdatums toont (niet elke losse voorstelling), bezoeken we voor élke
  productie de detailpagina om de echte datums en ticketlinks te vinden.
  Bij ~200 producties + ~25 agendapagina's, elk met 5s wachttijd ertussen,
  loopt dat vanzelf op. Dit is bewust traag gehouden — de site vraagt erom.

## De app draaien

De app is een statische map (`public/`) — elke simpele static file server
werkt, bijvoorbeeld:

```bash
npx serve public
# of
python3 -m http.server 8080 --directory public
```

Open daarna de getoonde URL (bv. `http://localhost:8080`) in je (mobiele)
browser. "Toevoegen aan beginscherm" installeert 'm als PWA.

Let op: `public/data/shows.json` is een momentopname van de laatste
`npm run scrape`. Na een nieuwe scrape hoef je de app niet opnieuw te
bouwen — gewoon de pagina verversen.

## Hoe de scraper werkt

- `src/lib/robots.js` — kleine, zelfgeschreven robots.txt-parser (geen
  dependency). Leest `User-agent: *`-regels, `Allow`/`Disallow`-patronen
  (met `*`-wildcards) en `Crawl-delay`, en wordt gebruikt om vóór elke request
  te checken of het pad is toegestaan.
- `src/lib/politeness.js` — regelt de vertraging tussen requests naar
  dezelfde site, gebaseerd op de crawl-delay uit robots.txt (met een nette
  minimumwaarde van 1 seconde als een site niets opgeeft).
- `src/lib/config.js` — theaterconfiguratie (naam, stad, URLs) en de
  User-Agent string. Zet evt. `SCRAPER_CONTACT=<url>` als env var om een
  contact-URL in de User-Agent op te nemen.
- `src/lib/normalize.js` — gedeelde helpers: Nederlandse datum-labels
  parsen ("Vandaag", "Zondag 23 augustus", "wo 9 sep"), tijd extraheren,
  en stabiele/unieke ids bouwen.
- `src/lib/genre.js` — mapt de site-specifieke genre-labels van elk
  theater naar één vaste set categorieën (`GENRE_CATEGORIES`) waarop de
  app filtert. Het originele label blijft bewaard als `genreRuw`.
- `src/sites/*.js` — één module per theater met de eigen scrape-logica.
  Elke site heeft een andere structuur (zie de comments bovenaan elk
  bestand voor wat er per site is uitgezocht), maar levert allemaal
  hetzelfde genormaliseerde schema op.
- `src/index.js` — CLI-orchestratie: leest robots.txt, start een browser,
  roept de juiste scraper-module(s) aan, en merget het resultaat in
  `data/shows.json` (en kopieert dat naar `public/data/shows.json`).

Alle pagina's worden opgehaald met Playwright (Chromium) en een duidelijke,
herkenbare User-Agent string, zodat theaters kunnen zien wie/wat er langskomt.

## Output-schema

Elke voorstelling in `data/shows.json`:

```json
{
  "id": "delamar-we-will-rock-you-2026-08-21-2000",
  "titel": "We Will Rock You",
  "theaterId": "delamar",
  "theaterNaam": "DeLaMar Theater",
  "stad": "Amsterdam",
  "datum": "2026-08-21",
  "tijd": "20:00",
  "genre": "Musical",
  "genreRuw": "Musical",
  "beschrijving": "De enige echte officiële Queen musical!",
  "reserverenUrl": "https://tickets.delamar.nl/nl/buyingflow/tickets/46810/114566/",
  "bron": "https://delamar.nl/agenda/",
  "opgehaaldOp": "2026-08-21T11:34:15.966Z"
}
```

- `tijd` en `genre` zijn `null` wanneer de site zelf geen tijd/genre toont.
- `genre` is genormaliseerd naar één van de acht vaste categorieën in
  `src/lib/genre.js` (Toneel, Musical, Cabaret, Muziektheater, Dans,
  Familie & Jeugd, Muziek & Concert, Overig) — dit is het veld waarop de
  app filtert. `genreRuw` is het originele, site-specifieke label
  (bv. Bellevue's "kleinkunst" of Meervaart's "theatercollege").
- `reserverenUrl` is de directe reserveringslink wanneer die beschikbaar is;
  als een voorstelling is uitverkocht of het theater geen directe link
  toont, valt dit terug op de infopagina van de voorstelling op de site van
  het theater zelf.

## Hoe de app werkt

- `public/index.html` — bevat alle vier schermen (agenda, detail, mijn
  theaters, favorieten) als losse `<section>`'s; `js/app.js` toont/verbergt
  ze op basis van een simpele hash-route (`#/`, `#/show/<id>`, `#/theaters`,
  `#/favorieten`), zodat de browser-terugknop en het delen van een link naar
  een specifieke voorstelling gewoon werken.
- Filters: theater is een quick-filter chip-rij op het agenda-scherm zelf;
  genre zit (samen met dezelfde theater-chips) achter het filter-icoon in
  een sheet, met een badge die het aantal actieve filters toont.
- Het agenda-scherm toont standaard alleen voorstellingen tot 60 dagen
  vooruit (met 1136+ voorstellingen tot in 2028 is "alles" geen bruikbare
  lijst) — een knop onderaan de lijst toont in één tik de rest, voor
  langlopende producties die je maanden van tevoren wil boeken.
- "Mijn theaters" bepaalt welke theaters überhaupt in de agenda meedoen
  (opgeslagen in `localStorage`) — los van de quick-filter, die bepaalt wat
  je *op dit moment* ziet binnen de ingeschakelde theaters.
- Favorieten (hartje op het detailscherm, opgeslagen in `localStorage`) heeft
  nu een eigen scherm via de "Favorieten"-tab, met dezelfde
  datum-gegroepeerde lijst als de agenda en een lege-staat-melding.
- De "Voeg toe aan agenda"-knop op het detailscherm genereert een
  `.ics`-bestand, downloadbaar in elke agenda-app.
- `sw.js` cachet de app-shell (cache-first) en `data/shows.json`
  (network-first, met cache als fallback) voor gebruik zonder internet na
  een eerste bezoek.

## Bekende beperkingen

- Datums zonder jaartal (zoals theaters die zelf ook tonen, bv. "23
  augustus") worden geïnterpreteerd door het jaar op te hogen zodra de
  agenda chronologisch een maand terugspringt. Dit gaat ervan uit dat de
  bronpagina chronologisch gesorteerd is, wat bij alle drie theaters het
  geval is.
- Bij Bellevue heeft een deel van de voorstellingen (vooral ver in de
  toekomst) nog geen directe ticketlink op de site zelf — de site gebruikt
  daar een eigen boekingswidget (JavaScript) in plaats van een normale link.
  In die gevallen valt `reserverenUrl` terug op de infopagina.
