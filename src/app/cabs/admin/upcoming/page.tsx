import { RideQueueView } from "@/components/cabs/RideQueueView";
import { rideView } from "@/components/cabs/RideCard";
import { upcomingRides } from "@/lib/cabs/bookings";
import { requireAdminPage } from "@/lib/cabs/guard";
import { serverNow } from "@/lib/cabs/validation";

export const metadata = { title: "Upcoming Rides · Cabs Admin · MCCIA App Hub" };

/** Upcoming Rides: assigned rides, soonest first, with their driver, car and where the rider's OTP stands. They start when the driver enters it. */
export default async function UpcomingPage() {
  await requireAdminPage();
  const rides = await upcomingRides();
  return (
    <div className="page-enter space-y-5">
      <div><h1 className="text-2xl">Upcoming Rides</h1><p className="text-sm text-muted">{rides.length} assigned {rides.length === 1 ? "ride" : "rides"}, soonest first. Each starts when its driver enters the rider&apos;s OTP.</p></div>
      <RideQueueView mode="upcoming" now={serverNow()}
        rides={rides.map((r) => ({ ...rideView(r), otpState: r.otpState, otpExpiresAt: r.otpExpiresAt?.toISOString() ?? null }))} />
    </div>
  );
}
