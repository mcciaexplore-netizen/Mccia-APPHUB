import { getRide } from "@/lib/cabs/bookings";
import { CabsError } from "@/lib/cabs/errors";
import { idParam, ok, route } from "@/lib/cabs/guard";
import { hasRole } from "@/lib/cabs/host-adapter";

export const dynamic = "force-dynamic";

/** One ride: for the person who booked it, its driver, and Cabs admins. Anyone else gets "not found". */
export const GET = route<{ id: string }>({ roles: ["cab_user", "cab_driver", "cab_admin"] }, async ({ user, params }) => {
  const ride = await getRide(idParam(params.id));
  const mine = !!ride && (ride.requestedById === user.id || (!!user.driverId && ride.driverId === user.driverId) || hasRole(user, "cab_admin"));
  if (!ride || !mine) throw new CabsError("Not found.", 404);
  return ok({ ride });
});
