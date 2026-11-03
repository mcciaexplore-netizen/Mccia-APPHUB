/**
 * Finding places and the person's position, for the browser: the hub's own address search first (/api/cabs/places: Photon, Pune first,
 * and Nominatim on Enter; see src/lib/cabs/places.ts), then Geoapify when its key is set and it answers, otherwise OpenStreetMap's free
 * Nominatim straight from the browser. Nominatim's rules allow at most one request a second and no search-as-you-type, so it is only asked when the person presses
 * Enter (or taps "Use my location"), and calls are spaced a second apart. (A browser cannot set its own User-Agent header; Nominatim
 * identifies the site by the Referer the browser sends.)
 */

export const GEOAPIFY_KEY = process.env.NEXT_PUBLIC_GEOAPIFY_API_KEY ?? "";
/** A place to choose: `main` and `secondary` (its name and area) when the search gives them, shown on two lines. */
export type Found = { text: string; lat: number; lng: number; main?: string; secondary?: string };

/**
 * The hub's address search: as the person types, or (`thorough`, on Enter) also asking Nominatim. Throws when it cannot answer, so the
 * caller falls back to another search.
 */
export async function hubSearch(q: string, thorough: boolean, signal?: AbortSignal): Promise<Found[]> {
  const res = await fetch(`/api/cabs/places?${new URLSearchParams(thorough ? { q, more: "1" } : { q })}`, { signal, cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const { places } = (await res.json()) as { places: { name: string; area: string; kind: string; lat: number; lng: number }[] };
  return places.map((p) => ({
    text: [p.name, p.area].filter(Boolean).join(", "),
    lat: p.lat,
    lng: p.lng,
    main: p.name,
    secondary: [p.kind, p.area].filter(Boolean).join(" · "),
  }));
}

/** The message for a GPS failure, by the browser's error code. */
export function gpsErrorMessage(code: number): string {
  if (code === 1) return "Please allow location access in your browser settings";
  if (code === 3) return "Location request timed out. Please try again.";
  return "Unable to get your location. Please try again.";
}

/** Suggestions as the person types (Geoapify only): India, nearest Pune first. Throws when Geoapify cannot be used, so the caller falls back. */
export async function geoapifySuggest(q: string, signal: AbortSignal): Promise<Found[]> {
  if (!GEOAPIFY_KEY) throw new Error("NEXT_PUBLIC_GEOAPIFY_API_KEY was not set when this site was built");
  const p = new URLSearchParams({ text: q, apiKey: GEOAPIFY_KEY, filter: "countrycode:in", bias: "proximity:73.8567,18.5204", limit: "6", format: "geojson" });
  const res = await fetch(`https://api.geoapify.com/v1/geocode/autocomplete?${p}`, { signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}${res.status === 401 || res.status === 403 ? ": the key was refused (wrong key, or this site is not allowed for it in Geoapify)" : ""}`);
  const data = (await res.json()) as { features?: { properties: { formatted: string; lat: number; lon: number } }[] };
  return (data.features ?? []).map((f) => ({ text: f.properties.formatted, lat: f.properties.lat, lng: f.properties.lon }));
}

let lastNominatim = 0;
/** Waits so Nominatim is never asked more than once a second from this page. */
async function nominatimTurn() {
  const wait = lastNominatim + 1_000 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastNominatim = Date.now();
}

/** One search (on Enter, when the hub's own search is not answering): India, kept to Pune and Pimpri-Chinchwad. */
export async function nominatimSearch(q: string): Promise<Found[]> {
  await nominatimTurn();
  const p = new URLSearchParams({ q, format: "json", countrycodes: "in", viewbox: "73.7,18.35,74.05,18.7", bounded: "1", limit: "6" });
  const res = await fetch(`https://nominatim.openstreetmap.org/search?${p}`, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`nominatim ${res.status}`);
  return ((await res.json()) as { display_name: string; lat: string; lon: string }[]).map((r) => ({ text: r.display_name, lat: Number(r.lat), lng: Number(r.lon) }));
}

/** The address at a position: the hub's search, else Geoapify, else Nominatim, else null (the caller shows the coordinates). */
export async function reverseGeocode(lat: number, lng: number): Promise<string | null> {
  try {
    const res = await fetch(`/api/cabs/places?${new URLSearchParams({ lat: String(lat), lng: String(lng) })}`, { cache: "no-store" });
    const address = res.ok ? ((await res.json()) as { address: string | null }).address : null;
    if (address) return address;
  } catch { /* try the others */ }
  if (GEOAPIFY_KEY) {
    try {
      const res = await fetch(`https://api.geoapify.com/v1/geocode/reverse?${new URLSearchParams({ lat: String(lat), lon: String(lng), apiKey: GEOAPIFY_KEY, format: "geojson" })}`);
      if (res.ok) {
        const text = ((await res.json()) as { features?: { properties: { formatted: string } }[] }).features?.[0]?.properties.formatted;
        if (text) return text;
      }
    } catch { /* try Nominatim */ }
  }
  try {
    await nominatimTurn();
    const res = await fetch(`https://nominatim.openstreetmap.org/reverse?${new URLSearchParams({ lat: String(lat), lon: String(lng), format: "json" })}`, { headers: { Accept: "application/json" } });
    if (res.ok) return ((await res.json()) as { display_name?: string }).display_name ?? null;
  } catch { /* no address: the coordinates will do */ }
  return null;
}
