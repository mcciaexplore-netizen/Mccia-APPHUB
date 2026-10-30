import { Suspense } from "react";
import { TableSkeleton } from "@/components/approvals/Skeletons";
import { ItemsView } from "@/components/inventory/ItemsView";
import { listCategories, listItems } from "@/lib/inventory/catalog";
import { requirePage } from "@/lib/inventory/guard";
import { hasRole } from "@/lib/inventory/host-adapter";
import { SEES_ITEMS } from "@/lib/inventory/inventory.manifest";
import { idSchema } from "@/lib/inventory/validation";

export const metadata = { title: "Items · Inventory · MCCIA App Hub" };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

/** The item catalogue. Staff and Inventory admins see it (a user picks an item only when making a request); only an Inventory admin may change it (and see inactive items). */
export default async function ItemsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requirePage(...SEES_ITEMS);
  const canEdit = hasRole(user, "inventory_admin");
  const sp = await searchParams;
  const category = one(sp.category);
  const filters = { q: one(sp.q).slice(0, 100), categoryId: idSchema.safeParse(category).success ? category : "", low: one(sp.low) === "1", inactive: canEdit && one(sp.inactive) === "1" };
  // Who may see it is settled above, before anything is sent; the list itself streams in behind a placeholder.
  return (
    <div className="page-enter">
      <Suspense fallback={<div role="status" aria-label="Loading items"><TableSkeleton rows={8} /></div>}>
        <ItemsList canEdit={canEdit} filters={filters} />
      </Suspense>
    </div>
  );
}

async function ItemsList({ canEdit, filters }: { canEdit: boolean; filters: { q: string; categoryId: string; low: boolean; inactive: boolean } }) {
  const [items, categories] = await Promise.all([
    listItems({ q: filters.q, categoryId: filters.categoryId || undefined, low: filters.low, includeInactive: filters.inactive }),
    listCategories(),
  ]);
  return <ItemsView items={items} categories={categories.map(({ id, name }) => ({ id, name }))} canEdit={canEdit} filters={filters} />;
}
