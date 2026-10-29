import { RequestsView } from "@/components/inventory/RequestsView";
import { listItems } from "@/lib/inventory/catalog";
import { requirePage } from "@/lib/inventory/guard";
import { hasAnyRole } from "@/lib/inventory/host-adapter";
import { STAFF_ROLES } from "@/lib/inventory/inventory.manifest";
import { REQUEST_STATUSES, listRequests, statusCounts, type RequestStatus } from "@/lib/inventory/requests";

export const metadata = { title: "Requests · Inventory · MCCIA App Hub" };

/** Everyone raises requests and sees their own; store staff (Inventory staff and admins) see all of them and act on them. */
export default async function RequestsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requirePage();
  const canManage = hasAnyRole(user, STAFF_ROLES);
  const raw = (await searchParams).status;
  const status = canManage && (REQUEST_STATUSES as readonly string[]).includes(String(raw)) ? (raw as RequestStatus) : "";
  const [rows, items, counts] = await Promise.all([
    listRequests({ mineOnly: canManage ? undefined : user.id, status: status || undefined }),
    listItems({}),
    canManage ? statusCounts() : Promise.resolve(undefined),
  ]);
  return (
    <div className="page-enter">
      <RequestsView canManage={canManage} status={status} counts={counts}
        items={items.map((i) => ({ id: i.id, name: i.name, unit: i.unit, quantity: i.quantity }))}
        rows={rows.map((r) => ({ id: r.id, item: r.item, unit: r.unit, inStock: r.inStock, quantity: r.quantity, note: r.note, status: r.status, requestedByName: r.requestedByName,
          requestedAt: r.requestedAt.toISOString(), resolvedByName: r.resolvedByName, resolvedAt: r.resolvedAt?.toISOString() ?? null, rejectReason: r.rejectReason }))} />
    </div>
  );
}
