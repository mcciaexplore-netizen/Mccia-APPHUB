import { idParam, ok, readJson, route } from "@/lib/cabs/guard";
import { deactivateVehicle, updateVehicle } from "@/lib/cabs/vehicles";
import { vehicleUpdate } from "@/lib/cabs/validation";

export const dynamic = "force-dynamic";

/** Edit a vehicle, or make an inactive one active again with { isActive: true } (Cabs admins). */
export const PATCH = route<{ id: string }>({ roles: ["cab_admin"] }, async ({ req, user, params }) => {
  await updateVehicle(idParam(params.id), await readJson(req, vehicleUpdate), user);
  return ok();
});

/** Deactivate a vehicle (Cabs admins). Never deleted: past rides keep naming it. Refused while it is on an assigned or running ride. */
export const DELETE = route<{ id: string }>({ roles: ["cab_admin"] }, async ({ user, params }) => {
  await deactivateVehicle(idParam(params.id), user);
  return ok();
});
