import { notFound } from "next/navigation";
import { AmcBranchView } from "@/components/inventory/AmcBranchView";
import { amcFiltersFrom, amcYearsInUse, listAmc } from "@/lib/inventory/amc";
import { fyChoices, pickFy } from "@/lib/inventory/amc-shared";
import { listCategories } from "@/lib/inventory/catalog";
import { requirePage } from "@/lib/inventory/guard";
import { listBranches } from "@/lib/inventory/host-adapter";
import { listVendors } from "@/lib/inventory/vendors";

export const metadata = { title: "AMC · Maintenance · Inventory · MCCIA App Hub" };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

/**
 * One branch's contracts, grouped by type. The branch is in the address by its id (the name can be changed in Administrator → Branches);
 * one that does not exist is "not found". Filters: financial year, category and vendor. Inventory admins only.
 */
export default async function AmcBranchPage({ params, searchParams }: { params: Promise<{ branch: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requirePage("inventory_admin");
  const [{ branch: branchId }, sp] = await Promise.all([params, searchParams]);
  const branches = await listBranches();
  const branch = branches.find((b) => b.id === branchId);
  if (!branch) notFound();
  const f = amcFiltersFrom((k) => one(sp[k]));
  const inUse = await amcYearsInUse(branch.id);
  const fy = pickFy(f.fy ?? null, inUse);
  const [rows, categories, vendors] = await Promise.all([listAmc({ ...f, branchId: branch.id, fy }), listCategories(), listVendors({})]);
  return (
    <div className="page-enter">
      <AmcBranchView
        branch={{ id: branch.id, name: branch.name }}
        rows={rows}
        branches={branches}
        categories={categories.map((c) => ({ id: c.id, name: c.name }))}
        vendors={vendors.map((v) => ({ id: v.id, name: v.name }))}
        years={fyChoices([...inUse, fy])}
        filters={{ fy, category: f.categoryId ?? "", vendor: (f.vendor ?? "").slice(0, 100) }}
      />
    </div>
  );
}
