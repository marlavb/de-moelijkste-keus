// R2/R3 uit het aliasvoorstel (titels-ronde-2, 9 okt 2026), met fixtures naar
// echte groepen zonder twijfel.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { voegVoorstelToe, klopt, lijktOpNaam } from '../src/lib/aliasVoorstel.js';

const lid = (titel, maker, sleutel, n = 1) => ({ theater: 't', titel, maker, n, sleutel });
const groep = (anker, soort, canoniek, canoniekeSleutel, leden, twijfel = []) => ({ anker, soorten: [soort], twijfel, canoniek, canoniekeSleutel, sleutels: [...new Set(leden.map((l) => l.sleutel))], leden });

const voorstel = {
  groepen: [
    groep('appeltje', 'e', 'Appeltje Eitje – Nienke Plas', 'appeltje eitje | nienke plas', [lid('Appeltje Eitje – Nienke Plas', null, 'appeltje eitje | nienke plas', 22), lid('Nienke Plas', null, 'nienke plas')]),
    groep('drama', 'f', 'The Drama', 'the drama', [lid('The Drama', 'Theater Oostpool', 'the drama', 26), lid('Theater Oostpool – The Drama', 'regie: Florian Myjer', 'the drama | theater oostpool')]),
    // Omgedraaid: de "maker" is de voorstelling, en geen bekende maker.
    groep('anneke', 'f', 'Anneke van Giersbergen', 'anneke van giersbergen', [lid('Anneke van Giersbergen', 'The Irish Road Trip', 'anneke van giersbergen', 5), lid('Anneke van Giersbergen – The Irish Road Trip', null, 'anneke van giersbergen | the irish road trip')]),
    // Andere voorstelling, geen maker erbij.
    groep('adem', 'e', 'Het meisje dat de wereld schreef (8+)', 'het meisje dat de wereld schreef', [lid('Het meisje dat de wereld schreef (8+)', 'Cézanne Tegelberg & Company', 'het meisje dat de wereld schreef', 3), lid('ADEM', null, 'theateraanhetspui::adem')]),
    // Apart evenement.
    groep('soundlab', 'e', 'SoundLAB workshop – Paas Special', 'paas special | soundlab workshop', [lid('SoundLAB workshop – Paas Special', null, 'paas special | soundlab workshop', 2), lid('SoundLAB workshop', null, 'soundlab workshop')]),
    // Met twijfel of gemengd: niet.
    groep('twijfel', 'e', 'X – Iemand', 'iemand | x', [lid('X – Iemand', null, 'iemand | x'), lid('X', null, 'x')], ['korte titel']),
    { ...groep('gemengd', 'e', 'Y – Iemand', 'iemand | y', [lid('Y – Iemand', null, 'iemand | y'), lid('Y', null, 'y')]), soorten: ['a', 'e'] },
    // Staat in "niet samenvoegen".
    groep('rhobijn', 'f', 'Rhobijn', 'rhobijn', [lid('Rhobijn', 'Rowwen Hèze', 'rhobijn', 4), lid('Rowwen Hèze – Rhobijn', null, 'rhobijn | rowwen heze')]),
  ],
};
const isMaker = (m) => ['Theater Oostpool'].includes(m);

test('R2/R3 alleen zonder twijfel, één soort, kloppende titeldelen en een bekende maker', () => {
  const bestaand = { aliassen: { 'nienke plas': { titel: 'Appeltje Eitje', maker: null, groep: 'x', regel: 'keuze' } }, nietSamenvoegen: [{ groep: 'r', sleutels: ['rhobijn | rowwen heze'] }] };
  const { lijst, overzicht } = voegVoorstelToe(bestaand, voorstel, { isMaker });
  // Afgevinkte keuze gaat voor.
  assert.equal(lijst.aliassen['nienke plas'].regel, 'keuze');
  assert.deepEqual(lijst.aliassen['the drama | theater oostpool'], { titel: 'The Drama', maker: 'Theater Oostpool', groep: 'drama', regel: 'R3' });
  for (const bron of ['anneke van giersbergen | the irish road trip', 'theateraanhetspui::adem', 'soundlab workshop', 'x', 'y', 'rhobijn | rowwen heze']) assert.equal(lijst.aliassen[bron], undefined, bron);
  assert.equal(overzicht.R3.length, 1);
  assert.equal(overzicht.R2.length, 0);
  // Zonder de keuze: Nienke Plas via R2.
  const zonder = voegVoorstelToe({ aliassen: {}, nietSamenvoegen: [] }, voorstel, { isMaker });
  assert.deepEqual(zonder.lijst.aliassen['nienke plas'], { titel: 'Appeltje Eitje – Nienke Plas', maker: 'Nienke Plas', groep: 'appeltje', regel: 'R2' });
  // Opnieuw draaien: eerdere R2/R3 worden opnieuw bepaald, niets dubbel.
  assert.deepEqual(voegVoorstelToe(zonder.lijst, voorstel, { isMaker }).lijst, zonder.lijst);
});

test('klopt en lijktOpNaam', () => {
  assert.equal(klopt('Gelukkig maar', 'GELUKKIG MAAR – Myrte Siebinga', 'Myrte Siebinga'), true);
  assert.equal(klopt('Nienke Plas', 'Appeltje Eitje – Nienke Plas', 'Nienke Plas'), true);
  assert.equal(klopt('Theater Oostpool – The Drama', 'The Drama', 'Theater Oostpool'), true);
  assert.equal(klopt('ADEM', 'Het meisje dat de wereld schreef (8+)', 'Cézanne Tegelberg & Company'), false);
  assert.equal(klopt('Onbegrijpelijk Rijk', 'Onbegrijpelijk rijk (dernière)', 'Theater RAST'), false);
  for (const m of ['Paas Special', 'SOLO', 'Presentatie', 'een helder theatercollege']) assert.equal(lijktOpNaam(m), false, m);
  for (const m of ['Myrte Siebinga', 'Holland Dance Festival', 'Taylor Swift Tribute Band']) assert.equal(lijktOpNaam(m), true, m);
});
