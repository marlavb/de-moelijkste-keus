// public/data/theaters.json: per theater de gegevens die de front-end nodig
// heeft maar die niet per voorstelling in shows.json horen. config.js blijft
// de enige bron; de run schrijft dit bestand elke keer opnieuw. Bewust klein:
// alleen velden die de app gebruikt.
export function buildTheatersJson(theaters) {
  const out = {};
  for (const t of theaters) {
    out[t.id] = {
      naam: t.naam,
      stad: t.stad,
      podiumpas: t.podiumpas,
      ...(t.podiumpasReserveren ? { podiumpasReserveren: t.podiumpasReserveren } : {}),
    };
  }
  return { theaters: out };
}
