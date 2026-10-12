import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isMozaiekWorkshop } from '../src/sites/mozaiek.js';

test('Mozaïek: workshops en cursussen weg, gesprekken en talks blijven (12 okt 2026)', () => {
  for (const t of ["Workshop: The storyteller's voice", 'Workshop: Kennismakingsworkshop Storytelling', 'Cursus: Schrijven', 'Masterclass zang']) assert.equal(isMozaiekWorkshop(t), true, t);
  for (const t of ['Talk: Divine Eyes', 'Gesprek: Op haar 23e was Romy voor het eerst jarig', 'Niemandsland: ontmoet de meestervertellers', 'De Wasserette', 'Workshopvoorstelling']) assert.equal(isMozaiekWorkshop(t), false, t);
});
