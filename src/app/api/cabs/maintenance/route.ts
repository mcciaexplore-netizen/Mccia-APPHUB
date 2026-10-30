import { ok, readJson, route } from "@/lib/cabs/guard";
import { addMaintenance } from "@/lib/cabs/maintenance";
import { maintenanceInput } from "@/lib/cabs/validation";

export const dynamic = "force-dynamic";

/** Record maintenance done on an active vehicle (Cabs admins). */
export const POST = route({ roles: ["cab_admin"] }, async ({ req, user }) => ok(await addMaintenance(await readJson(req, maintenanceInput), user), 201));
