import { createCategory, listCategories } from "@/lib/inventory/catalog";
import { ok, readJson, route } from "@/lib/inventory/guard";
import { categoryInput } from "@/lib/inventory/validation";

export const dynamic = "force-dynamic";

/** Every category, for the item form's dropdown. Anyone who may open Inventory. */
export const GET = route({}, async () => ok({ categories: await listCategories() }));

export const POST = route({ roles: ["inventory_admin"] }, async ({ req, user }) => {
  const v = await readJson(req, categoryInput);
  return ok({ category: await createCategory(v.name, user) }, 201);
});
