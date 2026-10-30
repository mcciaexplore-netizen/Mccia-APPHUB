import { ok, readJson, route } from "@/lib/cabs/guard";
import { recordLocation } from "@/lib/cabs/tracking";
import { locationInput } from "@/lib/cabs/validation";

export const dynamic = "force-dynamic";

/**
 * A driver's phone sends its position (every 10 seconds while a ride is under way). The driver is whoever is signed in: a driver_id in
 * the body is ignored. `saved` is false when the post came less than 5 seconds after the last one, which is dropped.
 */
export const POST = route({ roles: ["cab_driver"] }, async ({ req, user }) => ok({ saved: await recordLocation(user, await readJson(req, locationInput)) }));
