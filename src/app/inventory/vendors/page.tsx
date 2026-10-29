import { VendorsView } from "@/components/inventory/VendorsView";
import { requirePage } from "@/lib/inventory/guard";
import { listVendors } from "@/lib/inventory/vendors";

export const metadata = { title: "Vendors · Inventory · MCCIA App Hub" };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

/** The vendor directory. Inventory admins only: anyone else gets "not found". */
export default async function VendorsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requirePage("inventory_admin");
  const sp = await searchParams;
  const filters = { q: one(sp.q).slice(0, 100), inactive: one(sp.inactive) === "1" };
  const vendors = await listVendors({ q: filters.q, includeInactive: filters.inactive });
  return <div className="page-enter"><VendorsView vendors={vendors} canEdit filters={filters} /></div>;
}
