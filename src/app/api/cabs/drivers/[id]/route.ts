import { removeDriver, updateDriver } from "@/lib/cabs/drivers";
import { idParam, ok, readJson, route } from "@/lib/cabs/guard";
import { driverUpdate } from "@/lib/cabs/validation";

export const dynamic = "force-dynamic";

/** Give a driver a vehicle, or none (Cabs admins). */
export const PATCH = route<{ id: string }>({ roles: ["cab_admin"] }, async ({ req, user, params }) => {
  await updateDriver(idParam(params.id), await readJson(req, driverUpdate), user);
  return ok();
});

/** Remove a driver (Cabs admins); refused while they have assigned or running rides. */
export const DELETE = route<{ id: string }>({ roles: ["cab_admin"] }, async ({ user, params }) => {
  await removeDriver(idParam(params.id), user);
  return ok();
});
