import Link from "next/link";
import { PageHeader } from "@/components/approvals/PageHeader";
import { RangeForm, readRange } from "@/components/approvals/RangeForm";
import { TYPE_LABEL } from "@/lib/approvals/calc";
import { requirePage } from "@/lib/approvals/guard";
import { formatDuration, turnaround, type TurnaroundGroup } from "@/lib/approvals/reports";

export const metadata = { title: "Approval Time · MCCIA Approvals" };

function Groups({ title, rows }: { title: string; rows: TurnaroundGroup[] }) {
  return (
    <>
      <h2 className="mb-2">{title}</h2>
      <div className="table-wrap mb-8 max-w-3xl">
        <table>
          <thead><tr><th>{title.replace("By ", "")}</th><th className="text-right">Decided</th><th className="text-right">Average</th><th className="text-right">Fastest</th><th className="text-right">Slowest</th></tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={5} className="!py-6 text-center text-[var(--z-muted)]">Nothing decided in this period.</td></tr>}
            {rows.map((g) => (
              <tr key={g.name}><td>{g.name}</td><td className="text-right">{g.count}</td><td className="text-right font-bold">{formatDuration(g.avgHours)}</td><td className="text-right">{formatDuration(g.minHours)}</td><td className="text-right">{formatDuration(g.maxHours)}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requirePage("viewer", "dg");
  const range = readRange(await searchParams);
  const t = await turnaround(range);

  return (
    <>
      <PageHeader title="Approval Time" intro="How long requests took from being submitted to being decided (approved or rejected), across HR and expenditure." />
      <RangeForm {...range} />
      <p className="mb-6 text-[var(--z-muted)]">
        <b className="text-[var(--z-text)]">{t.rows.length}</b> decided requests{t.avgHours != null && <> · average <b className="text-[var(--z-text)]">{formatDuration(t.avgHours)}</b></>}
      </p>
      <Groups title="By approver" rows={t.byApprover} />
      <Groups title="By category" rows={t.byCategory} />

      <h2 className="mb-2">Recently decided</h2>
      <div className="table-wrap max-w-3xl">
        <table>
          <thead><tr><th>Request No.</th><th>Type</th><th>Category</th><th>Approver</th><th>Outcome</th><th className="text-right">Took</th></tr></thead>
          <tbody>
            {t.rows.length === 0 && <tr><td colSpan={6} className="!py-6 text-center text-[var(--z-muted)]">Nothing decided in this period.</td></tr>}
            {t.rows.slice(0, 50).map((r) => (
              <tr key={r.id}>
                <td className="font-bold"><Link className="text-[var(--z-teal-dark)] hover:underline" href={`/approvals/requests/${r.id}`}>{r.requestNo}</Link></td>
                <td>{TYPE_LABEL[r.type]}</td><td>{r.categoryName}</td><td>{r.approverName}</td>
                <td>{r.status === "approved" ? "Approved" : "Rejected"}</td><td className="text-right">{formatDuration(r.hours)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
