import { ok, route } from "@/lib/cabs/guard";
import { liveTrips } from "@/lib/cabs/tracking";

export const dynamic = "force-dynamic";

/** Every ride in progress, with its driver's latest position, for Live Trips (polled every 5 seconds). Cabs admins only. */
export const GET = route({ roles: ["cab_admin"] }, async () => ok({ trips: await liveTrips() }));
