import { addFuel } from "@/lib/cabs/fuel";
import { ok, readJson, route } from "@/lib/cabs/guard";
import { fuelInput } from "@/lib/cabs/validation";

export const dynamic = "force-dynamic";

/** Record fuel bought for an active vehicle (Cabs admins). "Added by" is whoever is signed in. */
export const POST = route({ roles: ["cab_admin"] }, async ({ req, user }) => ok(await addFuel(await readJson(req, fuelInput), user), 201));
