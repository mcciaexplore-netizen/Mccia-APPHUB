import { removeDriver } from "@/lib/cabs/drivers";
import { idParam, ok, route } from "@/lib/cabs/guard";

export const dynamic = "force-dynamic";

/** Remove a driver (Cabs admins); refused while they have assigned or running rides. */
export const DELETE = route<{ id: string }>({ roles: ["cab_admin"] }, async ({ user, params }) => {
  await removeDriver(idParam(params.id), user);
  return ok();
});
