// De vier mogelijke waarden voor het `beschikbaarheid`-veld in het
// gedeelde schema. Elke theatersite gebruikt eigen knop-teksten/CSS-classes
// om dit te tonen, dus er is geen gedeelde "normalize"-functie zoals bij
// genre — elke scraper classificeert zelf wat de site laat zien, met deze
// vier waarden als vast contract. "onbekend" is de eerlijke fallback
// wanneer een site geen duidelijk signaal geeft (of iets toont dat niet
// over voorraad gaat, zoals "binnenkort" of "voorstelling afgelopen").
export const BESCHIKBAARHEID_WAARDEN = ['beschikbaar', 'uitverkocht', 'wachtlijst', 'onbekend'];
