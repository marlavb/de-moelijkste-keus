// Sterrencomponent voor de beoordeling van een gezien voorstelling (1 okt
// 2026): 5 sterren, halve stappen. Eén herbruikbaar onderdeel voor Profiel,
// het detailscherm en "Ben je geweest?".
//
// - Tik op de linkerhelft van een ster = halve ster, rechterhelft = hele;
//   tik op de huidige waarde = wissen. Minimum 1 (de linkerhelft van de
//   eerste ster geeft 1). Op desktop een hover-voorbeeld.
// - Toegankelijk als role="slider" (aria-valuemin 1, aria-valuemax 5,
//   aria-valuenow, aria-valuetext "3,5 van 5 sterren" of "Nog niet
//   beoordeeld"); pijltjes ±0,5, Home/End, Delete/Backspace = wissen.
// - De halve ster is een echte halve vulling: per ster een gevulde ster die
//   met een clipPath op 0, 50 of 100% van de breedte wordt afgesneden.
// - Kleuren via CSS: .ster-vol --accent; .ster-rand --nav-inactive (leeg)
//   of --accent-text (gevuld), beide ≥ 4,4:1 tegen de achtergrond.

const SVG = 'http://www.w3.org/2000/svg';
const PAD = 'M12 2.6l2.9 5.9 6.5.9-4.7 4.6 1.1 6.5L12 17.4l-5.8 3.1 1.1-6.5-4.7-4.6 6.5-.9z';
let volgnummer = 0;

export function waardeTekst(waarde) {
  return waarde == null ? 'Nog niet beoordeeld' : `${String(waarde).replace('.', ',')} van 5 sterren`;
}

function maakSter(id) {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const defs = document.createElementNS(SVG, 'defs');
  const clip = document.createElementNS(SVG, 'clipPath');
  clip.setAttribute('id', id);
  const rect = document.createElementNS(SVG, 'rect');
  rect.setAttribute('x', '0');
  rect.setAttribute('y', '0');
  rect.setAttribute('width', '0');
  rect.setAttribute('height', '24');
  clip.appendChild(rect);
  defs.appendChild(clip);
  const vol = document.createElementNS(SVG, 'path');
  vol.setAttribute('d', PAD);
  vol.setAttribute('class', 'ster-vol');
  vol.setAttribute('clip-path', `url(#${id})`);
  const rand = document.createElementNS(SVG, 'path');
  rand.setAttribute('d', PAD);
  rand.setAttribute('class', 'ster-rand');
  svg.append(defs, vol, rand);
  return { svg, rect };
}

/**
 * Maakt het component. `onWijzig(waarde | null)` bij elke wijziging door de
 * gebruiker. `el.zetWaarde(w)` zet de waarde van buitenaf (zonder onWijzig).
 */
export function maakSterren({ waarde = null, label = 'Beoordeling', onWijzig = () => {} } = {}) {
  const id = `ster-${++volgnummer}`;
  const el = document.createElement('div');
  el.className = 'sterren';
  el.tabIndex = 0;
  el.setAttribute('role', 'slider');
  el.setAttribute('aria-label', label);
  el.setAttribute('aria-valuemin', '1');
  el.setAttribute('aria-valuemax', '5');

  let huidig = waarde;
  const sterren = [];
  for (let i = 1; i <= 5; i++) {
    const vak = document.createElement('span');
    vak.className = 'ster';
    vak.dataset.ster = String(i);
    const { svg, rect } = maakSter(`${id}-${i}`);
    vak.appendChild(svg);
    el.appendChild(vak);
    sterren.push({ vak, rect });
  }

  function teken(w) {
    sterren.forEach(({ vak, rect }, i) => {
      const vulling = w == null ? 0 : Math.max(0, Math.min(1, w - i));
      rect.setAttribute('width', String(24 * vulling));
      vak.classList.toggle('is-vol', vulling > 0);
    });
  }

  function aria() {
    if (huidig == null) el.removeAttribute('aria-valuenow');
    else el.setAttribute('aria-valuenow', String(huidig));
    el.setAttribute('aria-valuetext', waardeTekst(huidig));
  }

  function zet(w) {
    huidig = w;
    teken(w);
    aria();
    onWijzig(w);
  }

  // Welke waarde hoort bij deze positie op deze ster?
  function waardeOp(event) {
    const vak = event.target.closest('.ster');
    if (!vak || !el.contains(vak)) return null;
    const i = Number(vak.dataset.ster);
    const r = vak.getBoundingClientRect();
    const half = event.clientX - r.left < r.width / 2;
    return Math.max(1, half ? i - 0.5 : i);
  }

  el.addEventListener('click', (event) => {
    const w = waardeOp(event);
    if (w == null) return;
    event.stopPropagation();
    zet(w === huidig ? null : w);
  });
  // Hover-voorbeeld (alleen met een muis).
  el.addEventListener('pointermove', (event) => {
    if (event.pointerType !== 'mouse') return;
    const w = waardeOp(event);
    if (w != null) teken(w);
  });
  el.addEventListener('pointerleave', () => teken(huidig));

  el.addEventListener('keydown', (event) => {
    const stap = { ArrowRight: 0.5, ArrowUp: 0.5, ArrowLeft: -0.5, ArrowDown: -0.5 }[event.key];
    let w;
    if (stap != null) w = huidig == null ? 1 : Math.max(1, Math.min(5, huidig + stap));
    else if (event.key === 'Home') w = 1;
    else if (event.key === 'End') w = 5;
    else if (event.key === 'Delete' || event.key === 'Backspace') w = null;
    else return;
    event.preventDefault();
    event.stopPropagation();
    if (w !== huidig) zet(w);
  });

  el.zetWaarde = (w) => {
    huidig = w;
    teken(w);
    aria();
  };
  el.zetWaarde(waarde);
  return el;
}
