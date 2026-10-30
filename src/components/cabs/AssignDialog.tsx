"use client";

import { useState } from "react";
import { Modal } from "@/components/Modal";
import { formatIST } from "@/lib/format";
import type { RideView } from "./RideCard";

export type DriverOption = { id: string; name: string; vehicleId: string | null };
export type VehicleOption = { id: string; numberPlate: string; model: string; capacity: number };

/** Choose an available driver and an active vehicle for a pending ride. Picking a driver offers their usual vehicle; a car with fewer seats than passengers can't be chosen. */
export function AssignDialog({ ride, drivers, vehicles, pending, onAssign, onClose }: {
  ride: RideView; drivers: DriverOption[]; vehicles: VehicleOption[]; pending: boolean; onAssign: (v: { driverId: string; vehicleId: string }) => void; onClose: () => void;
}) {
  const [driverId, setDriverId] = useState("");
  const [vehicleId, setVehicleId] = useState("");
  const pickDriver = (id: string) => {
    setDriverId(id);
    const usual = drivers.find((d) => d.id === id)?.vehicleId;
    if (usual && vehicles.some((v) => v.id === usual && v.capacity >= ride.passengers)) setVehicleId(usual);
  };
  return (
    <Modal title="Assign driver and vehicle" onClose={onClose}>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); onAssign({ driverId, vehicleId }); }}>
        <p className="text-sm text-muted"><b className="text-ink">{ride.pickup} → {ride.dropoff}</b><br />{formatIST(ride.scheduledFor)} · {ride.requestedByName} · {ride.passengers} {ride.passengers === 1 ? "passenger" : "passengers"}</p>
        <label className="block"><span className="label-xs mb-1.5 block">Driver</span>
          <select className="input" name="driverId" value={driverId} onChange={(e) => pickDriver(e.target.value)} required autoFocus>
            <option value="">Choose an available driver</option>
            {drivers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select></label>
        {drivers.length === 0 && <p className="text-xs text-brand-red">No driver is available. Mark one available on the Drivers page.</p>}
        <label className="block"><span className="label-xs mb-1.5 block">Vehicle</span>
          <select className="input" name="vehicleId" value={vehicleId} onChange={(e) => setVehicleId(e.target.value)} required>
            <option value="">Choose an active vehicle</option>
            {vehicles.map((v) => <option key={v.id} value={v.id} disabled={v.capacity < ride.passengers}>{v.numberPlate} · {v.model} ({v.capacity} seats){v.capacity < ride.passengers ? ": too small" : ""}</option>)}
          </select></label>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>Close</button>
          <button className="btn btn-primary btn-sm" disabled={pending || !driverId || !vehicleId}>Assign</button>
        </div>
      </form>
    </Modal>
  );
}
