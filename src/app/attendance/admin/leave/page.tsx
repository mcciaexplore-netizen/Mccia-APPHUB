import { History, SlidersHorizontal, Wallet } from "lucide-react";
import Link from "next/link";
import { Card, PageHeader, RequestStatus } from "@/components/attendance/ui";
import { LeaveTrackerView } from "@/components/attendance/admin/LeaveTrackerView";
import { requireAdmin } from "@/lib/attendance/dal";
import { adjustmentHistory, leaveHistory, leaveTracker } from "@/lib/attendance/admin";
import { formatDay, formatMoment, istDay } from "@/lib/attendance/time";

export const metadata = { title: "Leave Tracker · Attendance Admin" };

/** Balances per person per type (adjust with a remark), the adjustment log and the leave history. */
export default async function AdminLeavePage({ searchParams }: PageProps<"/attendance/admin/leave">) {
  await requireAdmin();
  const sp = await searchParams;
  const thisYear = Number(istDay().slice(0, 4));
  const y = Number(sp.year);
  const year = Number.isInteger(y) && y >= thisYear - 5 && y <= thisYear + 1 ? y : thisYear;
  const [tracker, adjustments, history] = await Promise.all([leaveTracker(year), adjustmentHistory(50), leaveHistory({ from: `${year}-01-01`, to: `${year}-12-31` }, 200)]);
  return (
    <>
      <PageHeader
        title="Leave Tracker"
        subtitle="Hover a balance for its make-up. Adjustments are told to the person on the bell."
        actions={
          <div className="inline-flex gap-1">
            {[thisYear - 1, thisYear, thisYear + 1].map((yr) => (
              <Link key={yr} href={`/attendance/admin/leave?year=${yr}`} className={`att-badge ${yr === year ? "att-tone-primary" : "att-tone-neutral"}`}>
                {yr}
              </Link>
            ))}
          </div>
        }
      />
      <div className="flex flex-col gap-5">
        <Card title={`Balances ${year}`} icon={Wallet} iconTone="green" pad={false}>
          <LeaveTrackerView year={year} types={tracker.types.map((t) => ({ id: t.id, name: t.name, color: t.color, isCompoff: t.isCompoff }))} rows={tracker.rows} />
        </Card>
        <Card title="Adjustments" icon={SlidersHorizontal} iconTone="orange" pad={false}>
          {adjustments.length === 0 ? (
            <p className="px-5 py-4 text-sm att-muted">No adjustments yet.</p>
          ) : (
            <div className="att-scroll">
              <table className="att-table">
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Person</th>
                    <th>Type</th>
                    <th>Days</th>
                    <th>Remark</th>
                    <th>By</th>
                  </tr>
                </thead>
                <tbody>
                  {adjustments.map((a) => (
                    <tr key={a.id}>
                      <td className="whitespace-nowrap text-xs">{formatMoment(a.createdAt)}</td>
                      <td className="font-semibold">{a.person}</td>
                      <td>
                        {a.typeName} <span className="att-muted">{a.year}</span>
                      </td>
                      <td className={`tabular-nums font-bold ${a.days > 0 ? "text-[var(--att-green-dark)]" : "text-[var(--att-red)]"}`}>{a.days > 0 ? `+${a.days}` : a.days}</td>
                      <td className="text-sm">{a.remark}</td>
                      <td className="text-xs">{a.by}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
        <Card title={`Leave history ${year}`} icon={History} iconTone="grey" actions={<a className="btn btn-ghost btn-sm" href={`/api/attendance/export?report=history&from=${year}-01-01&to=${year}-12-31`}>CSV</a>} pad={false}>
          {history.length === 0 ? (
            <p className="px-5 py-4 text-sm att-muted">No leave this year yet.</p>
          ) : (
            <div className="att-scroll">
              <table className="att-table">
                <thead>
                  <tr>
                    <th>Person</th>
                    <th>Type</th>
                    <th>Dates</th>
                    <th>Days</th>
                    <th>Status</th>
                    <th>Decided by</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((h) => (
                    <tr key={h.id}>
                      <td className="font-semibold">{h.person}</td>
                      <td>{h.typeName}</td>
                      <td className="whitespace-nowrap">
                        {h.startDate === h.endDate ? formatDay(h.startDate) : `${formatDay(h.startDate)} – ${formatDay(h.endDate)}`}
                        {h.halfDay !== "none" && <span className="att-muted"> ({h.halfDay} half)</span>}
                      </td>
                      <td className="tabular-nums">{h.days}</td>
                      <td>
                        <RequestStatus status={h.status} />
                      </td>
                      <td className="text-xs">
                        {h.decidedBy ?? ""}
                        {h.remark && <span className="att-muted"> · “{h.remark}”</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
