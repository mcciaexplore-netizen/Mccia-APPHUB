import { ItemsView } from "@/components/inventory/ItemsView";
import { listCategories, listItems } from "@/lib/inventory/catalog";
import { requirePage } from "@/lib/inventory/guard";
import { hasRole } from "@/lib/inventory/host-adapter";
import { idSchema } from "@/lib/inventory/validation";

export const metadata = { title: "Items · Inventory · MCCIA App Hub" };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

/** The item catalogue. Everyone who may open Inventory sees it; only an Inventory admin may change it (and see inactive items). */
export default async function ItemsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requirePage();
  const canEdit = hasRole(user, "inventory_admin");
  const sp = await searchParams;
  const category = one(sp.category);
  const filters = { q: one(sp.q).slice(0, 100), categoryId: idSchema.safeParse(category).success ? category : "", low: one(sp.low) === "1", inactive: canEdit && one(sp.inactive) === "1" };
  const [items, categories] = await Promise.all([
    listItems({ q: filters.q, categoryId: filters.categoryId || undefined, low: filters.low, includeInactive: filters.inactive }),
    listCategories(),
  ]);
  return <div className="page-enter"><ItemsView items={items} categories={categories.map(({ id, name }) => ({ id, name }))} canEdit={canEdit} filters={filters} /></div>;
}
