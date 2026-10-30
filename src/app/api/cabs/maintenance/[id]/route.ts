import { idParam, ok, readJson, route } from "@/lib/cabs/guard";
import { deleteMaintenance, editMaintenance } from "@/lib/cabs/maintenance";
import { maintenanceInput } from "@/lib/cabs/validation";

export const dynamic = "force-dynamic";

export const PATCH = route<{ id: string }>({ roles: ["cab_admin"] }, async ({ req, user, params }) => {
  await editMaintenance(idParam(params.id), await readJson(req, maintenanceInput), user);
  return ok();
});

export const DELETE = route<{ id: string }>({ roles: ["cab_admin"] }, async ({ user, params }) => {
  await deleteMaintenance(idParam(params.id), user);
  return ok();
});
