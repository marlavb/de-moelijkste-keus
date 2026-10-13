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
      ...(t.melding ? { melding: t.melding } : {}),
      // Kaart bij Mijn theaters (okt 2026): de plek, zonder bron (die staat in config.js).
      ...(t.locatie ? { lat: t.locatie.lat, lng: t.locatie.lng } : {}),
      ...(t.gepauzeerd ? { gepauzeerd: true } : {}),
      // Gepauzeerd theater: standaardmelding met een link naar hun eigen agenda.
      ...(t.gepauzeerd && !t.melding
        ? { melding: 'Agenda tijdelijk niet beschikbaar. Bekijk de voorstellingen op de website van het theater.', meldingLink: t.agendaUrl }
        : {}),
    };
  }
  return { theaters: out };
}
