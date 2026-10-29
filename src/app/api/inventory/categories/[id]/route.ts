import { deleteCategory, renameCategory } from "@/lib/inventory/catalog";
import { idParam, ok, readJson, route } from "@/lib/inventory/guard";
import { categoryInput } from "@/lib/inventory/validation";

export const dynamic = "force-dynamic";

export const PATCH = route<{ id: string }>({ roles: ["inventory_admin"] }, async ({ req, user, params }) => {
  const v = await readJson(req, categoryInput);
  await renameCategory(idParam(params.id), v.name, user);
  return ok();
});

export const DELETE = route<{ id: string }>({ roles: ["inventory_admin"] }, async ({ user, params }) => ok(await deleteCategory(idParam(params.id), user)));
