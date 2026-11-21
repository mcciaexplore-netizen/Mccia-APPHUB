import { Download } from "lucide-react";
import { Card, DayBadge, Empty, PageHeader } from "@/components/attendance/ui";
import { requireAdmin } from "@/lib/attendance/dal";
import { listMembers } from "@/lib/attendance/host-adapter";
import { personDays, recordOf } from "@/lib/attendance/days";
import { tally } from "@/lib/attendance/summary";
import { isUuid } from "@/lib/attendance/att.manifest";
import { addDays, daysBetween, formatDayShort, formatHours, isDay, istClock, istDay } from "@/lib/attendance/time";

export const metadata = { title: "Attendance · Attendance Admin" };

const METHOD: Record<string, string> = { ip: "Office network", gps: "GPS", wfh: "WFH", manual: "Regularized" };

/** Anyone's days over a date range: status, in/out times, method, hours and marks. */
export default async function AdminAttendancePage({ searchParams }: PageProps<"/attendance/admin/attendance">) {
  await requireAdmin();
  const sp = await searchParams;
  const today = istDay();
  const members = await listMembers();
  const userId = isUuid(sp.user) && members.some((m) => m.id === sp.user) ? sp.user : (members[0]?.id ?? null);
  let to = isDay(sp.to) ? sp.to : today;
  let from = isDay(sp.from) ? sp.from : addDays(today, -30);
  if (from > to) [from, to] = [to, from];
  if (daysBetween(from, to) > 366) from = addDays(to, -366);
  const data = userId ? await personDays(userId, from, to) : null;
  const t = data ? tally(data.views) : null;
  return (
    <>
      <PageHeader title="Attendance" subtitle="Look up anyone's attendance over a date range." />
      <Card className="mb-5">
        <form method="get" className="grid gap-3 sm:grid-cols-[2fr_1fr_1fr_auto] sm:items-end">
          <label className="flex flex-col gap-1 text-xs font-semibold att-muted">
            Person
            <select name="user" defaultValue={userId ?? ""} className="input">
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold att-muted">
            From
            <input type="date" name="from" defaultValue={from} className="input" />
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold att-muted">
            To
            <input type="date" name="to" defaultValue={to} className="input" />
          </label>
          <button type="submit" className="btn btn-primary">
            Show
          </button>
        </form>
      </Card>
      {!data || !userId ? (
        <Card>
          <Empty title="Nobody to show">Give people the Attendance application first.</Empty>
        </Card>
      ) : (
        <Card
          title={t ? `Present ${t.present} · WFH ${t.wfh} · Leave ${t.leave} · Absent ${t.absent} · Late ${t.late} · Early out ${t.earlyOut} · ${formatHours(t.hours)}` : undefined}
          actions={
            <a href={`/api/attendance/export?report=person&user=${userId}&from=${from}&to=${to}`} className="btn btn-ghost btn-sm">
              <Download size={14} aria-hidden /> CSV
            </a>
          }
          pad={false}
        >
          <div className="att-scroll">
            <table className="att-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Status</th>
                  <th>In</th>
                  <th>Out</th>
                  <th>Method</th>
                  <th>Hours</th>
                  <th>Marks</th>
                </tr>
              </thead>
              <tbody>
                {[...data.views]
                  .reverse()
                  .filter((v) => v.status !== "upcoming")
                  .map((v) => {
                    const r = recordOf(data.data, userId, v.day);
                    return (
                      <tr key={v.day}>
                        <td className="whitespace-nowrap font-semibold">{formatDayShort(v.day)}</td>
                        <td>
                          <DayBadge view={v} />
                        </td>
                        <td className="tabular-nums">{r?.checkInTime ? istClock(r.checkInTime) : "—"}</td>
                        <td className="tabular-nums">{r?.checkOutTime ? istClock(r.checkOutTime) : "—"}</td>
                        <td className="text-xs">
                          {r?.checkInMethod ? METHOD[r.checkInMethod] : ""}
                          {r?.checkInLat != null && (
                            <a className="ml-1 text-[var(--att-blue)]" href={`https://www.openstreetmap.org/?mlat=${r.checkInLat}&mlon=${r.checkInLng}#map=18/${r.checkInLat}/${r.checkInLng}`} target="_blank" rel="noreferrer">
                              map
                            </a>
                          )}
                        </td>
                        <td className="tabular-nums">{r?.hoursWorked != null ? formatHours(Number(r.hoursWorked)) : "—"}</td>
                        <td className="text-xs">
                          {[r?.isLate && "Late", r?.isEarlyOut && "Early out", r?.isExtraWork && "Extra work", r?.regularizationId && "Regularized", v.leave && v.leave.typeName, v.holidayName].filter(Boolean).join(" · ")}
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  );
}
