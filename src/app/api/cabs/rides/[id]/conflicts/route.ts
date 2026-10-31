import { rideConflicts } from "@/lib/cabs/bookings";
import { idParam, ok, route } from "@/lib/cabs/guard";

export const dynamic = "force-dynamic";

/** The drivers and vehicles busy within 2 hours of this ride, for the assign dialog (Cabs admins). */
export const GET = route<{ id: string }>({ roles: ["cab_admin"] }, async ({ params }) => ok(await rideConflicts(idParam(params.id))));
