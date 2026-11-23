import Link from "next/link";
import { CalendarDays, History } from "lucide-react";
import { CheckInCard } from "@/components/attendance/home/CheckInCard";
import { Feed } from "@/components/attendance/home/Feed";
import { TodayBoardView } from "@/components/attendance/TodayBoardView";
import { Card, DayBadge, LinkTabs, PageHeader } from "@/components/attendance/ui";
import { requireMember } from "@/lib/attendance/dal";
import { todayCard } from "@/lib/attendance/checkin";
import { personDays } from "@/lib/attendance/days";
import { feed, todayBoard } from "@/lib/attendance/overview";
import { pendingCountFor } from "@/lib/attendance/approvals";
import { planLabel, type DayView } from "@/lib/attendance/calendar";
import { addDays, formatDayShort, formatHours, formatLongDate, greetingFor, istClock, istDay, istMinutes, weekdayName } from "@/lib/attendance/time";

export const metadata = { title: "Attendance · MCCIA App Hub" };

/** The colour of a day in the work schedule: green working, grey weekly off, purple holiday, blue leave, teal WFH, amber half-day leave. */
function planTone(v: DayView): { dot: string; text: string } {
  if (v.leave?.half === "none") return { dot: "var(--att-info)", text: "text-[var(--att-info)]" };
  if (v.kind === "holiday") return { dot: "var(--att-purple)", text: "text-[var(--att-purple)]" };
  if (v.kind === "weekly_off") return { dot: "#9ca3af", text: "text-gray-500" };
  if (v.leave) return { dot: "var(--att-amber)", text: "text-[#b45309]" };
  if (v.wfh) return { dot: "var(--att-teal)", text: "text-[#0f766e]" };
  return { dot: "var(--att-primary)", text: "text-[var(--att-primary-2)]" };
}

/** Home: the greeting, the check-in card, the next 7 days, recent days and the feed (My Space); who is where today (Team). */
export default async function HomePage({ searchParams }: PageProps<"/attendance">) {
  const user = await requireMember();
  const sp = await searchParams;
  const tab = sp.tab === "team" ? "team" : "me";
  const today = istDay();
  const tabs = (
    <LinkTabs
      current={tab}
      tabs={[
        { key: "me", label: "My Space", href: "/attendance" },
        { key: "team", label: "Team", href: "/attendance?tab=team" },
      ]}
    />
  );
  const dateChip = (
    <span className="inline-flex items-center gap-2 rounded-xl border border-[var(--att-line)] bg-white px-4 py-2 text-sm font-semibold text-gray-700 shadow-sm">
      <CalendarDays size={16} className="text-[var(--att-primary)]" aria-hidden /> {formatLongDate(today)}
    </span>
  );

  if (tab === "team") {
    const board = await todayBoard();
    return (
      <>
        <PageHeader title="Team today" subtitle="Who is in the office, working from home, on leave, or not in yet." actions={dateChip} />
        <div className="mb-6">{tabs}</div>
        <TodayBoardView board={board} />
      </>
    );
  }

  const [card, ahead, recent, f, waiting] = await Promise.all([
    todayCard(user.id),
    personDays(user.id, today, addDays(today, 6)),
    personDays(user.id, addDays(today, -7), addDays(today, -1)),
    feed(user.id),
    pendingCountFor(user.id),
  ]);
  return (
    <>
      <PageHeader title={`${greetingFor(istMinutes())}, ${user.name.split(/\s+/)[0]}`} subtitle="Here's your attendance overview." actions={dateChip} />
      <div className="mb-6">{tabs}</div>
      {waiting > 0 && (
        <Link href="/attendance/more/approvals" className="att-card mb-6 flex items-center justify-between gap-3 border-[var(--att-amber)] bg-[var(--att-amber-tint)] px-6 py-3 text-sm font-semibold text-[#92400e]">
          {waiting} request{waiting === 1 ? "" : "s"} from your team waiting for you <span aria-hidden>→</span>
        </Link>
      )}
      <div className="flex flex-col gap-6">
        <CheckInCard card={card} userId={user.id} />
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.65fr)_minmax(0,1fr)]">
          <div className="flex min-w-0 flex-col gap-6">
            <Card
              title="Work Schedule – Next 7 Days"
              icon={CalendarDays}
              iconTone="green"
              actions={
                <Link href="/attendance/more/summary" className="text-sm font-semibold text-[var(--att-primary)] hover:underline">
                  View Calendar →
                </Link>
              }
              pad={false}
            >
              <ul className="divide-y divide-[var(--att-line)]">
                {ahead.views.map((v) => {
                  const t = planTone(v);
                  return (
                    <li key={v.day} className="flex items-center gap-4 px-6 py-3.5 text-sm">
                      <span className="att-day-pill">{weekdayName(v.day)}</span>
                      <span className="w-16 shrink-0 font-semibold text-gray-900">{formatDayShort(v.day).split(" ").slice(1).join(" ")}</span>
                      <span className={`flex min-w-0 flex-1 items-center gap-2 font-medium ${t.text}`}>
                        <span className="att-dot" style={{ background: t.dot }} aria-hidden />
                        <span className="truncate">{planLabel(v)}</span>
                      </span>
                      {v.day === today && <span className="text-xs font-semibold text-gray-400">Today</span>}
                    </li>
                  );
                })}
              </ul>
            </Card>
            <Card title="Recent activity" subtitle="The last 7 days" icon={History} iconTone="grey" pad={false}>
              <ul className="divide-y divide-[var(--att-line)]">
                {[...recent.views].reverse().map((v) => (
                  <li key={v.day} className="flex flex-wrap items-center gap-3 px-6 py-3 text-sm">
                    <span className="w-24 shrink-0 font-semibold text-gray-900">{formatDayShort(v.day)}</span>
                    <DayBadge view={v} />
                    <span className="flex-1 text-right tabular-nums text-gray-500">
                      {v.record?.checkIn ? `${istClock(v.record.checkIn)} – ${v.record.checkOut ? istClock(v.record.checkOut) : "?"}` : ""}
                      {v.record?.hoursWorked != null ? ` · ${formatHours(v.record.hoursWorked)}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          </div>
          <Feed today={f.today} upcoming={f.upcoming} announcements={f.announcements} wishesForMe={f.wishesForMe} />
        </div>
      </div>
    </>
  );
}
