import { ArrowRight, CalendarClock, Car, UserRound } from "lucide-react";
import { formatIST } from "@/lib/format";
import { RIDE_STATUS_LABEL, type RideStatus } from "@/lib/cabs/cabs.manifest";

/** A ride as the pages hand it to the browser (dates as ISO text). */
export type RideView = {
  id: string; requestedByName: string; requestedByBranch: string | null; driverName: string | null; vehiclePlate: string | null; vehicleModel: string | null;
  pickup: string; dropoff: string; scheduledFor: string; status: RideStatus; notes: string | null; cancelReason: string | null; cancelledByName: string | null;
  createdAt: string;
};

/** Turns a ride from the database into what the browser gets. */
export const rideView = (r: {
  id: string; requestedByName: string; requestedByBranch: string | null; driverName: string | null; vehiclePlate: string | null; vehicleModel: string | null;
  pickup: string; dropoff: string; scheduledFor: Date; status: RideStatus; notes: string | null; cancelReason: string | null; cancelledByName: string | null; createdAt: Date;
}): RideView => ({ ...r, scheduledFor: r.scheduledFor.toISOString(), createdAt: r.createdAt.toISOString() });

/** pending amber, assigned blue, in progress teal, completed green, cancelled red. */
const TONE: Record<RideStatus, string> = {
  pending: "bg-[#fff8e1] text-[#b45309]",
  assigned: "bg-[#e8f1fa] text-[#0b63ad]",
  in_progress: "bg-blue-tint text-primary",
  completed: "bg-green-tint text-brand-green-text",
  cancelled: "bg-red-tint text-brand-red",
};

export function StatusBadge({ status }: { status: RideStatus }) {
  return <span className={`inline-block whitespace-nowrap rounded-pill px-2.5 py-0.5 text-xs font-semibold ${TONE[status]}`} data-status={status}>{RIDE_STATUS_LABEL[status]}</span>;
}

/** One ride: where from and to, when, its status, and who is driving. `actions` sits at the bottom (cancel, start, complete…). */
export function RideCard({ ride, showRequester = false, actions }: { ride: RideView; showRequester?: boolean; actions?: React.ReactNode }) {
  return (
    <article className="glass space-y-3 p-4" data-ride={ride.id}>
      <div className="flex items-start justify-between gap-3">
        <p className="flex flex-wrap items-center gap-1.5 font-semibold text-ink">{ride.pickup} <ArrowRight size={14} className="text-subtle" aria-label="to" /> {ride.dropoff}</p>
        <StatusBadge status={ride.status} />
      </div>
      <p className="flex items-center gap-1.5 text-sm text-muted"><CalendarClock size={14} aria-hidden /> {formatIST(ride.scheduledFor)}</p>
      {showRequester && <p className="flex items-center gap-1.5 text-sm text-muted"><UserRound size={14} aria-hidden /> {ride.requestedByName}{ride.requestedByBranch ? ` · ${ride.requestedByBranch}` : ""}</p>}
      {ride.driverName && <p className="flex items-center gap-1.5 text-sm text-muted"><Car size={14} aria-hidden /> {ride.driverName}{ride.vehiclePlate ? ` · ${ride.vehiclePlate}${ride.vehicleModel ? ` (${ride.vehicleModel})` : ""}` : ""}</p>}
      {ride.notes && <p className="text-sm text-subtle">{ride.notes}</p>}
      {ride.status === "cancelled" && ride.cancelReason && <p className="text-sm text-brand-red">Cancelled{ride.cancelledByName ? ` by ${ride.cancelledByName}` : ""}: {ride.cancelReason}</p>}
      {actions && <div className="flex flex-wrap justify-end gap-2">{actions}</div>}
    </article>
  );
}
