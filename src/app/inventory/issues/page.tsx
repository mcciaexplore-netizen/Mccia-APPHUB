import { IssuesView } from "@/components/inventory/IssuesView";
import { listItems } from "@/lib/inventory/catalog";
import { requirePage } from "@/lib/inventory/guard";
import { listBranches, listDepartments, listUsers } from "@/lib/inventory/host-adapter";
import { listIssues, type IssueFilter } from "@/lib/inventory/issues";

export const metadata = { title: "Issues & returns · Inventory · MCCIA App Hub" };

/** Every issue and return, recorded by Inventory admins. Inventory admins only: anyone else gets "not found". */
export default async function IssuesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requirePage("inventory_admin");
  const show = String((await searchParams).show ?? "");
  const filter: IssueFilter = show === "returned" || show === "all" ? show : "out";
  const [rows, items, people, departments, branches] = await Promise.all([
    listIssues({ filter }),
    listItems({}),
    listUsers(),
    listDepartments(),
    listBranches(),
  ]);
  return (
    <div className="page-enter">
      <IssuesView canManage filter={filter} departments={departments} branches={branches.filter((b) => b.active)} ownBranchId={user.branchId}
        items={items.map((i) => ({ id: i.id, name: i.name, unit: i.unit, quantity: i.quantity, branchId: i.branchId }))}
        people={people.map((p) => ({ id: p.id, name: p.name }))}
        rows={rows.map((r) => ({ id: r.id, item: r.item, unit: r.unit, branchName: r.branchName, quantity: r.quantity, returned: r.returned, outstanding: r.outstanding, issuedToName: r.issuedToName,
          departmentId: r.departmentId, eventName: r.eventName, note: r.note, requestId: r.requestId, actorName: r.actorName,
          createdAt: r.createdAt.toISOString(), lastReturnAt: r.lastReturnAt?.toISOString() ?? null }))} />
    </div>
  );
}
