import { PageHeader } from "@/components/approvals/PageHeader";
import { formatDateTime } from "@/lib/approvals/format";
import { requirePage } from "@/lib/approvals/guard";
import { listAudit } from "@/lib/approvals/roles";

export const metadata = { title: "Audit Log · MCCIA Approvals" };

export default async function Page() {
  await requirePage("approvals_admin");
  const rows = await listAudit(200);
  return (
    <>
      <PageHeader title="Audit Log" intro="Every change an admin makes to categories, branches, budgets, roles and settings. The latest 200 are shown. What happened to each request is on its own timeline." />
      <div className="table-wrap">
        <table>
          <thead><tr><th className="w-48">When</th><th className="w-48">Who</th><th>What</th></tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={3} className="py-8 text-center text-sm text-subtle">No changes recorded yet.</td></tr>}
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="whitespace-nowrap tabular-nums text-muted">{formatDateTime(r.createdAt)}</td>
                <td>{r.actorName}</td>
                <td>{r.summary}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
