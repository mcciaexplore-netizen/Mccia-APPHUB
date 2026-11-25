import { AmcView } from "@/components/inventory/AmcView";
import { amcFiltersFrom, amcYearsInUse, listAmc } from "@/lib/inventory/amc";
import { fyChoices, pickFy } from "@/lib/inventory/amc-shared";
import { listCategories } from "@/lib/inventory/catalog";
import { requirePage } from "@/lib/inventory/guard";
import { listBranches } from "@/lib/inventory/host-adapter";
import { listVendors } from "@/lib/inventory/vendors";

export const metadata = { title: "AMC · Maintenance · Inventory · MCCIA App Hub" };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

/**
 * Annual Maintenance Contracts: every branch's contracts with the vendor, type and the two years' amounts, filtered by branch, category,
 * financial year and vendor, with a total. Inventory admins only: anyone else gets "not found".
 */
export default async function AmcPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requirePage("inventory_admin");
  const sp = await searchParams;
  const f = amcFiltersFrom((k) => one(sp[k]));
  const inUse = await amcYearsInUse();
  const fy = pickFy(f.fy ?? null, inUse);
  const [rows, branches, categories, vendors] = await Promise.all([listAmc({ ...f, fy }), listBranches(), listCategories(), listVendors({})]);
  return (
    <div className="page-enter">
      <AmcView
        rows={rows}
        branches={branches}
        categories={categories.map((c) => ({ id: c.id, name: c.name }))}
        vendors={vendors.map((v) => ({ id: v.id, name: v.name }))}
        years={fyChoices([...inUse, fy])}
        filters={{ branch: f.branchId ?? "", category: f.categoryId ?? "", fy, vendor: (f.vendor ?? "").slice(0, 100) }}
      />
    </div>
  );
}
