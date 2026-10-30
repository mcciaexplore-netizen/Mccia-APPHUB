"use client";

import { useEffect, useRef, useState } from "react";
import type { Map as LeafletMap, Marker } from "leaflet";

/**
 * The Cab Booking maps (the dashboard's fleet map, Live Trips): Leaflet with Geoapify tiles, centred on Pune, loaded only in the browser,
 * fed by polling an /api/cabs route while the tab is in view (paused while it is hidden, refreshed at once when it comes back).
 */

const PUNE: [number, number] = [18.5204, 73.8567];
/** A position older than this is drawn greyed out: the driver's page is probably closed or in the background. */
export const STALE_MS = 2 * 60_000;
export const GEOAPIFY_KEY = process.env.NEXT_PUBLIC_GEOAPIFY_API_KEY ?? "";
const TILES = GEOAPIFY_KEY ? `https://maps.geoapify.com/v1/tile/osm-bright/{z}/{x}/{y}.png?apiKey=${GEOAPIFY_KEY}` : "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const ATTRIBUTION = GEOAPIFY_KEY ? 'Powered by <a href="https://www.geoapify.com/">Geoapify</a> | © OpenStreetMap contributors' : "© OpenStreetMap contributors";

/** "just now", "3 min ago", "2 h ago". */
export function ago(iso: string, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  return m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`;
}

/** One marker: where, which way it is heading, whether its position is stale, its label, and its popup lines (text only, never HTML). */
export type MarkerSpec = { id: string; lat: number; lng: number; heading: number | null; stale: boolean; label: string; lines: { text: string; bold?: boolean }[] };

/** A car, pointing the way it is going (no image files: Leaflet's own marker images do not survive bundling). */
const carIcon = (heading: number | null, stale: boolean) =>
  `<div style="transform:rotate(${heading ?? 0}deg)" class="flex h-9 w-9 items-center justify-center rounded-full border-2 border-white ${stale ? "bg-[#94a3b8]" : "bg-[#2a6b7c]"} shadow-card">
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      ${heading != null ? '<path d="M12 2l4 6h-8z" fill="white"/>' : ""}<rect x="5" y="9" width="14" height="9" rx="2"/><circle cx="8.5" cy="18" r="1.5"/><circle cx="15.5" cy="18" r="1.5"/></svg></div>`;

/** The popup, built from elements, so a name can never inject markup. */
function popup(lines: MarkerSpec["lines"]): HTMLElement {
  const box = document.createElement("div");
  for (const l of lines) { const p = document.createElement("p"); p.textContent = l.text; p.style.margin = "2px 0"; if (l.bold) p.style.fontWeight = "700"; box.append(p); }
  return box;
}

/**
 * Polls `url` every `everyMs` (while the tab is in view) and draws `toMarkers(data)` on a map in the returned box. Returns the latest data
 * and any error for the list beside the map.
 */
export function usePollingMap<T>(url: string, everyMs: number, toMarkers: (data: T) => MarkerSpec[]) {
  const box = useRef<HTMLDivElement>(null);
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const [, tick] = useState(0); // re-renders "N min ago" between polls
  const markersOf = useRef(toMarkers);
  useEffect(() => { markersOf.current = toMarkers; }, [toMarkers]);

  useEffect(() => {
    let map: LeafletMap | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    let fitted = false;
    const markers = new Map<string, Marker>();
    let cleanupVisible = () => {};
    (async () => {
      const L = await import("leaflet");
      if (stopped || !box.current) return;
      map = L.map(box.current, { zoomControl: true }).setView(PUNE, 12);
      L.tileLayer(TILES, { attribution: ATTRIBUTION, maxZoom: 20 }).addTo(map);
      const draw = (specs: MarkerSpec[]) => {
        if (!map) return;
        const seen = new Set<string>();
        for (const m of specs) {
          seen.add(m.id);
          const icon = L.divIcon({ html: carIcon(m.heading, m.stale), className: "", iconSize: [36, 36], iconAnchor: [18, 18] });
          const existing = markers.get(m.id);
          if (existing) existing.setLatLng([m.lat, m.lng]).setIcon(icon).setPopupContent(popup(m.lines)).setTooltipContent(m.label);
          else markers.set(m.id, L.marker([m.lat, m.lng], { icon, title: m.label }).bindPopup(popup(m.lines)).bindTooltip(m.label, { permanent: true, direction: "top", offset: [0, -18] }).addTo(map));
        }
        for (const [id, mk] of markers) if (!seen.has(id)) { mk.remove(); markers.delete(id); }
        if (!fitted && specs.length) { fitted = true; map.fitBounds(L.latLngBounds(specs.map((m) => [m.lat, m.lng] as [number, number])).pad(0.3), { maxZoom: 14 }); }
      };
      const poll = async () => {
        if (stopped) return;
        if (!document.hidden) {
          try {
            const res = await fetch(url, { cache: "no-store" });
            if (!res.ok) throw new Error(res.status === 403 ? "Not allowed." : "Could not load the map.");
            const next = (await res.json()) as T;
            setData(next); setError(""); draw(markersOf.current(next));
          } catch (e) { setError((e as Error).message); }
        }
        tick((n) => n + 1);
        timer = setTimeout(poll, everyMs);
      };
      const onVisible = () => { if (!document.hidden) { clearTimeout(timer); poll(); } };
      document.addEventListener("visibilitychange", onVisible);
      cleanupVisible = () => document.removeEventListener("visibilitychange", onVisible);
      poll();
    })();
    return () => { stopped = true; clearTimeout(timer); cleanupVisible(); map?.remove(); };
  }, [url, everyMs]);

  return { box, data, error };
}

/** The map's box. */
export const MapBox = ({ box, name }: { box: React.RefObject<HTMLDivElement | null>; name: string }) => (
  <div ref={box} className="h-[320px] w-full overflow-hidden rounded-lg border border-line sm:h-[420px]" data-map={name} data-fleet-map={name === "fleet" ? "" : undefined} />
);
