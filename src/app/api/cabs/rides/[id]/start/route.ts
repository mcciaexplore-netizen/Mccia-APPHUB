import { startRide } from "@/lib/cabs/bookings";
import { idParam, ok, route } from "@/lib/cabs/guard";

export const dynamic = "force-dynamic";

/** The ride's own driver sets off: assigned → in progress. */
export const POST = route<{ id: string }>({ roles: ["cab_driver"] }, async ({ user, params }) => {
  await startRide(idParam(params.id), user);
  return ok();
});
