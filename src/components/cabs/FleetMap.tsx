"use client";

import { useEffect, useRef, useState } from "react";
import type { Map as LeafletMap, Marker } from "leaflet";
import { RIDE_STATUS_LABEL, type RideStatus } from "@/lib/cabs/cabs.manifest";

/** One driver on the map, as GET /api/cabs/fleet sends it. */
type FleetEntry = {
  driver_id: string; driver_name: string; latitude: number; longitude: number; heading: number | null; speed: number | null; recorded_at: string;
  current_ride_id: string | null; current_ride_status: string | null; current_ride: string | null; vehicle_plate: string | null;
};
export type FleetDriver = { id: string; name: string; isAvailable: boolean; vehiclePlate: string | null };

const PUNE: [number, number] = [18.5204, 73.8567];
const POLL_MS = 2_000;
/** A position older than this is drawn greyed out: the driver's page is probably closed or in the background. */
const STALE_MS = 2 * 60_000;
const KEY = process.env.NEXT_PUBLIC_GEOAPIFY_API_KEY ?? "";
const TILES = KEY ? `https://maps.geoapify.com/v1/tile/osm-bright/{z}/{x}/{y}.png?apiKey=${KEY}` : "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const ATTRIBUTION = KEY ? 'Powered by <a href="https://www.geoapify.com/">Geoapify</a> | © OpenStreetMap contributors' : "© OpenStreetMap contributors";

/** "just now", "3 min ago", "2 h ago". */
export function ago(iso: string, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  return m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`;
}

const statusLabel = (s: string | null) => (s && s in RIDE_STATUS_LABEL ? RIDE_STATUS_LABEL[s as RideStatus] : "No ride");

/** A car, pointing the way it is going (no image files: Leaflet's own marker images do not survive bundling). */
const carIcon = (heading: number | null, stale: boolean) =>
  `<div style="transform:rotate(${heading ?? 0}deg)" class="flex h-9 w-9 items-center justify-center rounded-full border-2 border-white ${stale ? "bg-[#94a3b8]" : "bg-[#2a6b7c]"} shadow-card">
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      ${heading != null ? '<path d="M12 2l4 6h-8z" fill="white"/>' : ""}<rect x="5" y="9" width="14" height="9" rx="2"/><circle cx="8.5" cy="18" r="1.5"/><circle cx="15.5" cy="18" r="1.5"/></svg></div>`;

/** The popup, built from elements (never HTML strings), so a name can never inject markup. */
function popup(e: FleetEntry): HTMLElement {
  const box = document.createElement("div");
  const line = (text: string, bold = false) => { const p = document.createElement("p"); p.textContent = text; p.style.margin = "2px 0"; if (bold) p.style.fontWeight = "700"; box.append(p); };
  line(e.driver_name, true);
  line(e.vehicle_plate ?? "No vehicle");
  line(`${statusLabel(e.current_ride_status)}${e.current_ride ? `: ${e.current_ride}` : ""}`);
  if (e.speed != null) line(`${Math.round(e.speed)} km/h`);
  line(`Last seen ${ago(e.recorded_at)}`);
  return box;
}

/**
 * The admins' fleet map: each driver's latest position (Leaflet with Geoapify tiles, centred on Pune), polled every 2 seconds while this
 * tab is in view and paused while it is hidden. Below it, every driver with their availability and when they were last seen.
 */
export function FleetMap({ drivers }: { drivers: FleetDriver[] }) {
  const box = useRef<HTMLDivElement>(null);
  const [fleet, setFleet] = useState<FleetEntry[]>([]);
  const [error, setError] = useState("");
  const [, tick] = useState(0); // re-renders "N min ago" between polls

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
      const draw = (list: FleetEntry[]) => {
        if (!map) return;
        const seen = new Set<string>();
        for (const e of list) {
          seen.add(e.driver_id);
          const stale = Date.now() - Date.parse(e.recorded_at) > STALE_MS;
          const icon = L.divIcon({ html: carIcon(e.heading, stale), className: "", iconSize: [36, 36], iconAnchor: [18, 18] });
          const label = `${e.driver_name} · ${ago(e.recorded_at)}`;
          const m = markers.get(e.driver_id);
          if (m) { m.setLatLng([e.latitude, e.longitude]).setIcon(icon).setPopupContent(popup(e)).setTooltipContent(label); }
          else markers.set(e.driver_id, L.marker([e.latitude, e.longitude], { icon, title: e.driver_name }).bindPopup(popup(e)).bindTooltip(label, { permanent: true, direction: "top", offset: [0, -18] }).addTo(map));
        }
        for (const [id, m] of markers) if (!seen.has(id)) { m.remove(); markers.delete(id); }
        if (!fitted && list.length) { fitted = true; map.fitBounds(L.latLngBounds(list.map((e) => [e.latitude, e.longitude] as [number, number])).pad(0.3), { maxZoom: 14 }); }
      };
      const poll = async () => {
        if (stopped) return;
        if (!document.hidden) {
          try {
            const res = await fetch("/api/cabs/fleet", { cache: "no-store" });
            if (!res.ok) throw new Error(res.status === 403 ? "Not allowed." : "Could not load the fleet.");
            const list = ((await res.json()) as { drivers: FleetEntry[] }).drivers;
            setFleet(list); setError(""); draw(list);
          } catch (e) { setError((e as Error).message); }
        }
        tick((n) => n + 1);
        timer = setTimeout(poll, POLL_MS);
      };
      // Back in view: refresh at once rather than waiting for the next turn.
      const onVisible = () => { if (!document.hidden) { clearTimeout(timer); poll(); } };
      document.addEventListener("visibilitychange", onVisible);
      poll();
      cleanupVisible = () => document.removeEventListener("visibilitychange", onVisible);
    })();
    return () => { stopped = true; clearTimeout(timer); cleanupVisible(); map?.remove(); };
  }, []);

  const byDriver = new Map(fleet.map((e) => [e.driver_id, e]));
  return (
    <section className="space-y-3" aria-label="Fleet map">
      <div ref={box} className="h-[320px] w-full overflow-hidden rounded-lg border border-line sm:h-[420px]" data-fleet-map />
      {error && <p className="text-sm text-brand-red">{error}</p>}
      {!KEY && <p className="text-xs text-subtle">Map tiles: set NEXT_PUBLIC_GEOAPIFY_API_KEY for Geoapify; until then OpenStreetMap is used.</p>}
      <div className="table-wrap"><table>
        <thead><tr><th>Driver</th><th>Vehicle</th><th>Available</th><th>Ride</th><th>Last seen</th></tr></thead>
        <tbody>
          {drivers.map((d) => {
            const e = byDriver.get(d.id);
            return (
              <tr key={d.id} data-fleet-driver={d.id}>
                <td><b>{d.name}</b></td>
                <td>{e?.vehicle_plate ?? d.vehiclePlate ?? <span className="text-subtle">—</span>}</td>
                <td>{d.isAvailable ? <span className="badge badge-green">Available</span> : <span className="badge badge-neutral">Unavailable</span>}</td>
                <td>{e?.current_ride_status ? statusLabel(e.current_ride_status) : <span className="text-subtle">—</span>}</td>
                <td className="text-xs text-muted" data-last-seen>{e ? ago(e.recorded_at) : "Not in the last 24 hours"}</td>
              </tr>
            );
          })}
          {drivers.length === 0 && <tr><td colSpan={5} className="text-subtle">No drivers yet.</td></tr>}
        </tbody>
      </table></div>
    </section>
  );
}
