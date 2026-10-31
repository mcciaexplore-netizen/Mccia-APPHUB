"use client";

import { useState } from "react";
import { Modal } from "@/components/Modal";
import { formatIST } from "@/lib/format";
import type { RideView } from "./RideCard";

/** An admin cancels a pending or assigned ride: the reason is required, and the rider (and the driver, if any) are told it. */
export function CancelRideDialog({ ride, pending, onCancel, onClose }: { ride: RideView; pending: boolean; onCancel: (reason: string) => void; onClose: () => void }) {
  const [reason, setReason] = useState("");
  return (
    <Modal title="Cancel ride" onClose={onClose}>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); onCancel(reason); }}>
        <p className="text-sm text-muted"><b className="text-ink">{ride.pickup} → {ride.dropoff}</b><br />{formatIST(ride.scheduledFor)} · {ride.requestedByName}</p>
        <label className="block"><span className="label-xs mb-1.5 block">Reason (they will be told)</span>
          <textarea className="input min-h-20" name="reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} required autoFocus /></label>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>Close</button>
          <button className="btn btn-danger btn-sm" disabled={pending || !reason.trim()}>Cancel ride</button>
        </div>
      </form>
    </Modal>
  );
}
