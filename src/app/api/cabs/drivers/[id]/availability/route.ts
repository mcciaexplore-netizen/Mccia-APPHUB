import { setAvailability } from "@/lib/cabs/drivers";
import { idParam, ok, readJson, route } from "@/lib/cabs/guard";
import { availabilityInput } from "@/lib/cabs/validation";

export const dynamic = "force-dynamic";

/** Mark a driver available or not (Cabs admins). Only available drivers can be given rides. */
export const POST = route<{ id: string }>({ roles: ["cab_admin"] }, async ({ req, user, params }) => {
  const { available } = await readJson(req, availabilityInput);
  await setAvailability(idParam(params.id), available, user);
  return ok();
});
