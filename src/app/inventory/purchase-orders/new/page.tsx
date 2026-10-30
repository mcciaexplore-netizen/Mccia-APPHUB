import Link from "next/link";
import { POForm } from "@/components/inventory/POForm";
import { listCatalogue } from "@/lib/inventory/catalog";
import { requirePage } from "@/lib/inventory/guard";
import { listVendors } from "@/lib/inventory/vendors";

export const metadata = { title: "New purchase order · Inventory · MCCIA App Hub" };

export default async function NewPurchaseOrderPage() {
  await requirePage("inventory_admin");
  const [vendors, items] = await Promise.all([listVendors({}), listCatalogue()]);
  return (
    <div className="page-enter space-y-5">
      <div>
        <Link href="/inventory/purchase-orders" className="text-sm text-muted hover:text-primary">← Purchase orders</Link>
        <h1 className="mt-1 text-2xl">New purchase order</h1>
        <p className="text-sm text-muted">It is saved as a draft with the next number of this financial year. You can still change it before sending.</p>
      </div>
      <POForm vendors={vendors.map(({ id, name }) => ({ id, name }))} items={items.map(({ id, name, unit, ratePaise }) => ({ id, name, unit, ratePaise }))} />
    </div>
  );
}
