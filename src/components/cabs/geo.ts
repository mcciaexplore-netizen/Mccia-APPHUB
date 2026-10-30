/**
 * Finding places and the person's position, for the browser: Geoapify when its key is set and it answers, otherwise OpenStreetMap's free
 * Nominatim. Nominatim's rules allow at most one request a second and no search-as-you-type, so it is only asked when the person presses
 * Enter (or taps "Use my location"), and calls are spaced a second apart. (A browser cannot set its own User-Agent header; Nominatim
 * identifies the site by the Referer the browser sends.)
 */

export const GEOAPIFY_KEY = process.env.NEXT_PUBLIC_GEOAPIFY_API_KEY ?? "";
export type Found = { text: string; lat: number; lng: number };

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

/** One search (on Enter): India, kept to the Pune area of Maharashtra. */
export async function nominatimSearch(q: string): Promise<Found[]> {
  await nominatimTurn();
  const p = new URLSearchParams({ q, format: "json", countrycodes: "in", viewbox: "72.6,17.8,74.8,19.5", bounded: "1", limit: "6" });
  const res = await fetch(`https://nominatim.openstreetmap.org/search?${p}`, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`nominatim ${res.status}`);
  return ((await res.json()) as { display_name: string; lat: string; lon: string }[]).map((r) => ({ text: r.display_name, lat: Number(r.lat), lng: Number(r.lon) }));
}

/** The address at a position: Geoapify, else Nominatim, else null (the caller shows the coordinates). */
export async function reverseGeocode(lat: number, lng: number): Promise<string | null> {
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
