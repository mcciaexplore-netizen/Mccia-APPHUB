"use client";

import { useEffect, useRef, useState } from "react";
import type { Map as LeafletMap, Marker } from "leaflet";

/**
 * The Cab Booking maps (the dashboard's fleet map, Live Trips): Leaflet, centred on Pune, loaded only in the browser, fed by polling an
 * /api/cabs route while the tab is in view (paused while it is hidden, refreshed at once when it comes back). The map fits itself to the
 * markers whenever the set of them changes (a driver appears or goes), and otherwise leaves the view where the person put it.
 */

const PUNE: [number, number] = [18.5204, 73.8567];
const ZOOM = 13;
/** A position older than this is drawn greyed out: the driver's page is probably closed or in the background. */
export const STALE_MS = 2 * 60_000;
export const GEOAPIFY_KEY = process.env.NEXT_PUBLIC_GEOAPIFY_API_KEY ?? "";

/**
 * Map tiles, in order of preference: Geoapify (when its key is set), OpenStreetMap, then CARTO's Positron. When a provider's first tiles
 * fail (several errors before any tile loads), the next one takes over. OpenStreetMap's tiles have one address now (its a/b/c subdomains
 * are no longer recommended).
 */
export const TILE_PROVIDERS = [
  ...(GEOAPIFY_KEY ? [{ name: "Geoapify", url: `https://maps.geoapify.com/v1/tile/osm-bright/{z}/{x}/{y}.png?apiKey=${GEOAPIFY_KEY}`, attribution: 'Powered by <a href="https://www.geoapify.com/">Geoapify</a> | © OpenStreetMap contributors', subdomains: "" }] : []),
  { name: "OpenStreetMap", url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png", attribution: "© OpenStreetMap contributors", subdomains: "" },
  { name: "CARTO", url: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", attribution: "© OpenStreetMap © CARTO", subdomains: "abcd" },
];
/** Tile errors, before any tile has loaded, that make the map move on to the next provider. */
const FAILS_BEFORE_SWITCH = 4;

/** "just now", "3 min ago", "2 h ago". */
export function ago(iso: string, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  return m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`;
}

/**
 * One marker: where, which way it is heading, whether its position is stale, its label, and its popup lines (text only, never HTML).
 * `kind`: a car (a driver's position, the default) or a pin (a ride's pickup, while its driver's position is not known).
 */
export type MarkerSpec = { id: string; lat: number; lng: number; heading: number | null; stale: boolean; label: string; lines: { text: string; bold?: boolean }[]; kind?: "car" | "pickup" };

/** A car, pointing the way it is going (no image files: Leaflet's own marker images do not survive bundling). */
const carIcon = (heading: number | null, stale: boolean) =>
  `<div style="transform:rotate(${heading ?? 0}deg)" class="flex h-9 w-9 items-center justify-center rounded-full border-2 border-white ${stale ? "bg-[#94a3b8]" : "bg-[#2a6b7c]"} shadow-card">
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      ${heading != null ? '<path d="M12 2l4 6h-8z" fill="white"/>' : ""}<rect x="5" y="9" width="14" height="9" rx="2"/><circle cx="8.5" cy="18" r="1.5"/><circle cx="15.5" cy="18" r="1.5"/></svg></div>`;

/** A pickup point: a navy pin. */
const pinIcon = () =>
  `<div class="flex h-9 w-9 items-center justify-center rounded-full border-2 border-white bg-[#1a2b4a] shadow-card">
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg></div>`;

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
  const [tiles, setTiles] = useState(TILE_PROVIDERS[0].name);
  const [, tick] = useState(0); // re-renders "N min ago" between polls
  const markersOf = useRef(toMarkers);
  useEffect(() => { markersOf.current = toMarkers; }, [toMarkers]);

  useEffect(() => {
    let map: LeafletMap | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    let fittedFor = "";
    const markers = new Map<string, Marker>();
    let cleanupVisible = () => {};
    (async () => {
      const L = await import("leaflet");
      if (stopped || !box.current) return;
      map = L.map(box.current, { zoomControl: true }).setView(PUNE, ZOOM);
      // The tile providers in turn: the next one when the current one's first tiles all fail.
      const showTiles = (i: number) => {
        if (!map) return;
        const p = TILE_PROVIDERS[i];
        let loaded = 0, failed = 0;
        const layer = L.tileLayer(p.url, { attribution: p.attribution, maxZoom: 19, ...(p.subdomains ? { subdomains: p.subdomains } : {}) });
        layer.on("tileload", () => { loaded++; });
        layer.on("tileerror", () => {
          if (loaded === 0 && ++failed >= FAILS_BEFORE_SWITCH && i + 1 < TILE_PROVIDERS.length && map) { map.removeLayer(layer); showTiles(i + 1); }
        });
        layer.addTo(map);
        setTiles(p.name);
      };
      showTiles(0);
      const draw = (specs: MarkerSpec[]) => {
        if (!map) return;
        const seen = new Set<string>();
        for (const m of specs) {
          seen.add(m.id);
          const icon = L.divIcon({ html: m.kind === "pickup" ? pinIcon() : carIcon(m.heading, m.stale), className: "", iconSize: [36, 36], iconAnchor: [18, 18] });
          const existing = markers.get(m.id);
          if (existing) existing.setLatLng([m.lat, m.lng]).setIcon(icon).setPopupContent(popup(m.lines)).setTooltipContent(m.label);
          else markers.set(m.id, L.marker([m.lat, m.lng], { icon, title: m.label }).bindPopup(popup(m.lines)).bindTooltip(m.label, { permanent: true, direction: "top", offset: [0, -18] }).addTo(map));
        }
        for (const [id, mk] of markers) if (!seen.has(id)) { mk.remove(); markers.delete(id); }
        // Fit to the markers when the set of them changes (one marker: centred on it); otherwise leave the view where the person put it.
        const ids = specs.map((m) => m.id).sort().join(",");
        if (specs.length && ids !== fittedFor) {
          fittedFor = ids;
          if (specs.length === 1) map.setView([specs[0].lat, specs[0].lng], Math.max(map.getZoom(), 15));
          else map.fitBounds(L.latLngBounds(specs.map((m) => [m.lat, m.lng] as [number, number])).pad(0.3), { maxZoom: 15 });
        }
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

  return { box, data, error, tiles };
}

/** The map's box. */
export const MapBox = ({ box, name }: { box: React.RefObject<HTMLDivElement | null>; name: string }) => (
  <div ref={box} className="h-[320px] w-full overflow-hidden rounded-lg border border-line sm:h-[420px]" data-map={name} data-fleet-map={name === "fleet" ? "" : undefined} />
);
