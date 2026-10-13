// Kaart bij Mijn theaters (okt 2026): Leaflet met OpenStreetMap-tegels,
// pas geladen als iemand de kaart opent (de app wordt er niet zwaarder van).
// De lijstweergave blijft het volledige alternatief. Geen geocoding hier:
// de coördinaten staan vast in config.js (met bron) en komen via
// data/theaters.json binnen.

// Leaflet 1.9.4 en Leaflet.markercluster 1.5.3 van cdnjs, met SRI. Dezelfde
// bestanden als in de npm-pakketten (devDependencies), zodat de tests ze
// lokaal kunnen serveren.
export const LEAFLET_BESTANDEN = [
  { soort: 'css', url: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.css', sri: 'sha384-sHL9NAb7lN7rfvG5lfHpm643Xkcjzp4jFvuavGOndn6pjVqS6ny56CAt3nsEVT4H' },
  { soort: 'css', url: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet.markercluster/1.5.3/MarkerCluster.css', sri: 'sha384-pmjIAcz2bAn0xukfxADbZIb3t8oRT9Sv0rvO+BR5Csr6Dhqq+nZs59P0pPKQJkEV' },
  { soort: 'js', url: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.js', sri: 'sha384-cxOPjt7s7Iz04uaHJceBmS+qpjv2JkIHNVcuOrM+YHwZOmJGBXI00mdUXEq65HTH' },
  { soort: 'js', url: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet.markercluster/1.5.3/leaflet.markercluster.js', sri: 'sha384-eXVCORTRlv4FUUgS/xmOyr66XBVraen8ATNLMESp92FKXLAMiKkerixTiBvXriZr' },
];

export const TEGELS = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
export const BRONVERMELDING = '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

/**
 * Wat de kaart per theater toont: alleen theaters met coördinaten. `aan` =
 * in Mijn theaters (geen keuze = aan, zoals de lijst), `aantal` = komende
 * speeldata (vanaf `vandaag`), `actief` = er zijn voorstellingen en het
 * theater is niet gepauzeerd (anders lichter op de kaart).
 */
export function kaartTheaters(theaterInfo, shows, enabled, vandaag) {
  const aantal = new Map();
  for (const s of shows ?? []) if (s.datum >= vandaag) aantal.set(s.theaterId, (aantal.get(s.theaterId) ?? 0) + 1);
  return Object.entries(theaterInfo ?? {})
    .filter(([, t]) => Number.isFinite(t.lat) && Number.isFinite(t.lng))
    .map(([id, t]) => {
      const n = aantal.get(id) ?? 0;
      return { id, naam: t.naam, stad: t.stad, lat: t.lat, lng: t.lng, aan: enabled?.[id] !== false, aantal: n, actief: n > 0 && !t.gepauzeerd, gepauzeerd: Boolean(t.gepauzeerd) };
    })
    .sort((a, b) => a.naam.localeCompare(b.naam, 'nl'));
}

/** "12 komende voorstellingen", "1 komende voorstelling", "Geen komende voorstellingen". */
export function aantalTekst(n) {
  if (!n) return 'Geen komende voorstellingen';
  return `${n} komende voorstelling${n === 1 ? '' : 'en'}`;
}

let laden = null;

/** Leaflet en de clusterplugin één keer laden (CSS en JS, met SRI). */
export function laadLeaflet(doc = document) {
  if (globalThis.L?.markerClusterGroup) return Promise.resolve(globalThis.L);
  if (laden) return laden;
  const voeg = ({ soort, url, sri }) =>
    new Promise((klaar, fout) => {
      const el = doc.createElement(soort === 'css' ? 'link' : 'script');
      if (soort === 'css') {
        el.rel = 'stylesheet';
        el.href = url;
      } else {
        el.src = url;
        el.async = false; // volgorde: eerst Leaflet, dan de plugin
      }
      el.integrity = sri;
      el.crossOrigin = 'anonymous';
      el.referrerPolicy = 'no-referrer';
      el.onload = () => klaar();
      el.onerror = () => fout(new Error(`kon ${url} niet laden`));
      doc.head.appendChild(el);
    });
  laden = Promise.all(LEAFLET_BESTANDEN.map(voeg))
    .then(() => globalThis.L)
    .catch((err) => {
      laden = null; // later opnieuw proberen kan
      throw err;
    });
  return laden;
}
