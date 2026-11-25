import Link from "next/link";
import { Download } from "lucide-react";
import { Card, DayBadge, Kpi, LinkTabs, PageHeader, PlaceDot } from "@/components/attendance/ui";
import { MonthGrid } from "@/components/attendance/MonthGrid";
import { MonthNav } from "@/components/attendance/MonthNav";
import { requireMember } from "@/lib/attendance/dal";
import { personDays } from "@/lib/attendance/days";
import { tally } from "@/lib/attendance/summary";
import { STATUS_LABEL, STATUS_TONE } from "@/lib/attendance/calendar";
import { formatDayShort, formatHours, isMonth, istClock, istDay, monthRange } from "@/lib/attendance/time";

export const metadata = { title: "Attendance summary · Attendance" };

/** A month of the person's days as a calendar (coloured by status) or a list (times, hours, marks), with totals and a CSV download. */
export default async function SummaryPage({ searchParams }: PageProps<"/attendance/more/summary">) {
  const user = await requireMember();
  const sp = await searchParams;
  const today = istDay();
  const month = isMonth(sp.month) ? sp.month : today.slice(0, 7);
  const view = sp.view === "list" ? "list" : "calendar";
  const { from, to } = monthRange(month);
  const { views } = await personDays(user.id, from, to);
  const t = tally(views);
  const byDay = new Map(views.map((v) => [v.day, v]));
  const excess = views.reduce((n, v) => n + (v.record?.excessHours ?? 0), 0);
  const deficit = views.reduce((n, v) => n + (v.record?.deficitHours ?? 0), 0);
  const href = (m: string, v = view) => `/attendance/more/summary?month=${m}&view=${v}`;
  return (
    <>
      <PageHeader
        title="Attendance summary"
        actions={
          <>
            <MonthNav month={month} href={(m) => href(m)} />
            <LinkTabs current={view} tabs={[{ key: "calendar", label: "Calendar", href: href(month, "calendar") }, { key: "list", label: "List", href: href(month, "list") }]} />
            <a href={`/api/attendance/export?report=mine&month=${month}`} className="btn btn-ghost btn-sm">
              <Download size={14} aria-hidden /> CSV
            </a>
          </>
        }
      />
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        <Kpi label="Working days" value={t.workingDays} />
        <Kpi label="Present" value={t.present} tone="green" />
        <Kpi label="WFH" value={t.wfh} tone="teal" />
        <Kpi label="Leave" value={t.leave} tone="blue" />
        <Kpi label="Absent" value={t.absent} tone="red" />
        <Kpi label="Late" value={t.late} tone="amber" />
        <Kpi label="Early out" value={t.earlyOut} tone="amber" />
        <Kpi label="Hours" value={formatHours(t.hours)} />
      </div>
      <p className="-mt-2 mb-5 text-sm att-muted">
        Against your shift this month: <span className="font-semibold text-[var(--att-green-dark)]">+{formatHours(excess)}</span> excess,{" "}
        <span className="font-semibold text-[var(--att-red)]">−{formatHours(deficit)}</span> short.
      </p>
      {view === "calendar" ? (
        <Card>
          <MonthGrid
            month={month}
            today={today}
            cellClass={(d) => {
              const v = byDay.get(d)!;
              return `att-st-${v.missedCheckout ? "red" : STATUS_TONE[v.status]}`;
            }}
            cell={(d) => {
              const v = byDay.get(d)!;
              return (
                <>
                  <span className="font-semibold">{v.missedCheckout ? "Missed out" : v.status === "upcoming" || v.status === "pending" ? "" : STATUS_LABEL[v.status]}</span>
                  {v.record?.checkIn && (
                    <span className="att-cal-extra inline-flex items-center gap-1 tabular-nums">
                      <PlaceDot place={v.record.place ?? null} />
                      {istClock(v.record.checkIn)}–{v.record.checkOut ? istClock(v.record.checkOut) : "?"}
                    </span>
                  )}
                  <span className="att-cal-extra">
                    {v.record?.isLate ? "Late " : ""}
                    {v.record?.isEarlyOut ? "Early" : ""}
                  </span>
                </>
              );
            }}
          />
          <p className="mt-4 flex flex-wrap gap-3 text-xs att-muted">
            {(["present", "wfh", "half_day", "leave", "absent", "holiday", "weekly_off"] as const).map((s) => (
              <span key={s} className="inline-flex items-center gap-1.5">
                <span className={`att-st-${STATUS_TONE[s]} inline-block h-3 w-3 rounded`} aria-hidden /> {STATUS_LABEL[s]}
              </span>
            ))}
            <span className="inline-flex items-center gap-1.5">
              <PlaceDot place="in_office" /> Checked in at the office
            </span>
            <span className="inline-flex items-center gap-1.5">
              <PlaceDot place="remote" /> Checked in remotely
            </span>
          </p>
        </Card>
      ) : (
        <Card pad={false}>
          <div className="att-scroll">
            <table className="att-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Status</th>
                  <th>In</th>
                  <th>Out</th>
                  <th>Location</th>
                  <th>Hours</th>
                  <th>vs shift</th>
                  <th>Marks</th>
                </tr>
              </thead>
              <tbody>
                {views
                  .filter((v) => v.status !== "upcoming")
                  .map((v) => {
                    const r = v.record;
                    return (
                      <tr key={v.day}>
                        <td className="whitespace-nowrap font-semibold">{formatDayShort(v.day)}</td>
                        <td>
                          <DayBadge view={v} />
                        </td>
                        <td className="tabular-nums">{r?.checkIn ? istClock(r.checkIn) : "—"}</td>
                        <td className="tabular-nums">{r?.checkOut ? istClock(r.checkOut) : "—"}</td>
                        <td className="whitespace-nowrap text-xs">
                          {r?.place ? (
                            <span className={`inline-flex items-center gap-1.5 ${r.place === "remote" ? "att-text-remote" : ""}`}>
                              <PlaceDot place={r.place} /> {r.place === "in_office" ? "In office" : "Remote"}
                            </span>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="tabular-nums">{r?.hoursWorked != null ? formatHours(r.hoursWorked) : "—"}</td>
                        <td className="tabular-nums text-xs">
                          {r?.checkOut && r.excessHours ? <span className="text-[var(--att-green-dark)]">+{formatHours(r.excessHours)}</span> : null}
                          {r?.checkOut && r.deficitHours ? <span className="text-[var(--att-red)]">−{formatHours(r.deficitHours)}</span> : null}
                        </td>
                        <td className="text-xs">
                          {[r?.isLate && "Late", r?.isEarlyOut && "Early out", r?.isWfh && "WFH", r?.isExtraWork && "Extra work", v.leave && `${v.leave.typeName}${v.leave.half !== "none" ? ` (${v.leave.half} half)` : ""}`, v.holidayName].filter(Boolean).join(" · ")}
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
      <p className="mt-4 text-xs att-muted">
        A missed check-out counts as absent until it is regularized. <Link href="/attendance/more/regularization" className="font-semibold text-[var(--att-primary)]">Regularize a day →</Link>
      </p>
    </>
  );
}
