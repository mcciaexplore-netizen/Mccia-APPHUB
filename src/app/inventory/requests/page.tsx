import { RequestsView } from "@/components/inventory/RequestsView";
import { NO_BRANCH_MESSAGE } from "@/lib/inventory/branches";
import { listItems } from "@/lib/inventory/catalog";
import { requirePage } from "@/lib/inventory/guard";
import { hasAnyRole, hasRole, listBranches } from "@/lib/inventory/host-adapter";
import { SEES_ALL_BRANCHES } from "@/lib/inventory/inventory.manifest";
import { REQUEST_STATUSES, listRequests, statusCounts, type RequestStatus } from "@/lib/inventory/requests";
import { idSchema } from "@/lib/inventory/validation";

export const metadata = { title: "Requests · Inventory · MCCIA App Hub" };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

/**
 * Everyone raises requests, at their own branch and for what it keeps, and sees their own. Inventory admins and Staff see everyone's, every
 * branch or one; only Inventory admins act on them.
 */
export default async function RequestsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requirePage();
  const canManage = hasRole(user, "inventory_admin");
  const seesAll = hasAnyRole(user, SEES_ALL_BRANCHES);
  const sp = await searchParams;
  const raw = one(sp.status);
  const status = seesAll && (REQUEST_STATUSES as readonly string[]).includes(raw) ? (raw as RequestStatus) : "";
  const branchId = seesAll && idSchema.safeParse(one(sp.branch)).success ? one(sp.branch) : "";
  const [rows, items, counts, branches] = await Promise.all([
    listRequests({ mineOnly: seesAll ? undefined : user.id, status: status || undefined, branchId: branchId || undefined }),
    user.branchId ? listItems({ branchId: user.branchId }) : Promise.resolve([]),
    seesAll ? statusCounts(branchId || undefined) : Promise.resolve(undefined),
    seesAll ? listBranches() : Promise.resolve([]),
  ]);
  return (
    <div className="page-enter">
      <RequestsView canManage={canManage} seesAll={seesAll} status={status} counts={counts} branches={branches} branchId={branchId}
        ownBranch={user.branchName} noBranch={user.branchId ? null : NO_BRANCH_MESSAGE}
        items={items.map((i) => ({ id: i.id, name: i.name, unit: i.unit, quantity: i.quantity }))}
        rows={rows.map((r) => ({ id: r.id, item: r.item, unit: r.unit, branchName: r.branchName, inStock: r.inStock, quantity: r.quantity, note: r.note, status: r.status, requestedByName: r.requestedByName,
          requestedAt: r.requestedAt.toISOString(), resolvedByName: r.resolvedByName, resolvedAt: r.resolvedAt?.toISOString() ?? null, rejectReason: r.rejectReason }))} />
    </div>
  );
}
