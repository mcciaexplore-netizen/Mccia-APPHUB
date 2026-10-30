import { assignRide } from "@/lib/cabs/bookings";
import { idParam, ok, readJson, route } from "@/lib/cabs/guard";
import { assignInput } from "@/lib/cabs/validation";

export const dynamic = "force-dynamic";

/** Give a pending ride a driver and a vehicle (Cabs admins). 409 when someone else got there first, or the driver or vehicle can't take it. */
export const POST = route<{ id: string }>({ roles: ["cab_admin"] }, async ({ req, user, params }) => {
  await assignRide(idParam(params.id), await readJson(req, assignInput), user);
  return ok();
});
