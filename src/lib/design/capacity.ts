/**
 * Who has room for more work, as pure functions over plain data (the server loads the data; the unit tests feed it directly).
 *   - suggestAssignee: the designer with the lowest load-to-capacity ratio over the next working week. Load is the hours of work left on
 *     their active tickets (estimate, else the design type's typical effort, minus time already logged); capacity is their daily hours on
 *     the working days that are not holidays or their own leave.
 *   - workloadGrid: each designer's hours per day for the next days, spreading each open ticket's remaining work evenly over the working
 *     days left before its deadline (all of it today when it is already late), so an overloaded day shows as more than they can do.
 */
import { addDays, weekdayOf, type WorkingDay } from "./rules";

export type CapDesigner = { id: string; name: string; dailyHours: number; leaves: { start: string; end: string }[] };
export type CapTicket = { id: string; number: string; title: string; assigneeId: string | null; dueDay: string | null; remainingHours: number };

export const HORIZON_DAYS = 7;

export const remainingHours = (estimate: number | null, typicalEffort: number | null, spentSeconds: number) =>
  Math.max(0.5, (estimate ?? typicalEffort ?? 4) - spentSeconds / 3600);

const onLeave = (d: CapDesigner, day: string) => d.leaves.some((l) => l.start <= day && day <= l.end);

/** The working days from `today` (inclusive) for `count` calendar days, skipping non-working weekdays and holidays. */
export function workingDays(today: string, count: number, schedule: Record<number, WorkingDay>, holidays: Set<string>): string[] {
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const day = addDays(today, i);
    if (schedule[weekdayOf(day)]?.isWorking && !holidays.has(day)) out.push(day);
  }
  return out;
}

export function suggestAssignee(designers: CapDesigner[], tickets: CapTicket[], days: string[]): CapDesigner | null {
  let best: CapDesigner | null = null;
  let bestRatio = Infinity;
  for (const d of designers) {
    const capacity = days.filter((day) => !onLeave(d, day)).length * (d.dailyHours || 8);
    if (capacity <= 0) continue;
    const load = tickets.filter((t) => t.assigneeId === d.id).reduce((s, t) => s + t.remainingHours, 0);
    const ratio = load / capacity;
    if (ratio < bestRatio) {
      best = d;
      bestRatio = ratio;
    }
  }
  return best;
}

export type WorkloadCell = { day: string; hours: number; capacity: number; tickets: { id: string; number: string; title: string; hours: number }[] };
export type WorkloadRow = { designer: { id: string; name: string; dailyHours: number }; cells: WorkloadCell[]; totalHours: number; lateTickets: number };

export function workloadGrid(designers: CapDesigner[], tickets: CapTicket[], days: string[], today: string): WorkloadRow[] {
  return designers.map((d) => {
    const cells: WorkloadCell[] = days.map((day) => ({ day, hours: 0, capacity: onLeave(d, day) ? 0 : d.dailyHours || 8, tickets: [] }));
    let late = 0;
    for (const t of tickets.filter((x) => x.assigneeId === d.id)) {
      if (t.dueDay && t.dueDay < today) late++;
      // The working days this ticket can still be worked on: up to its deadline (at least the first one, today when late or undated far out).
      let span = cells.filter((c) => c.capacity > 0 && (!t.dueDay || c.day <= t.dueDay));
      if (t.dueDay && t.dueDay < today) span = cells.filter((c) => c.capacity > 0).slice(0, 1);
      if (!span.length) span = cells.slice(0, 1);
      const share = t.remainingHours / span.length;
      for (const c of span) {
        c.hours += share;
        c.tickets.push({ id: t.id, number: t.number, title: t.title, hours: Math.round(share * 10) / 10 });
      }
    }
    for (const c of cells) c.hours = Math.round(c.hours * 10) / 10;
    return { designer: { id: d.id, name: d.name, dailyHours: d.dailyHours }, cells, totalHours: Math.round(cells.reduce((s, c) => s + c.hours, 0) * 10) / 10, lateTickets: late };
  });
}

/** The colour of a day's load: green under 6 hours, amber 6 to 8, red over 8 (or over the person's own hours, if fewer). */
export function loadTone(hours: number, capacity: number): "free" | "full" | "over" | "off" {
  if (capacity <= 0) return hours > 0 ? "over" : "off";
  const limit = Math.min(8, capacity);
  if (hours > limit) return "over";
  if (hours >= Math.min(6, limit * 0.75)) return "full";
  return "free";
}
