import { cancelRide } from "@/lib/cabs/bookings";
import { idParam, ok, readJson, route } from "@/lib/cabs/guard";
import { hasRole } from "@/lib/cabs/host-adapter";
import { cancelInput } from "@/lib/cabs/validation";

export const dynamic = "force-dynamic";

/**
 * Cancel a ride. ?as=admin (Cabs admins only) cancels any pending or assigned ride and needs a reason; otherwise it is the person cancelling
 * their own pending ride.
 */
export const POST = route<{ id: string }>({ roles: ["cab_user", "cab_admin"] }, async ({ req, user, params }) => {
  const asAdmin = req.nextUrl.searchParams.get("as") === "admin" && hasRole(user, "cab_admin");
  const { reason } = await readJson(req, cancelInput);
  await cancelRide(idParam(params.id), user, { asAdmin, reason });
  return ok();
});
