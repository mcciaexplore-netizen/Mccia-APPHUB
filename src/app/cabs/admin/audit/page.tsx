import { AuditView } from "@/components/cabs/AuditView";
import { AUDIT_PAGE_SIZE, listCabAudit } from "@/lib/cabs/audit";
import { requireAdminPage } from "@/lib/cabs/guard";

export const metadata = { title: "Audit Log · Cabs Admin · MCCIA App Hub" };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

/** Every important Cab Booking action, newest first, 50 to a page, with filters and a CSV export. Cabs admins only. */
export default async function CabsAuditPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdminPage();
  const sp = await searchParams;
  const f = { action: one(sp.action), from: one(sp.from), to: one(sp.to) };
  const { rows, total, page } = await listCabAudit(f, Number(one(sp.page)) || 1);
  return <div className="page-enter"><AuditView rows={rows} total={total} page={page} pages={Math.max(1, Math.ceil(total / AUDIT_PAGE_SIZE))} filters={f} /></div>;
}
