import { CalendarDays, ClipboardList, Gift, PartyPopper } from "lucide-react";
import Link from "next/link";
import { Badge, Card, PageHeader } from "@/components/attendance/ui";
import { MyLeaveList } from "@/components/attendance/leave/MyLeaveList";
import { MonthGrid } from "@/components/attendance/MonthGrid";
import { MonthNav } from "@/components/attendance/MonthNav";
import { requireMember } from "@/lib/attendance/dal";
import { balancesFor, compoffSummary, holidaysOfYear, leaveCalendar, myLeaveRequests } from "@/lib/attendance/leave";
import { listMembers } from "@/lib/attendance/host-adapter";
import { leaveColor } from "@/lib/attendance/att.manifest";
import { eachDay, formatDay, formatDayShort, isMonth, istDay, monthRange } from "@/lib/attendance/time";

export const metadata = { title: "Leave · Attendance" };

/** Leave: balances per type, my requests, comp-off balance, the team calendar and the holidays. */
export default async function LeavePage({ searchParams }: PageProps<"/attendance/leave">) {
  const user = await requireMember();
  const sp = await searchParams;
  const today = istDay();
  const month = isMonth(sp.month) ? sp.month : today.slice(0, 7);
  const year = Number(today.slice(0, 4));
  const { from, to } = monthRange(month);
  const members = await listMembers();
  const [balances, requests, co, cal, hols] = await Promise.all([
    balancesFor(user.id, year),
    myLeaveRequests(user.id),
    compoffSummary(user.id),
    leaveCalendar(
      members.map((m) => m.id),
      from,
      to,
    ),
    holidaysOfYear(year),
  ]);
  const names = new Map(members.map((m) => [m.id, m.name]));
  const onDay = (d: string) => cal.filter((l) => l.startDate <= d && l.endDate >= d);
  const activeCo = co.states.filter((s) => s.remaining > 0 && !s.expired);

  return (
    <>
      <PageHeader title="Leave" subtitle={`Your ${year} balances, requests and the team's leave.`} actions={<Link href="/attendance/leave/apply" className="btn btn-primary">Apply leave</Link>} />
      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {balances.map((b) => (
          <div key={b.type.id} className="att-card relative overflow-hidden px-5 py-4">
            <span className="absolute inset-y-0 left-0 w-1" style={{ background: leaveColor(b.type.color) }} aria-hidden />
            <p className="att-label">{b.type.name}</p>
            <p className="text-[1.9rem] font-extrabold tabular-nums leading-tight text-ink">{b.balance}</p>
            <p className="text-xs att-muted">
              {b.type.isCompoff
                ? "earned, not yet used or expired"
                : `of ${b.accrued + b.carried + b.adjusted} · ${b.booked} taken${b.pending ? ` · ${b.pending} pending` : ""}${b.carried ? ` · ${b.carried} carried` : ""}${b.adjusted ? ` · ${b.adjusted > 0 ? "+" : ""}${b.adjusted} adjusted` : ""}`}
            </p>
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-5">
        <Card title="My leave requests" icon={ClipboardList} iconTone="green" pad={false}>
          <MyLeaveList items={requests} />
        </Card>

        <Card title={`Comp-off balance: ${co.balance} day${co.balance === 1 ? "" : "s"}`} icon={Gift} iconTone="orange" actions={<Link href="/attendance/more/compoff" className="text-sm font-semibold text-[var(--att-primary)]">Claim a comp-off →</Link>}>
          {activeCo.length === 0 ? (
            <p className="text-sm att-muted">No comp-offs to use. Working a holiday or weekly off earns one.</p>
          ) : (
            <ul className="flex flex-col gap-1.5 text-sm">
              {activeCo.map((s) => (
                <li key={s.id} className="flex flex-wrap justify-between gap-2">
                  <span>
                    {s.remaining} day{s.remaining === 1 ? "" : "s"} for working {formatDay(s.workedDate)}
                  </span>
                  <span className="att-muted">use by {formatDay(s.expiryDate)}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-xs att-muted">Comp-off leave uses the oldest (soonest to expire) first.</p>
        </Card>

        <Card title="Team calendar" icon={CalendarDays} iconTone="blue" actions={<MonthNav month={month} href={(m) => `/attendance/leave?month=${m}`} />}>
          <MonthGrid
            month={month}
            today={today}
            cell={(d) => {
              const ls = onDay(d);
              return (
                <span className="att-cal-extra flex flex-col gap-0.5">
                  {ls.slice(0, 3).map((l, i) => (
                    <span key={i} className="truncate rounded px-1 text-[0.65rem] font-semibold text-white" style={{ background: leaveColor(l.color) }} title={`${names.get(l.userId)}: ${l.typeName}`}>
                      {names.get(l.userId)?.split(" ")[0] ?? "?"}
                      {l.halfDay !== "none" ? " ½" : ""}
                    </span>
                  ))}
                  {ls.length > 3 && <span className="text-[0.62rem] att-muted">+{ls.length - 3} more</span>}
                </span>
              );
            }}
          />
          {cal.length > 0 && (
            <ul className="mt-4 flex flex-col gap-1 text-sm sm:hidden">
              {eachDay(from, to)
                .filter((d) => onDay(d).length)
                .map((d) => (
                  <li key={d}>
                    <span className="font-semibold">{formatDayShort(d)}:</span> {onDay(d).map((l) => names.get(l.userId)).join(", ")}
                  </li>
                ))}
            </ul>
          )}
        </Card>

        <Card title={`Holidays ${year}`} icon={PartyPopper} iconTone="purple" pad={false}>
          {hols.length === 0 ? (
            <p className="px-5 py-4 text-sm att-muted">HR has not added this year&apos;s holidays yet.</p>
          ) : (
            <ul className="divide-y divide-[var(--att-line)]">
              {hols.map((h) => (
                <li key={h.id} className={`flex items-center gap-3 px-5 py-2.5 text-sm ${h.date < today ? "opacity-60" : ""}`}>
                  <span className="w-28 shrink-0 font-semibold">{formatDayShort(h.date)}</span>
                  <span className="flex-1">{h.name}</span>
                  {h.isOptional && <Badge tone="amber">Optional</Badge>}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
