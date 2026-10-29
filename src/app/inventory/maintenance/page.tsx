import { MaintenanceView } from "@/components/inventory/MaintenanceView";
import { requirePage } from "@/lib/inventory/guard";
import { hasAnyRole } from "@/lib/inventory/host-adapter";
import { STAFF_ROLES } from "@/lib/inventory/inventory.manifest";
import { listTickets, ticketCounts, type TicketStatus } from "@/lib/inventory/maintenance";

export const metadata = { title: "Maintenance · Inventory · MCCIA App Hub" };

/** Everyone reports problems and sees their own tickets; store staff (Inventory staff and admins) see all of them and resolve them. */
export default async function MaintenancePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requirePage();
  const canManage = hasAnyRole(user, STAFF_ROLES);
  const raw = String((await searchParams).status ?? "");
  const status = canManage && ["open", "in_progress", "resolved"].includes(raw) ? (raw as TicketStatus) : "";
  const [rows, counts] = await Promise.all([listTickets({ mineOnly: canManage ? undefined : user.id, status: status || undefined }), canManage ? ticketCounts() : Promise.resolve(undefined)]);
  return (
    <div className="page-enter">
      <MaintenanceView canManage={canManage} status={status} counts={counts}
        rows={rows.map((r) => ({ ...r, raisedAt: r.raisedAt.toISOString(), resolvedAt: r.resolvedAt?.toISOString() ?? null }))} />
    </div>
  );
}
