import { completeRide } from "@/lib/cabs/bookings";
import { idParam, ok, route } from "@/lib/cabs/guard";

export const dynamic = "force-dynamic";

/** The ride's own driver has dropped the person off: in progress → completed. */
export const POST = route<{ id: string }>({ roles: ["cab_driver"] }, async ({ user, params }) => {
  await completeRide(idParam(params.id), user);
  return ok();
});
