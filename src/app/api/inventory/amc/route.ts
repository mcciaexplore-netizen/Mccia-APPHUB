import { createAmc } from "@/lib/inventory/amc";
import { ok, readJson, route } from "@/lib/inventory/guard";
import { amcInput } from "@/lib/inventory/validation";

export const dynamic = "force-dynamic";

/** Adds an Annual Maintenance Contract. Inventory admin only. */
export const POST = route({ roles: ["inventory_admin"] }, async ({ req, user }) => ok({ amc: await createAmc(await readJson(req, amcInput), user) }, 201));
