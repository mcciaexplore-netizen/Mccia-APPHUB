import { TransfersView } from "@/components/inventory/TransfersView";
import { listItems } from "@/lib/inventory/catalog";
import { requirePage } from "@/lib/inventory/guard";
import { listBranches } from "@/lib/inventory/host-adapter";
import { listTransfers } from "@/lib/inventory/transfers";

export const metadata = { title: "Transfers · Inventory · MCCIA App Hub" };

/** Moving stock between branches, and the transfers made so far. Inventory admins only: anyone else gets "not found". */
export default async function TransfersPage() {
  await requirePage("inventory_admin");
  const [stock, branches, transfers] = await Promise.all([listItems({}), listBranches(), listTransfers()]);
  return (
    <div className="page-enter">
      <TransfersView branches={branches.filter((b) => b.active).map((b) => ({ id: b.id, name: b.name }))}
        stock={stock.map((s) => ({ itemId: s.id, item: s.name, unit: s.unit, branchId: s.branchId, quantity: s.quantity }))}
        rows={transfers.map((t) => ({ ...t, createdAt: t.createdAt.toISOString() }))} />
    </div>
  );
}
