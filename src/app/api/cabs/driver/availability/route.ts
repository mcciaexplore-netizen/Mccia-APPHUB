import { setOwnAvailability } from "@/lib/cabs/drivers";
import { ok, readJson, route } from "@/lib/cabs/guard";
import { availabilityInput } from "@/lib/cabs/validation";

export const dynamic = "force-dynamic";

/** A driver's own Online/Offline switch (the driver is whoever is signed in). Offline: no new rides are assigned to them. */
export const POST = route({ roles: ["cab_driver"] }, async ({ req, user }) => {
  const { available } = await readJson(req, availabilityInput);
  await setOwnAvailability(user, available);
  return ok({ available });
});
