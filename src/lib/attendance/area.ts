import "server-only";

/**
 * The area a remote punch was made in ("Kothrud, Pune"), for the check-in card and HR, from OpenStreetMap's Photon service (the same free
 * service the hub's cab booking uses), asked from the server. Only remote punches are looked up, the position is rounded to about 100 m
 * before it is sent, and the lookup gives up after 2.5 s: a punch never waits longer or fails because of it (no area is then shown).
 * ATT_AREA_LOOKUP=false turns it off.
 */

import { areaName, type PhotonProps } from "./checkin-rules";

const AGENT = "MCCIA-AppHub/1.0 (attendance area name; mcciapune.com)";

export async function areaAt(lat: number, lng: number): Promise<string | null> {
  if (process.env.ATT_AREA_LOOKUP === "false") return null;
  try {
    const q = new URLSearchParams({ lat: lat.toFixed(3), lon: lng.toFixed(3), lang: "en" });
    const res = await fetch(`https://photon.komoot.io/reverse?${q}`, { headers: { "User-Agent": AGENT, Accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(2500) });
    if (!res.ok) return null;
    const data = (await res.json()) as { features?: { properties?: PhotonProps }[] };
    const props = data.features?.[0]?.properties;
    return props ? areaName(props) : null;
  } catch {
    return null;
  }
}
