import { adminCompleteRide, completeRide } from "@/lib/cabs/bookings";
import { hasRole } from "@/lib/cabs/host-adapter";
import { CabsError } from "@/lib/cabs/errors";
import { idParam, ok, route } from "@/lib/cabs/guard";

export const dynamic = "force-dynamic";

/**
 * The ride's own driver has dropped the person off: in progress → completed. ?as=admin: a Cabs admin completes it for the driver (a driver
 * without the driver app).
 */
export const POST = route<{ id: string }>({ roles: ["cab_driver", "cab_admin"] }, async ({ req, user, params }) => {
  const id = idParam(params.id);
  if (req.nextUrl.searchParams.get("as") === "admin" && hasRole(user, "cab_admin")) await adminCompleteRide(id, user);
  else if (hasRole(user, "cab_driver")) await completeRide(id, user);
  else throw new CabsError("Not allowed.", 403);
  return ok();
});
