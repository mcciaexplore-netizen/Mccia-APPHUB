import { startRide } from "@/lib/cabs/bookings";
import { idParam, ok, route } from "@/lib/cabs/guard";

export const dynamic = "force-dynamic";

/**
 * The ride's own driver sets off: assigned → in progress, for a ride with no OTP (one assigned before OTPs existed; a ride with an OTP
 * starts when the driver enters it). Drivers only, signed in to the hub or by phone: a Cabs admin gets 403 (unless they are this ride's
 * driver), and another driver's ride is refused.
 */
export const POST = route<{ id: string }>({ roles: ["cab_driver"] }, async ({ user, params }) => {
  await startRide(idParam(params.id), user);
  return ok();
});
