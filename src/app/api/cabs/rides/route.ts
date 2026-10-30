import { createRide, myRideStatuses } from "@/lib/cabs/bookings";
import { ok, readJson, route } from "@/lib/cabs/guard";
import { rideInput } from "@/lib/cabs/validation";

export const dynamic = "force-dynamic";

/** Book a ride (MCCIA Cabs). It is pending until a Cabs admin assigns a driver and a vehicle. */
export const POST = route({ roles: ["cab_user"] }, async ({ req, user }) => {
  const input = await readJson(req, rideInput);
  return ok(await createRide(input, user), 201);
});

/** The signed-in person's rides from the last 30 days and their status: what a rider's open page checks for its alerts. */
export const GET = route({ roles: ["cab_user"] }, async ({ user }) => ok({ rides: await myRideStatuses(user.id) }));
