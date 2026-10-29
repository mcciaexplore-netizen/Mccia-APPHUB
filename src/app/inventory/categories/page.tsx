import { CategoriesView } from "@/components/inventory/CategoriesView";
import { listCategories } from "@/lib/inventory/catalog";
import { requirePage } from "@/lib/inventory/guard";

export const metadata = { title: "Categories · Inventory · MCCIA App Hub" };

/** Item categories. Inventory admin only: anyone else gets "not found". */
export default async function CategoriesPage() {
  await requirePage("inventory_admin");
  return <div className="page-enter"><CategoriesView categories={await listCategories()} /></div>;
}
