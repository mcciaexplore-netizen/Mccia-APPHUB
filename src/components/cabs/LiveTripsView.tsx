"use client";

import { formatIST } from "@/lib/format";
import { MapBox, STALE_MS, ago, usePollingMap, type MarkerSpec } from "./PollingMap";

/** A ride in progress, as GET /api/cabs/live sends it. */
type LiveTrip = {
  ride_id: string; driver_name: string | null; rider_name: string; pickup: string; dropoff: string; started_at: string | null; vehicle_plate: string | null;
  pickup_lat: number | null; pickup_lng: number | null;
  latitude: number | null; longitude: number | null; heading: number | null; speed: number | null; recorded_at: string | null;
};

/** How long a ride has been going: "12 min", "1 h 5 min". */
export function underWay(startedAt: string | null, now = Date.now()): string {
  if (!startedAt) return "—";
  const m = Math.max(0, Math.round((now - Date.parse(startedAt)) / 60_000));
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
}

/** Each trip on the map: its driver's car where the phone last was, or, while there is no position yet, a pin at the pickup. */
const toMarkers = (d: { trips: LiveTrip[] }): MarkerSpec[] => d.trips.flatMap((t): MarkerSpec[] => {
  if (t.latitude != null && t.longitude != null) return [carMarker(t)];
  if (t.pickup_lat != null && t.pickup_lng != null) {
    return [{ id: t.ride_id, kind: "pickup", lat: t.pickup_lat, lng: t.pickup_lng, heading: null, stale: true, label: `${t.driver_name ?? "Driver"} · pickup`,
      lines: [{ text: t.driver_name ?? "Driver", bold: true }, { text: `Rider: ${t.rider_name}` }, { text: `${t.pickup} → ${t.dropoff}` }, { text: "No position yet: shown at the pickup" }] }];
  }
  return [];
});

const carMarker = (t: LiveTrip): MarkerSpec => ({
  id: t.ride_id, kind: "car", lat: t.latitude!, lng: t.longitude!, heading: t.heading, stale: !t.recorded_at || Date.now() - Date.parse(t.recorded_at) > STALE_MS,
  label: `${t.driver_name ?? "Driver"} · ${underWay(t.started_at)}`,
  lines: [{ text: t.driver_name ?? "Driver", bold: true }, { text: `Rider: ${t.rider_name}` }, { text: `${t.pickup} → ${t.dropoff}` }, { text: `Going for ${underWay(t.started_at)}` },
    ...(t.vehicle_plate ? [{ text: t.vehicle_plate }] : []), { text: t.recorded_at ? `Last seen ${ago(t.recorded_at)}` : "No position yet" }],
});

/** Every ride in progress on the map (refreshed every 5 seconds while the tab is in view), and as a list below. */
export function LiveTripsView() {
  const { box, data, error } = usePollingMap("/api/cabs/live", 5_000, toMarkers);
  const trips = data?.trips ?? [];
  return (
    <section className="space-y-3" aria-label="Live trips">
      <MapBox box={box} name="live" />
      {error && <p className="text-sm text-brand-red">{error}</p>}
      <div className="table-wrap"><table>
        <thead><tr><th>Driver</th><th>Rider</th><th>Route</th><th>Started</th><th>Going for</th><th>Last seen</th></tr></thead>
        <tbody>
          {trips.map((t) => (
            <tr key={t.ride_id} data-live-ride={t.ride_id}>
              <td><b>{t.driver_name ?? "—"}</b>{t.vehicle_plate && <span className="block text-xs text-subtle">{t.vehicle_plate}</span>}</td>
              <td>{t.rider_name}</td>
              <td>{t.pickup} → {t.dropoff}</td>
              <td className="whitespace-nowrap text-xs text-muted">{t.started_at ? formatIST(t.started_at) : "—"}</td>
              <td>{underWay(t.started_at)}</td>
              <td className="text-xs text-muted">{t.recorded_at ? ago(t.recorded_at) : "No position yet"}</td>
            </tr>
          ))}
          {data && trips.length === 0 && <tr><td colSpan={6} className="text-subtle">No ride is in progress.</td></tr>}
          {!data && !error && <tr><td colSpan={6} className="text-subtle">Loading…</td></tr>}
        </tbody>
      </table></div>
    </section>
  );
}
