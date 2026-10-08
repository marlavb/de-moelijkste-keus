// Privacybericht (vrienden, stap 3): de pagina bestaat, noemt wat we
// opslaan en wie wat ziet, heeft twee keer het contactadres (mailto), en
// is te bereiken vanuit Profiel (ook offline via de service worker).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const lees = (p) => readFile(new URL(`../public/${p}`, import.meta.url), 'utf8');

test('privacy.html: wat we opslaan, wie wat ziet, verwijderen, plaatshouder voor contact', async () => {
  const html = await lees('privacy.html');
  for (const kop of ['Zonder inloggen', 'Met inloggen (Google)', 'Wie ziet wat?', 'Verwijderen']) assert.match(html, new RegExp(`<h2>${kop.replace(/[()?]/g, '\\$&')}</h2>`));
  assert.match(html, /gebruikersnaam en je volledige naam/);
  assert.match(html, /<strong>Zoeken op naam<\/strong>: .*je zet het uit in Profiel → Vindbaar op naam\./);
  assert.match(html, /Je e-mailadres<\/strong> ziet niemand anders/);
  assert.match(html, /Je planning<\/strong> \(Gepland\) ziet niemand anders/);
  assert.match(html, /Account verwijderen/);
  assert.match(html, /alleen om je een mail te sturen als een vriend je uitnodigt voor een voorstelling\. Die mail gaat via Gmail \(Google\)\. Je zet het uit in Profiel → Mail\./);
  assert.doesNotMatch(html, /INVULLEN/);
  assert.equal((html.match(/<a href="mailto:marlavb\.github@gmail\.com">marlavb\.github@gmail\.com<\/a>/g) ?? []).length, 2);
  assert.match(html, /<html lang="nl">/);
});

test('privacy is te bereiken vanuit Profiel en bot.html, en network-first in de service worker', async () => {
  assert.match(await lees('index.html'), /<a href="privacy\.html">Privacy: wat we opslaan en wie wat ziet<\/a>/);
  assert.match(await lees('bot.html'), /href="privacy\.html"/);
  assert.match(await lees('sw.js'), /'\/privacy\.html'/);
});
