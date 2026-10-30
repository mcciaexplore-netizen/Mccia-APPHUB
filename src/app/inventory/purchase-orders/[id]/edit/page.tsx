import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { POForm } from "@/components/inventory/POForm";
import { listCatalogue } from "@/lib/inventory/catalog";
import { idSchema } from "@/lib/inventory/validation";
import { requirePage } from "@/lib/inventory/guard";
import { getPurchaseOrder } from "@/lib/inventory/purchase-orders";
import { listVendors } from "@/lib/inventory/vendors";

export const metadata = { title: "Edit purchase order · Inventory · MCCIA App Hub" };

/** Only a draft can be edited; anything else goes back to the order itself. */
export default async function EditPurchaseOrderPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePage("inventory_admin");
  const { id } = await params;
  if (!idSchema.safeParse(id).success) notFound();
  const po = await getPurchaseOrder(id);
  if (!po) notFound();
  if (po.status !== "draft") redirect(`/inventory/purchase-orders/${id}`);
  const [vendors, items] = await Promise.all([listVendors({}), listCatalogue()]);
  return (
    <div className="page-enter space-y-5">
      <div>
        <Link href={`/inventory/purchase-orders/${id}`} className="text-sm text-muted hover:text-primary">← {po.poNo}</Link>
        <h1 className="mt-1 text-2xl">Edit {po.poNo}</h1>
      </div>
      <POForm vendors={vendors.map(({ id: v, name }) => ({ id: v, name }))} items={items.map(({ id: i, name, unit, ratePaise }) => ({ id: i, name, unit, ratePaise }))}
        initial={{ id, poNo: po.poNo ?? "", vendorId: po.vendorId, vendorName: po.vendorName, notes: po.notes,
          lines: po.lines.map((l) => ({ itemId: l.itemId, description: l.description, quantity: l.quantity, ratePaise: l.ratePaise })) }} />
    </div>
  );
}
