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
  for (const genreRuw of ['Theater, Dans, Performance, Film', 'Muziek, Film', 'Komedie, film, Special', 'Muziek/Concert, Volwassenenfilms, Special', 'Drama', 'Komedie', 'Theaterconcert', null]) {
    assert.equal(geenVoorstelling({ titel: 'X', genreRuw }), null, String(genreRuw));
  }
  for (const titel of ['Cinekid Festival', 'Underground Cinema', 'European Outdoor Film Tour 26/27', 'Diner Zin in Film: Songs of Earth']) {
    assert.equal(geenVoorstelling({ titel }), 'film', titel);
  }
  for (const titel of ['MASTER OF FILM MUSIC – Ennio Morricone', 'Films live in Concert II', 'Cinema Symphonica', 'Homesick for another world: a film unfolding in space']) {
    assert.equal(geenVoorstelling({ titel }), null, titel);
  }
});
