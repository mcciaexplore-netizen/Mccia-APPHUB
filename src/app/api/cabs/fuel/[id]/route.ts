import { deleteFuel } from "@/lib/cabs/fuel";
import { idParam, ok, route } from "@/lib/cabs/guard";

export const dynamic = "force-dynamic";

/** Delete a fuel record entered by mistake (Cabs admins; it stays in the audit log). */
export const DELETE = route<{ id: string }>({ roles: ["cab_admin"] }, async ({ user, params }) => {
  await deleteFuel(idParam(params.id), user);
  return ok();
});
