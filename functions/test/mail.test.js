// Inhoud van de uitnodigingsmail: onderwerp, tekst, HTML, escaping, datum.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { maakUitnodigingsmail, escapeHtml, dagKort, amsterdamDatum } from '../mail.js';

const APP = 'https://marlavb.github.io/de-moelijkste-keus/';
const GEWOON = {
  uitnodiger: { gebruikersnaam: 'anna', naam: 'Anna de Vries' },
  voorstelling: { titel: 'Grip – Rayen Panday', theaterNaam: 'DeLaMar', stad: 'Amsterdam', datum: '2026-10-17', tijd: '20:15' },
  appUrl: APP,
};

test('onderwerp, tekst en HTML: wie, wat, wanneer, waar, link naar Berichten en afmelden', () => {
  const m = maakUitnodigingsmail(GEWOON);
  assert.equal(m.subject, '@anna nodigt je uit voor Grip – Rayen Panday');
  for (const deel of ['@anna (Anna de Vries) nodigt je uit', 'Grip – Rayen Panday', 'za 17 okt · 20:15', 'DeLaMar, Amsterdam', `${APP}#/berichten`, 'Geen mails meer? Zet het uit in Profiel → Mail:', `${APP}#/profiel/mail`, 'omdat @anna en jij vrienden zijn']) {
    assert.ok(m.text.includes(deel), deel);
  }
  assert.match(m.html, /<a href="https:\/\/marlavb\.github\.io\/de-moelijkste-keus\/#\/berichten"[^>]*>Bekijk in Podiumagenda<\/a>/);
  assert.match(m.html, /Zet het uit in Profiel → Mail<\/a>/);
  assert.ok(!/@[a-z]+\.[a-z]/.test(m.text + m.html), 'geen e-mailadres in de inhoud');
});

test('HTML-escaping van namen, titel, theater en stad; geen regeleinden in het onderwerp', () => {
  const m = maakUitnodigingsmail({
    uitnodiger: { gebruikersnaam: 'anna', naam: '<script>alert(1)</script>' },
    voorstelling: { titel: '<img src=x onerror=alert(2)> & "Co"\nBcc: x@y.z', theaterNaam: "<b>T'heater</b>", stad: '<i>Stad</i>', datum: '2026-10-17', tijd: '20:15' },
    appUrl: APP,
  });
  assert.ok(!/<script|<img|<b>|<i>/.test(m.html), m.html);
  assert.ok(m.html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(m.html.includes('&lt;img src=x onerror=alert(2)&gt; &amp; &quot;Co&quot;'));
  assert.ok(m.html.includes('&lt;b&gt;T&#39;heater&lt;/b&gt;, &lt;i&gt;Stad&lt;/i&gt;'));
  assert.ok(!/[\r\n]/.test(m.subject), m.subject);
  assert.equal(escapeHtml(`<>&"'`), '&lt;&gt;&amp;&quot;&#39;');
});

test('datum: kort Nederlands en de Amsterdamse dag (zomer- en wintertijd)', () => {
  assert.equal(dagKort('2026-10-18'), 'zo 18 okt');
  assert.equal(dagKort('2026-01-14'), 'woe 14 jan');
  assert.equal(amsterdamDatum(Date.parse('2026-07-15T21:59:59Z')), '2026-07-15');
  assert.equal(amsterdamDatum(Date.parse('2026-07-15T22:00:00Z')), '2026-07-16');
  assert.equal(amsterdamDatum(Date.parse('2026-01-15T23:00:00Z')), '2026-01-16');
});
