import { ok, route } from "@/lib/cabs/guard";
import { fleet } from "@/lib/cabs/tracking";

export const dynamic = "force-dynamic";

/** Each driver's latest position from the last 24 hours, with their current ride and vehicle, for the admins' fleet map (polled every 2 seconds). */
export const GET = route({ roles: ["cab_admin"] }, async () => ok({ drivers: await fleet() }));
