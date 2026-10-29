import { VendorsView } from "@/components/inventory/VendorsView";
import { requirePage } from "@/lib/inventory/guard";
import { hasRole } from "@/lib/inventory/host-adapter";
import { listVendors } from "@/lib/inventory/vendors";

export const metadata = { title: "Vendors · Inventory · MCCIA App Hub" };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

/** The vendor directory. Everyone who may open Inventory can look; only an Inventory admin adds, edits, deactivates or deletes. */
export default async function VendorsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requirePage();
  const canEdit = hasRole(user, "inventory_admin");
  const sp = await searchParams;
  const filters = { q: one(sp.q).slice(0, 100), inactive: one(sp.inactive) === "1" };
  const vendors = await listVendors({ q: filters.q, includeInactive: filters.inactive });
  return <div className="page-enter"><VendorsView vendors={vendors} canEdit={canEdit} filters={filters} /></div>;
}
