import Link from "next/link";
import type { TicketCard } from "@/lib/design/tickets";
import { addDays, dueHealth, istDate, weekdayOf } from "@/lib/design/rules";
import { formatDay } from "../ui";

const HEALTH = {
  overdue: { bg: "#dc2626", label: "Overdue" },
  soon: { bg: "#d97706", label: "Due within 24 hours" },
  ok: { bg: "#003F8A", label: "On track" },
  done: { bg: "#059669", label: "Delivered" },
  none: { bg: "#64748b", label: "No deadline" },
} as const;
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/**
 * A Monday-first month of IST days with each ticket on its deadline day, coloured by how the deadline looks. On phones the same tickets
 * show as a list by day instead.
 */
export function MonthGrid({ month, tickets }: { month: string; tickets: TicketCard[] }) {
  const first = `${month}-01`;
  const start = addDays(first, -weekdayOf(first));
  // Whole weeks, from the Monday on or before the 1st up to the Sunday on or after the month's last day.
  const days: string[] = [];
  for (let d = start; d.slice(0, 7) <= month || weekdayOf(d) !== 0; d = addDays(d, 1)) days.push(d);
  const today = istDate();
  const byDay = new Map<string, TicketCard[]>();
  for (const t of tickets) {
    if (!t.dueAt) continue;
    const day = istDate(new Date(t.dueAt));
    byDay.set(day, [...(byDay.get(day) ?? []), t]);
  }
  const chip = (t: TicketCard) => {
    const h = HEALTH[dueHealth(t.dueAt, t.status)];
    return (
      <Link key={t.id} href={`/design/admin/tickets/${t.id}`} className="block truncate rounded px-1.5 py-0.5 text-[0.7rem] font-semibold text-white hover:opacity-90" style={{ background: h.bg }} title={`${t.number} ${t.title} · ${h.label}`}>
        {t.number} {t.title}
      </Link>
    );
  };
  const inMonth = [...byDay.keys()].filter((d) => d.slice(0, 7) === month).sort();

  return (
    <div>
      <ul className="mb-3 flex flex-wrap gap-3 text-xs" aria-label="Legend">
        {(["overdue", "soon", "ok", "done"] as const).map((k) => (
          <li key={k} className="flex items-center gap-1.5">
            <span className="h-3 w-3 rounded-sm" style={{ background: HEALTH[k].bg }} aria-hidden />
            {HEALTH[k].label}
          </li>
        ))}
      </ul>

      <div className="ds-card hidden overflow-hidden md:block">
        <div className="grid grid-cols-7 border-b border-[var(--ds-line)] bg-[#fafafa]">
          {WEEKDAYS.map((w) => (
            <div key={w} className="px-2 py-2 text-center text-xs font-bold ds-muted">
              {w}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {days.map((d) => {
            const list = byDay.get(d) ?? [];
            const other = d.slice(0, 7) !== month;
            return (
              <div key={d} className={`min-h-28 border-b border-r border-[var(--ds-line)] p-1.5 ${other ? "bg-[#fafafa]" : "bg-white"}`}>
                <p className={`mb-1 text-xs ${d === today ? "inline-grid h-6 w-6 place-items-center rounded-full bg-[var(--ds-navy)] font-bold text-white" : other ? "text-gray-400" : "font-semibold text-ink"}`}>{Number(d.slice(8))}</p>
                <div className="flex flex-col gap-1">
                  {list.slice(0, 4).map(chip)}
                  {list.length > 4 && <span className="text-[0.7rem] ds-muted">+{list.length - 4} more</span>}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex flex-col gap-3 md:hidden">
        {inMonth.length === 0 ? (
          <p className="ds-card px-4 py-6 text-center text-sm ds-muted">Nothing due this month.</p>
        ) : (
          inMonth.map((d) => (
            <section key={d} className="ds-card p-3">
              <h3 className={`mb-2 text-sm font-bold ${d === today ? "text-[var(--ds-navy)]" : "text-ink"}`}>
                {formatDay(d)}
                {d === today ? " · today" : ""}
              </h3>
              <div className="flex flex-col gap-1.5">{byDay.get(d)!.map(chip)}</div>
            </section>
          ))
        )}
      </div>
    </div>
  );
}
