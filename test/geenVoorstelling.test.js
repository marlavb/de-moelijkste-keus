import { test } from 'node:test';
import assert from 'node:assert/strict';
import { geenVoorstelling } from '../src/lib/geenVoorstelling.js';

test('geenVoorstelling: workshops, cursussen en masterclasses weg; Workshopvoorstelling blijft (12 okt 2026)', () => {
  for (const titel of ['Workshop Gezonde Snoep (DIY) 4-12 jaar', 'Workshop: Hoe voer je een gesprek met een wetenschapsontkenner?', 'Masterclass barokcello', 'SoundLAB workshop – Paas Special', 'Ouder-kind workshop bij Alice in Wonderland', 'Cursus improvisatie', 'Workshop']) {
    assert.equal(geenVoorstelling({ titel }), 'workshop', titel);
  }
  for (const titel of ['Masterclass Igone de Jongh', 'Masterclass REVOLTA', 'Workshopvoorstelling: De Rattenvanger', 'Museumnacht: Collected Past & Frequency', 'Het is een lange weg naar de workshop', 'Talk: Wie schrijft de geschiedenis?']) {
    assert.equal(geenVoorstelling({ titel, genreRuw: 'Muziek, Dans, Spoken Word, Performance, Film, Festival, Workshop' }), null, titel);
  }
});

test('geenVoorstelling: alleen filmgenres weg, film als extra tag naast een podiumgenre blijft (12 okt 2026)', () => {
  for (const genreRuw of ['Film', 'film', 'Familiefilm', 'film, Familiefilm', 'Film | Jeugd', 'Animatie, Familiefilm', 'Drama, film', 'Komedie, film', 'film, Arthouse', 'Actie, film']) {
    assert.equal(geenVoorstelling({ titel: 'X', genreRuw }), 'film', genreRuw);
  }
  for (const genreRuw of ['Theater, Dans, Performance, Film', 'Muziek, Film', 'Muziek/Concert, Volwassenenfilms, Special', 'Drama', 'Komedie', 'Theaterconcert', null]) {
    assert.equal(geenVoorstelling({ titel: 'X', genreRuw }), null, String(genreRuw));
  }
  for (const titel of ['Cinekid Festival', 'Underground Cinema', 'European Outdoor Film Tour 26/27', 'Diner Zin in Film: Songs of Earth']) {
    assert.equal(geenVoorstelling({ titel }), 'film', titel);
  }
  for (const titel of ['MASTER OF FILM MUSIC – Ennio Morricone', 'Films live in Concert II', 'Cinema Symphonica', 'Homesick for another world: a film unfolding in space']) {
    assert.equal(geenVoorstelling({ titel }), null, titel);
  }
});

test('geenVoorstelling: quizzen weg (woord dat op "quiz" eindigt), niet Quizmaster; twijfelgevallen blijven (13 okt 2026)', () => {
  for (const titel of ['Pubquiz', 'Musical pubquiz', 'Pubquiz ‘Met de fles op tafel’', 'Jaarquiz 2026', 'Algemene kennis- en Muziekquiz', 'Quiz', 'De grote Quiz-avond']) {
    assert.equal(geenVoorstelling({ titel }), 'quiz', titel);
  }
  for (const titel of ['Quizmaster – de voorstelling', 'Quizzen met Jan', 'Niet zomaar een Pubquiz #3 – Flunknarf', 'Interactieve muziekquiz – De Hitbingo Band', 'Squizzle']) {
    assert.equal(geenVoorstelling({ titel }), null, titel);
  }
});

test('geenVoorstelling strakker: samengestelde woorden, genre Workshop, films met andere tags, filmtitels (15 okt 2026)', () => {
  for (const [titel, genreRuw] of [
    ['Theaterworkshop 4+ (volwassen/kind)', 'Jeugd, Herfststukjes'], ['Danscursus: Beweegredenen', 'Bijzonder, Dans'],
    ['Circusworkshop – 6+', 'Familie'], ['Kookworkshop – Proef de herfst', 'Events'], ['Danscarrousel verschillende workshops', 'dans'],
    ['Cooking Mom Vegetarisch', 'Workshop'], ['Zomercursussen', null],
  ]) assert.equal(geenVoorstelling({ titel, genreRuw }), 'workshop', titel);
  for (const [titel, genreRuw] of [
    ['Other Mommy', 'Horror, film'], ['The Texas Chain Saw Massacre 50th Anniversary', 'Horror, film'],
    ['Ladies Night: Chateau Moordland', 'Komedie, film, Special'], ['Meraki Short Film Festival', 'Film, Festival'],
    ['De Club van Sinterklaas film: Paniek in het Pietendorp (AL)', 'Evenement | Jeugd'], ['Filmvertoning: Into the Hairy', 'Dans'],
    ['Sinterklaas film (AL)', null], ['De familie film – Corrosia', null],
  ]) assert.equal(geenVoorstelling({ titel, genreRuw }), 'film', titel);
  // Blijven: de uitzonderingen en wat erop lijkt maar een voorstelling is.
  for (const [titel, genreRuw] of [
    ['Masterclass Igone de Jongh', 'grote zaal, dans'], ['Masterclass REVOLTA', 'Dans'],
    ['KENKI KRIN KRIN', 'Theater, Dans, Performance, Film'], ['De Drinkbare Rivier', 'Muziek, Film'],
    ['Homesick for another world: a film unfolding in space', null], ['Niet zomaar een Pubquiz #2 – Flunknarf', 'Cabaret'],
    ['Interactieve muziekquiz – De Hitbingo Band', 'Muziek'], ['Workshoporkest', 'Uit de regio'], ['Jazzsessie', 'Sessie/Workshop'],
    ['Museumnacht: Collected Past & Frequency', 'Muziek, Dans, Spoken Word, Performance, Film, Festival, Workshop'],
    ['CineMusic Filmorkest', 'muziek'], ['Films live in Concert II', 'Muziek'], ['Nordwestdeutsche Philharmonie (DE) – Filmmuziek in Concert', 'Klassiek & Opera'],
    ['Movie Sing & Swing', 'Muziek/Concert, Special, Volwassenenfilms'], ['De spicy show rechtstreeks uit de filmstad Mumbai – Bollywood Masala', 'Theatershow'],
    ['Het is een lange weg naar de workshop', null],
  ]) assert.equal(geenVoorstelling({ titel, genreRuw }), null, titel);
});

test('geenVoorstelling: rondleidingen weg, tours en Theatertour blijven (15 okt 2026)', () => {
  for (const titel of [
    'Rondleiding', 'Openbare rondleiding (in het Nederlands)', 'The Bookshop Kids Rondleiding', 'Rondleiding door de Koninklijke Schouwburg',
    'Rondleiding: Duurzaamheid achter de schermen', 'Rondleiding in De Landing', 'Guided tour in English', 'Public tour (in English)',
    'Kijkje achter de schermen', 'Rondleidingen voor groepen',
  ]) assert.equal(geenVoorstelling({ titel }), 'rondleiding', titel);
  for (const titel of [
    'Theatertour', 'Liefde Onderschat – Theatertour – MEAU', 'Joe Jackson – Hope and Fury Tour 2026', 'Medammecour On Tour',
    'The Making of: Warming Up on Tour', 'KADO on TOUR', 'Rondleidingsmuziek', 'Achter de schermen – een backstage-komedie',
  ]) assert.equal(geenVoorstelling({ titel, genreRuw: 'Muziek' }), null, titel);
});
