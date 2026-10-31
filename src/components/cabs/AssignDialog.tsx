"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/Modal";
import { formatIST } from "@/lib/format";
import type { RideView } from "./RideCard";

export type DriverOption = { id: string; name: string };
export type VehicleOption = { id: string; numberPlate: string; model: string; capacity: number };

/**
 * Choose an available driver and an active vehicle for a pending ride: drivers have no car of their own, so every active car is offered,
 * with its seats. Drivers and cars that already have a ride within 2 hours ("Busy at this time", "In use at this time") and cars with fewer
 * seats than passengers ("Too small") can't be chosen.
 */
export function AssignDialog({ ride, drivers, vehicles, pending, onAssign, onClose }: {
  ride: RideView; drivers: DriverOption[]; vehicles: VehicleOption[]; pending: boolean; onAssign: (v: { driverId: string; vehicleId: string }) => void; onClose: () => void;
}) {
  const [driverId, setDriverId] = useState("");
  const [vehicleId, setVehicleId] = useState("");
  // Who is busy at this ride's time, asked for when the dialog opens.
  const [busy, setBusy] = useState<{ drivers: string[]; vehicles: string[] }>({ drivers: [], vehicles: [] });
  useEffect(() => {
    let live = true;
    fetch(`/api/cabs/rides/${ride.id}/conflicts`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((d) => {
      if (live && d) setBusy({ drivers: d.drivers ?? [], vehicles: d.vehicles ?? [] });
    }).catch(() => { /* the server still refuses a busy one */ });
    return () => { live = false; };
  }, [ride.id]);
  const driverBusy = (id: string) => busy.drivers.includes(id);
  const vehicleBusy = (id: string) => busy.vehicles.includes(id);
  return (
    <Modal title="Assign driver and vehicle" onClose={onClose}>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); onAssign({ driverId, vehicleId }); }}>
        <p className="text-sm text-muted"><b className="text-ink">{ride.pickup} → {ride.dropoff}</b><br />{formatIST(ride.scheduledFor)} · {ride.requestedByName} · {ride.passengers} {ride.passengers === 1 ? "passenger" : "passengers"}</p>
        <label className="block"><span className="label-xs mb-1.5 block">Driver</span>
          <select className="input" name="driverId" value={driverId} onChange={(e) => setDriverId(e.target.value)} required autoFocus>
            <option value="">Choose an available driver</option>
            {drivers.map((d) => <option key={d.id} value={d.id} disabled={driverBusy(d.id)} className={driverBusy(d.id) ? "text-brand-red" : undefined} data-busy={driverBusy(d.id) || undefined}>
              {d.name}{driverBusy(d.id) ? ": Busy at this time" : ""}</option>)}
          </select></label>
        {drivers.length === 0 && <p className="text-xs text-brand-red">No driver is available. Mark one available on the Drivers page.</p>}
        <label className="block"><span className="label-xs mb-1.5 block">Vehicle</span>
          <select className="input" name="vehicleId" value={vehicleId} onChange={(e) => setVehicleId(e.target.value)} required>
            <option value="">Choose an active vehicle</option>
            {vehicles.map((v) => {
              const small = v.capacity < ride.passengers;
              return <option key={v.id} value={v.id} disabled={small || vehicleBusy(v.id)} className={vehicleBusy(v.id) || small ? "text-brand-red" : undefined}
                data-busy={vehicleBusy(v.id) || undefined} data-small={small || undefined}>
                {v.numberPlate} · {v.model} ({v.capacity} {v.capacity === 1 ? "seat" : "seats"}){vehicleBusy(v.id) ? ": In use at this time" : small ? ": Too small" : ""}</option>;
            })}
          </select></label>
        {vehicles.length === 0 && <p className="text-xs text-brand-red">No vehicle is active. Add or reactivate one on the Vehicles page.</p>}
        {(busy.drivers.length > 0 || busy.vehicles.length > 0) && (
          <p className="text-xs font-semibold text-brand-red" data-busy-note>
            {[drivers.filter((d) => driverBusy(d.id)).map((d) => `${d.name}: Busy at this time`), vehicles.filter((v) => vehicleBusy(v.id)).map((v) => `${v.numberPlate}: In use at this time`)].flat().join(" · ")}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>Close</button>
          <button className="btn btn-primary btn-sm" disabled={pending || !driverId || !vehicleId}>Assign</button>
        </div>
      </form>
    </Modal>
  );
}
