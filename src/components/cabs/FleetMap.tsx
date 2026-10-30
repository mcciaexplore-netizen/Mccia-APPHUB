"use client";

import { RIDE_STATUS_LABEL, type RideStatus } from "@/lib/cabs/cabs.manifest";
import { GEOAPIFY_KEY, MapBox, STALE_MS, ago, usePollingMap, type MarkerSpec } from "./PollingMap";

/** One driver on the map, as GET /api/cabs/fleet sends it. */
type FleetEntry = {
  driver_id: string; driver_name: string; latitude: number; longitude: number; heading: number | null; speed: number | null; recorded_at: string;
  current_ride_id: string | null; current_ride_status: string | null; current_ride: string | null; vehicle_plate: string | null;
};
export type FleetDriver = { id: string; name: string; isAvailable: boolean; vehiclePlate: string | null };

const statusLabel = (s: string | null) => (s && s in RIDE_STATUS_LABEL ? RIDE_STATUS_LABEL[s as RideStatus] : "No ride");

const toMarkers = (d: { drivers: FleetEntry[] }): MarkerSpec[] => d.drivers.map((e) => ({
  id: e.driver_id, lat: e.latitude, lng: e.longitude, heading: e.heading, stale: Date.now() - Date.parse(e.recorded_at) > STALE_MS, label: `${e.driver_name} · ${ago(e.recorded_at)}`,
  lines: [{ text: e.driver_name, bold: true }, { text: e.vehicle_plate ?? "No vehicle" }, { text: `${statusLabel(e.current_ride_status)}${e.current_ride ? `: ${e.current_ride}` : ""}` },
    ...(e.speed != null ? [{ text: `${Math.round(e.speed)} km/h` }] : []), { text: `Last seen ${ago(e.recorded_at)}` }],
}));

/**
 * The admins' fleet map on the dashboard: each driver's latest position, polled every 2 seconds while this tab is in view. Below it, every
 * driver with their availability and when they were last seen.
 */
export function FleetMap({ drivers }: { drivers: FleetDriver[] }) {
  const { box, data, error } = usePollingMap("/api/cabs/fleet", 2_000, toMarkers);
  const byDriver = new Map((data?.drivers ?? []).map((e) => [e.driver_id, e]));
  return (
    <section className="space-y-3" aria-label="Fleet map">
      <MapBox box={box} name="fleet" />
      {error && <p className="text-sm text-brand-red">{error}</p>}
      {!GEOAPIFY_KEY && <p className="text-xs text-subtle">Map tiles: set NEXT_PUBLIC_GEOAPIFY_API_KEY for Geoapify; until then OpenStreetMap is used.</p>}
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
