import { IssuesView } from "@/components/inventory/IssuesView";
import { listItems } from "@/lib/inventory/catalog";
import { requirePage } from "@/lib/inventory/guard";
import { hasAnyRole, listDepartments, listUsers } from "@/lib/inventory/host-adapter";
import { STAFF_ROLES } from "@/lib/inventory/inventory.manifest";
import { listIssues, type IssueFilter } from "@/lib/inventory/issues";

export const metadata = { title: "Issues & returns · Inventory · MCCIA App Hub" };

/** Store staff see every issue and record issues and returns; everyone else sees what has been issued to them. */
export default async function IssuesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requirePage();
  const canManage = hasAnyRole(user, STAFF_ROLES);
  const show = String((await searchParams).show ?? "");
  const filter: IssueFilter = show === "returned" || show === "all" ? show : "out";
  const [rows, items, people, departments] = await Promise.all([
    listIssues({ toUser: canManage ? undefined : user.id, filter }),
    canManage ? listItems({}) : Promise.resolve([]),
    canManage ? listUsers() : Promise.resolve([]),
    listDepartments(),
  ]);
  return (
    <div className="page-enter">
      <IssuesView canManage={canManage} filter={filter} departments={departments}
        items={items.map((i) => ({ id: i.id, name: i.name, unit: i.unit, quantity: i.quantity }))}
        people={people.map((p) => ({ id: p.id, name: p.name }))}
        rows={rows.map((r) => ({ id: r.id, item: r.item, unit: r.unit, quantity: r.quantity, returned: r.returned, outstanding: r.outstanding, issuedToName: r.issuedToName,
          departmentId: r.departmentId, eventName: r.eventName, note: r.note, requestId: r.requestId, actorName: r.actorName,
          createdAt: r.createdAt.toISOString(), lastReturnAt: r.lastReturnAt?.toISOString() ?? null }))} />
    </div>
  );
}
