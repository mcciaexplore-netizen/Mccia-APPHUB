import { ArrowRight, CalendarClock, CalendarRange, Car, MapPin, UserRound, Users } from "lucide-react";
import { formatIST } from "@/lib/format";
import { RIDE_STATUS_LABEL, type RideStatus } from "@/lib/cabs/cabs.manifest";

/** A ride as the pages hand it to the browser (dates as ISO text). */
export type RideView = {
  id: string; requestedByName: string; requestedByBranch: string | null; driverName: string | null; vehiclePlate: string | null; vehicleModel: string | null;
  pickup: string; dropoff: string; scheduledFor: string; status: RideStatus; notes: string | null; cancelReason: string | null; cancelledByName: string | null;
  createdAt: string; pickupLat: number | null; pickupLng: number | null; dropoffLat: number | null; dropoffLng: number | null;
  /** Whether the ride has an OTP; the code itself only on the rider's own rides. */
  hasOtp: boolean; otp?: { code: string; usable: boolean } | null;
  passengers: number; tripType: "now" | "scheduled" | "multiday"; endsAt: string | null; stops: { text: string; lat: number | null; lng: number | null }[];
};

/** Turns a ride from the database into what the browser gets. */
export const rideView = (r: Omit<RideView, "scheduledFor" | "createdAt" | "endsAt"> & { scheduledFor: Date; createdAt: Date; endsAt: Date | null }): RideView => ({
  id: r.id, requestedByName: r.requestedByName, requestedByBranch: r.requestedByBranch, driverName: r.driverName, vehiclePlate: r.vehiclePlate, vehicleModel: r.vehicleModel,
  pickup: r.pickup, dropoff: r.dropoff, scheduledFor: r.scheduledFor.toISOString(), status: r.status, notes: r.notes, cancelReason: r.cancelReason, cancelledByName: r.cancelledByName,
  createdAt: r.createdAt.toISOString(), pickupLat: r.pickupLat, pickupLng: r.pickupLng, dropoffLat: r.dropoffLat, dropoffLng: r.dropoffLng, hasOtp: r.hasOtp,
  passengers: r.passengers, tripType: r.tripType, endsAt: r.endsAt ? r.endsAt.toISOString() : null, stops: r.stops,
  ...(r.otp !== undefined ? { otp: r.otp } : {}),
});

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

/** The rider's OTP for an assigned ride, big enough to read off a phone held up to the driver. */
function OtpPanel({ otp }: { otp: { code: string; usable: boolean } }) {
  if (!otp.usable) return <p className="rounded-md border border-[#fcd34d] bg-[#fff8e1] px-3 py-2 text-sm font-semibold text-[#b45309]">Your OTP can no longer be used. Ask a Cabs admin for a new one.</p>;
  return (
    <div className="rounded-lg border border-blue-tint-line bg-blue-tint px-4 py-3 text-center" data-otp>
      <p className="text-sm font-semibold text-muted">Show this to your driver:</p>
      <p className="mt-1 font-mono text-5xl font-extrabold tracking-[0.3em] text-primary" aria-label={`OTP ${otp.code.split("").join(" ")}`}>{otp.code}</p>
    </div>
  );
}

/** When a ride is: "Now (asked 31 Oct, 9:05 am)", a time, or "From … until …" for a multi-day trip. */
export function whenText(ride: Pick<RideView, "tripType" | "scheduledFor" | "endsAt" | "createdAt">): string {
  if (ride.tripType === "now") return `As soon as approved (asked ${formatIST(ride.createdAt)})`;
  if (ride.tripType === "multiday" && ride.endsAt) return `${formatIST(ride.scheduledFor)} until ${new Date(ride.endsAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" })}`;
  return formatIST(ride.scheduledFor);
}

/** One ride: where from and to (and any stops), when, how many people, its status, and who is driving. `actions` sits at the bottom. */
export function RideCard({ ride, showRequester = false, actions }: { ride: RideView; showRequester?: boolean; actions?: React.ReactNode }) {
  return (
    <article className="space-y-3 rounded-xl bg-white p-4 shadow-sm" data-ride={ride.id}>
      <div className="flex items-start justify-between gap-3">
        <p className="flex flex-wrap items-center gap-1.5 font-semibold text-ink">{ride.pickup} <ArrowRight size={14} className="text-subtle" aria-label="to" /> {ride.dropoff}</p>
        <StatusBadge status={ride.status} />
      </div>
      {ride.stops.length > 0 && <p className="flex items-start gap-1.5 text-sm text-muted"><MapPin size={14} className="mt-0.5 shrink-0" aria-hidden /> Via {ride.stops.map((s) => s.text).join(", ")}</p>}
      <p className="flex items-center gap-1.5 text-sm text-muted">{ride.tripType === "multiday" ? <CalendarRange size={14} aria-hidden /> : <CalendarClock size={14} aria-hidden />} {whenText(ride)}</p>
      <p className="flex items-center gap-1.5 text-sm text-muted"><Users size={14} aria-hidden /> {ride.passengers} {ride.passengers === 1 ? "passenger" : "passengers"}</p>
      {showRequester && <p className="flex items-center gap-1.5 text-sm text-muted"><UserRound size={14} aria-hidden /> {ride.requestedByName}{ride.requestedByBranch ? ` · ${ride.requestedByBranch}` : ""}</p>}
      {ride.driverName && <p className="flex items-center gap-1.5 text-sm text-muted"><Car size={14} aria-hidden /> {ride.driverName}{ride.vehiclePlate ? ` · ${ride.vehiclePlate}${ride.vehicleModel ? ` (${ride.vehicleModel})` : ""}` : ""}</p>}
      {ride.notes && <p className="text-sm text-subtle">{ride.notes}</p>}
      {ride.status === "assigned" && ride.otp && <OtpPanel otp={ride.otp} />}
      {ride.status === "cancelled" && ride.cancelReason && <p className="text-sm text-brand-red">Cancelled{ride.cancelledByName ? ` by ${ride.cancelledByName}` : ""}: {ride.cancelReason}</p>}
      {actions && <div className="flex flex-wrap justify-end gap-2">{actions}</div>}
    </article>
  );
}
