import Link from "next/link";
import { ChevronLeft, ChevronRight, Download } from "lucide-react";
import { DailyReportView } from "@/components/attendance/admin/DailyReportView";
import { Kpi, PageHeader } from "@/components/attendance/ui";
import { requireAdmin } from "@/lib/attendance/dal";
import { dailyReport } from "@/lib/attendance/reports";
import { addDays, formatDay, isDay, istDay } from "@/lib/attendance/time";

export const metadata = { title: "Daily Report · Attendance Admin" };

/**
 * One day's attendance: everyone who checked in that day, with check-in and check-out times, where they checked in (in office or remote),
 * hours and status; totals on top, a CSV of the day. Days after today have nothing to show, so the date stops at today.
 */
export default async function DailyReportPage({ searchParams }: PageProps<"/attendance/admin/daily-report">) {
  await requireAdmin();
  const sp = await searchParams;
  const today = istDay();
  const day = isDay(sp.date) && sp.date <= today ? sp.date : today;
  const rows = await dailyReport(day);
  const href = (d: string) => (d === today ? "/attendance/admin/daily-report" : `/attendance/admin/daily-report?date=${d}`);
  const next = addDays(day, 1);
  return (
    <>
      <PageHeader
        title="Daily Report"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex items-center gap-1" data-testid="daily-nav">
              <Link href={href(addDays(day, -1))} className="btn btn-ghost btn-sm" aria-label="Previous day">
                <ChevronLeft size={16} aria-hidden /> Prev
              </Link>
              <span className="min-w-[7.5rem] text-center text-sm font-bold text-ink" data-testid="daily-date">
                {formatDay(day)}
              </span>
              {next <= today ? (
                <Link href={href(next)} className="btn btn-ghost btn-sm" aria-label="Next day">
                  Next <ChevronRight size={16} aria-hidden />
                </Link>
              ) : (
                <span className="btn btn-ghost btn-sm pointer-events-none opacity-40" aria-disabled="true">
                  Next <ChevronRight size={16} aria-hidden />
                </span>
              )}
            </div>
            {day !== today && (
              <Link href={href(today)} className="btn btn-ghost btn-sm" data-testid="daily-today">
                Today
              </Link>
            )}
            <a href={`/api/attendance/export?report=daily&date=${day}`} className="btn btn-primary btn-sm" data-testid="daily-csv">
              <Download size={14} aria-hidden /> Export CSV
            </a>
          </div>
        }
      />
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label={day === today ? "Checked In Today" : "Checked In"} value={rows.length} />
        <Kpi label="In Office" value={rows.filter((r) => r.place === "in_office").length} tone="green" />
        <Kpi label="Remote" value={rows.filter((r) => r.place === "remote").length} tone="orange" />
        <Kpi label="Late" value={rows.filter((r) => r.isLate).length} tone="amber" />
      </div>
      <DailyReportView key={day} rows={rows} />
    </>
  );
}
