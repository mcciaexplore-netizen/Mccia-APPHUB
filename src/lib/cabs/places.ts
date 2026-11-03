import "server-only";

/**
 * Address search for the booking form, with free OpenStreetMap services only, asked from the server (so the browser needs no outside
 * address, and the services see one well-identified caller):
 *   - Photon (photon.komoot.io), made for search-as-you-type: Pune and Pimpri-Chinchwad first, then Maharashtra, then India, always biased
 *     to Pune's centre;
 *   - Nominatim (nominatim.openstreetmap.org), only for a deliberate search (Enter), inside the Pune box: its rules forbid search-as-you-type
 *     and allow one request a second, which is kept to here.
 * A few well-known Pune places come first under the names people use (OpenStreetMap names some differently: Phoenix Marketcity is
 * "Phoenix Avenue of Stars" there). Results are merged, the same place found twice (by name within 300 m, or within 30 m) kept once, and
 * the best six shown.
 */

export type Place = { name: string; area: string; kind: string; lat: number; lng: number };

const PUNE_CENTRE = { lat: 18.5204, lng: 73.8567 };
// west, south, east, north
const PUNE_BOX = [73.7, 18.35, 74.05, 18.7] as const;
const MAHARASHTRA_BOX = [72.6, 15.6, 80.9, 22.1] as const;
const MAX_RESULTS = 6;
const AGENT = "MCCIA-AppHub/1.0 (cab booking address search; mcciapune.com)";

/** Well-known places, under the names people search for, at OpenStreetMap's own positions. */
const LANDMARKS: (Place & { words: string[] })[] = [
  { name: "Phoenix Marketcity", area: "Viman Nagar Road, Viman Nagar, Pune", kind: "Mall", lat: 18.562, lng: 73.9167, words: ["phoenix", "marketcity", "market city"] },
  { name: "Pune International Airport", area: "Airport Road, Lohegaon, Pune", kind: "Airport", lat: 18.5804, lng: 73.9182, words: ["airport", "lohegaon airport", "pune airport"] },
  { name: "Pune Railway Station", area: "Raja Bahadur Mill Road, Pune", kind: "Railway station", lat: 18.5298, lng: 73.8724, words: ["pune station", "railway station", "pune railway"] },
  { name: "Hinjewadi Phase 1", area: "Rajiv Gandhi Infotech Park, Hinjewadi, Pune", kind: "IT park", lat: 18.5863, lng: 73.7386, words: ["hinjewadi phase 1", "hinjawadi phase 1", "hinjewadi phase i", "rajiv gandhi infotech park"] },
];

const KIND: Record<string, string> = {
  mall: "Mall", supermarket: "Shop", station: "Station", aerodrome: "Airport", university: "University", college: "College", school: "School",
  hospital: "Hospital", hotel: "Hotel", office: "Office", company: "Office", suburb: "Area", neighbourhood: "Area", city: "City", town: "Town",
  village: "Village", residential: "Residential", commercial: "Commercial", industrial: "Industrial", restaurant: "Restaurant",
};
const kindOf = (key?: string, value?: string): string => {
  if (key === "highway") return "Road";
  return (value && KIND[value]) || (value ? value.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()) : "");
};

const metres = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
  const r = Math.PI / 180;
  const x = (b.lng - a.lng) * r * Math.cos(((a.lat + b.lat) / 2) * r);
  const y = (b.lat - a.lat) * r;
  return Math.sqrt(x * x + y * y) * 6_371_000;
};
const inPune = (p: { lat: number; lng: number }) => p.lng >= PUNE_BOX[0] && p.lng <= PUNE_BOX[2] && p.lat >= PUNE_BOX[1] && p.lat <= PUNE_BOX[3];

/** The same place found twice (the same name within 300 m, or anything within 30 m) is kept once, in the order first found. */
export function mergePlaces(lists: Place[][]): Place[] {
  const out: Place[] = [];
  for (const p of lists.flat()) {
    if (!p.name) continue;
    if (out.some((q) => metres(p, q) < 30 || (q.name.toLowerCase() === p.name.toLowerCase() && metres(p, q) < 300))) continue;
    out.push(p);
  }
  return out;
}

/** The well-known places whose words are in what was typed (or that start with it, for three letters or more). */
export function landmarksFor(q: string): Place[] {
  const t = q.toLowerCase().replace(/\s+/g, " ").trim();
  if (t.length < 3) return [];
  return LANDMARKS.filter((l) => l.words.some((w) => t.includes(w) || w.startsWith(t)) || l.name.toLowerCase().startsWith(t)).map(({ words, ...p }) => { void words; return p; });
}

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, { headers: { "User-Agent": AGENT, Accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(6000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

type PhotonFeature = { geometry: { coordinates: [number, number] }; properties: Record<string, string | undefined> };

/** A Photon place as name + area: "Phoenix Avenue of Stars" / "Viman Nagar Road, Ward 12, Pune". */
export function fromPhoton(f: PhotonFeature): Place {
  const p = f.properties;
  const [lng, lat] = f.geometry.coordinates;
  const name = p.name || [p.housenumber, p.street].filter(Boolean).join(" ") || p.city || "";
  const area = [p.street !== name ? p.street : undefined, p.district, p.locality, p.city ?? p.county, p.city ? undefined : p.state]
    .filter((x, i, all): x is string => !!x && x !== name && all.indexOf(x) === i)
    .join(", ");
  return { name, area, kind: kindOf(p.osm_key, p.osm_value), lat, lng };
}

async function photon(q: string, box: readonly number[] | null): Promise<Place[]> {
  const p = new URLSearchParams({ q, lat: String(PUNE_CENTRE.lat), lon: String(PUNE_CENTRE.lng), limit: "10", lang: "en" });
  if (box) p.set("bbox", box.join(","));
  const data = (await getJson(`https://photon.komoot.io/api/?${p}`)) as { features?: PhotonFeature[] };
  const found = (data.features ?? []).map(fromPhoton);
  // Without a box (all of India) Photon can still answer from abroad: keep India, by its country code.
  return box ? found : found.filter((_, i) => (data.features?.[i]?.properties.countrycode ?? "IN").toUpperCase() === "IN");
}

let lastNominatim = 0;
/** Nominatim's rules: at most one request a second (from this server). */
async function nominatimTurn() {
  const wait = lastNominatim + 1_100 - Date.now();
  lastNominatim = Math.max(Date.now(), lastNominatim + 1_100);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
}

type NominatimResult = { lat: string; lon: string; name?: string; display_name: string; class?: string; type?: string; address?: Record<string, string> };

async function nominatim(q: string): Promise<Place[]> {
  await nominatimTurn();
  const p = new URLSearchParams({ q, format: "jsonv2", countrycodes: "in", viewbox: PUNE_BOX.join(","), bounded: "1", limit: "8", addressdetails: "1", "accept-language": "en" });
  const rows = (await getJson(`https://nominatim.openstreetmap.org/search?${p}`)) as NominatimResult[];
  return rows.map((r) => {
    const a = r.address ?? {};
    const name = r.name || r.display_name.split(",")[0];
    const area = [a.road, a.suburb ?? a.neighbourhood, a.city ?? a.town ?? a.county].filter((x, i, all): x is string => !!x && x !== name && all.indexOf(x) === i).join(", ");
    return { name, area, kind: kindOf(r.class, r.type), lat: Number(r.lat), lng: Number(r.lon) };
  });
}

/**
 * Suggestions for what has been typed: well-known places, then Photon in Pune (else Maharashtra, else India). `thorough` (the person
 * pressed Enter) also asks Nominatim in Pune. A service that fails is left out; only when everything fails does this throw.
 */
export async function searchPlaces(q: string, thorough = false): Promise<Place[]> {
  const lists: Place[][] = [landmarksFor(q)];
  let failures = 0;
  const attempt = async (f: () => Promise<Place[]>) => {
    try {
      return await f();
    } catch {
      failures++;
      return [];
    }
  };
  const [pune, extra] = await Promise.all([attempt(() => photon(q, PUNE_BOX)), thorough ? attempt(() => nominatim(q)) : Promise.resolve([])]);
  lists.push(pune, extra);
  if (!pune.length && !extra.length) {
    const state = await attempt(() => photon(q, MAHARASHTRA_BOX));
    lists.push(state.length ? state : await attempt(() => photon(q, null)));
  }
  const merged = mergePlaces(lists);
  if (!merged.length && failures && failures >= (thorough ? 2 : 1)) throw new Error("address search is not reachable");
  // Pune first among what was found (a wider search only runs when Pune had nothing, but Nominatim and Photon can disagree).
  return merged.sort((a, b) => Number(inPune(b)) - Number(inPune(a))).slice(0, MAX_RESULTS);
}

/** The address at a position ("Use my location"), from Photon, or null. */
export async function addressAt(lat: number, lng: number): Promise<string | null> {
  try {
    const data = (await getJson(`https://photon.komoot.io/reverse?${new URLSearchParams({ lat: String(lat), lon: String(lng), lang: "en" })}`)) as { features?: PhotonFeature[] };
    const f = data.features?.[0];
    if (!f) return null;
    const p = fromPhoton(f);
    return [p.name, p.area].filter(Boolean).join(", ") || null;
  } catch {
    return null;
  }
}
