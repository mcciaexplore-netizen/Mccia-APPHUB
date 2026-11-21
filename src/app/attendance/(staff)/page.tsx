import Link from "next/link";
import { CheckInCard } from "@/components/attendance/home/CheckInCard";
import { Feed } from "@/components/attendance/home/Feed";
import { TodayBoardView } from "@/components/attendance/TodayBoardView";
import { Card, DayBadge, LinkTabs, PageHeader } from "@/components/attendance/ui";
import { requireMember } from "@/lib/attendance/dal";
import { todayCard } from "@/lib/attendance/checkin";
import { personDays } from "@/lib/attendance/days";
import { feed, todayBoard } from "@/lib/attendance/overview";
import { pendingCountFor } from "@/lib/attendance/approvals";
import { STATUS_TONE, planLabel } from "@/lib/attendance/calendar";
import { addDays, formatDayShort, formatHours, istClock, istDay } from "@/lib/attendance/time";

export const metadata = { title: "Attendance · MCCIA App Hub" };

/** Home: My Space (check in/out, the next 7 days, recent days, the feed) and Team (who is where today). */
export default async function HomePage({ searchParams }: PageProps<"/attendance">) {
  const user = await requireMember();
  const sp = await searchParams;
  const tab = sp.tab === "team" ? "team" : "me";
  const tabs = (
    <LinkTabs
      current={tab}
      tabs={[
        { key: "me", label: "My Space", href: "/attendance" },
        { key: "team", label: "Team", href: "/attendance?tab=team" },
      ]}
    />
  );

  if (tab === "team") {
    const board = await todayBoard();
    return (
      <>
        <PageHeader title="Team today" subtitle="Who is in the office, working from home, on leave, or not in yet." actions={tabs} />
        <TodayBoardView board={board} />
      </>
    );
  }

  const today = istDay();
  const [card, ahead, recent, f, waiting] = await Promise.all([
    todayCard(user.id),
    personDays(user.id, today, addDays(today, 6)),
    personDays(user.id, addDays(today, -7), addDays(today, -1)),
    feed(user.id),
    pendingCountFor(user.id),
  ]);
  return (
    <>
      <PageHeader title={`Hello, ${user.name.split(/\s+/)[0]}`} actions={tabs} />
      {waiting > 0 && (
        <Link href="/attendance/more/approvals" className="att-card mb-5 flex items-center justify-between gap-3 border-[var(--att-amber)] bg-[var(--att-amber-tint)] px-5 py-3 text-sm font-semibold text-[#92400e]">
          {waiting} request{waiting === 1 ? "" : "s"} from your team waiting for you <span aria-hidden>→</span>
        </Link>
      )}
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex min-w-0 flex-col gap-5">
          <CheckInCard card={card} />
          <Card title="Work schedule · next 7 days" pad={false}>
            <ul className="divide-y divide-[var(--att-line)]">
              {ahead.views.map((v) => (
                <li key={v.day} className="flex items-center gap-3 px-5 py-2.5 text-sm">
                  <span className={`att-st-${STATUS_TONE[v.kind === "working" ? (v.leave?.half === "none" ? "leave" : v.wfh ? "wfh" : "present") : v.kind]} grid h-8 w-12 shrink-0 place-items-center rounded-md text-[0.7rem] font-bold`}>
                    {formatDayShort(v.day).split(" ")[0]}
                  </span>
                  <span className="w-20 shrink-0 font-semibold text-ink">{formatDayShort(v.day).split(" ").slice(1).join(" ")}</span>
                  <span className="flex-1 att-muted">{v.day === today ? `Today · ${planLabel(v)}` : planLabel(v)}</span>
                </li>
              ))}
            </ul>
          </Card>
          <Card title="Recent activity" actions={<Link href="/attendance/more/summary" className="text-sm font-semibold text-[var(--att-blue)]">Full summary →</Link>} pad={false}>
            <ul className="divide-y divide-[var(--att-line)]">
              {[...recent.views].reverse().map((v) => (
                <li key={v.day} className="flex flex-wrap items-center gap-3 px-5 py-2.5 text-sm">
                  <span className="w-24 shrink-0 font-semibold text-ink">{formatDayShort(v.day)}</span>
                  <DayBadge view={v} />
                  <span className="flex-1 text-right tabular-nums att-muted">
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
    </>
  );
}
