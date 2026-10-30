import { ok, readJson, route } from "@/lib/cabs/guard";
import { createVehicle, listVehicles } from "@/lib/cabs/vehicles";
import { vehicleInput } from "@/lib/cabs/validation";

export const dynamic = "force-dynamic";

export const GET = route({ roles: ["cab_admin"] }, async () => ok({ vehicles: await listVehicles() }));

/** Add a vehicle to the fleet (Cabs admins). The number plate must be new. */
export const POST = route({ roles: ["cab_admin"] }, async ({ req, user }) => ok(await createVehicle(await readJson(req, vehicleInput), user), 201));
