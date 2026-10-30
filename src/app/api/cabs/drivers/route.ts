import { createDriver, listDrivers } from "@/lib/cabs/drivers";
import { ok, readJson, route } from "@/lib/cabs/guard";
import { driverInput } from "@/lib/cabs/validation";

export const dynamic = "force-dynamic";

export const GET = route({ roles: ["cab_admin"] }, async () => ok({ drivers: await listDrivers() }));

/** Make a hub user a driver (Cabs admins). */
export const POST = route({ roles: ["cab_admin"] }, async ({ req, user }) => ok(await createDriver(await readJson(req, driverInput), user), 201));
