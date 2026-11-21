import Link from "next/link";
import { ChevronLeft, ChevronRight, History } from "lucide-react";
import { Card, PageHeader, RequestStatus } from "@/components/attendance/ui";
import { TimeView } from "@/components/attendance/time/TimeView";
import { requireMember } from "@/lib/attendance/dal";
import { activeProjects, myWeeks, weekView } from "@/lib/attendance/timesheets";
import { addDays, formatDay, formatHours, isDay, istDay, weekStart } from "@/lib/attendance/time";

export const metadata = { title: "Time · Attendance" };

/** Time: log hours by project and day, see the week, submit it for approval; recent weeks and their status. */
export default async function TimePage({ searchParams }: PageProps<"/attendance/time">) {
  const user = await requireMember();
  const sp = await searchParams;
  const today = istDay();
  const week = weekStart(isDay(sp.week) ? sp.week : today);
  const [view, projects, weeks] = await Promise.all([weekView(user.id, week), activeProjects(), myWeeks(user.id)]);
  return (
    <>
      <PageHeader
        title="Time"
        subtitle={`Week of ${formatDay(week)} – ${formatDay(addDays(week, 6))}`}
        actions={
          <div className="inline-flex items-center gap-1">
            <Link href={`/attendance/time?week=${addDays(week, -7)}`} className="btn btn-ghost btn-sm" aria-label="Previous week">
              <ChevronLeft size={16} />
            </Link>
            <Link href="/attendance/time" className="btn btn-ghost btn-sm">
              This week
            </Link>
            <Link href={`/attendance/time?week=${addDays(week, 7)}`} className="btn btn-ghost btn-sm" aria-label="Next week">
              <ChevronRight size={16} />
            </Link>
          </div>
        }
      />
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_18rem]">
        <TimeView week={week} today={today} projects={projects.map((p) => ({ id: p.id, name: p.name }))} logs={view.logs} status={view.sheet?.status ?? null} remark={view.sheet?.approverRemark ?? null} total={view.total} />
        <Card title="Recent weeks" icon={History} iconTone="grey" pad={false}>
          {weeks.length === 0 ? (
            <p className="px-5 py-4 text-sm att-muted">No timesheets yet.</p>
          ) : (
            <ul className="divide-y divide-[var(--att-line)]">
              {weeks.map((w) => (
                <li key={w.start}>
                  <Link href={`/attendance/time?week=${w.start}`} className="flex items-center justify-between gap-2 px-5 py-2.5 text-sm hover:bg-[var(--att-primary-tint)]">
                    <span>
                      {formatDay(w.start)} <span className="att-muted">· {formatHours(w.total)}</span>
                    </span>
                    <RequestStatus status={w.status} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
