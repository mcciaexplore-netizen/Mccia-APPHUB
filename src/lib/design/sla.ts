/**
 * DesignDesk's working calendar and the deadlines and priorities that follow from it, as pure functions (no database: the server loads the
 * hours and holidays and passes them in) so the request form, the server and the unit tests share one copy. Times are IST.
 *
 * Working days: Monday to Friday always; Saturdays only the 1st and 3rd of the month (the 2nd, 4th and 5th are off); Sundays never; a
 * holiday (design_holidays) never. The working schedule table cannot say "1st and 3rd Saturday", so which days are worked is decided here;
 * the table only gives each day's hours (10:00 to 19:00 unless the studio changes them).
 */
import type { Priority } from "@/db/design-schema";
import { addDays, istDate, istMoment, weekdayOf } from "./rules";

const HOUR_MS = 3_600_000;

export type WorkingDay = { isWorking: boolean; startHour: number; endHour: number };
/** Per weekday (0 = Monday): the hours, when the studio has not set its own. (Which days are worked is isWorkingDay's call, not isWorking's.) */
export const DEFAULT_SCHEDULE: Record<number, WorkingDay> = Object.fromEntries(
  [0, 1, 2, 3, 4, 5, 6].map((d) => [d, { isWorking: d < 5, startHour: 10, endHour: 19 }]),
);

const NO_HOLIDAYS: ReadonlySet<string> = new Set();

/** Which Saturday of its month a date is (1st … 5th): the day of the month, counted in weeks. */
export const nthOfMonth = (day: string) => Math.ceil(Number(day.slice(8, 10)) / 7);

/**
 * Whether the studio works on a day (an IST "YYYY-MM-DD", or a moment, taken on the IST calendar): Monday to Friday yes, the 1st and 3rd
 * Saturday of the month yes, other Saturdays and every Sunday no, and never on a holiday.
 */
export function isWorkingDay(date: Date | string, holidays: ReadonlySet<string> = NO_HOLIDAYS): boolean {
  const day = typeof date === "string" ? date : istDate(date);
  if (holidays.has(day)) return false;
  const weekday = weekdayOf(day);
  if (weekday < 5) return true;
  if (weekday === 5) return nthOfMonth(day) === 1 || nthOfMonth(day) === 3;
  return false;
}

/** A day's working hours, from the schedule (the default 10:00 to 19:00 when it has none, or none that make sense). */
export function hoursOn(day: string, schedule: Record<number, WorkingDay>): { startHour: number; endHour: number } {
  const s = schedule[weekdayOf(day)];
  return s && s.endHour > s.startHour ? { startHour: s.startHour, endHour: s.endHour } : { startHour: 10, endHour: 19 };
}

/**
 * When `slaHours` of working time from `start` runs out: only working hours on working days count, and time spent waiting on the requester
 * (`pausedSeconds`) is added on. Gives up (returning the last point reached) after 400 days with no working time.
 */
export function workingDue(start: Date, slaHours: number, schedule: Record<number, WorkingDay>, holidays: ReadonlySet<string>, pausedSeconds = 0): Date {
  let remaining = slaHours * HOUR_MS + pausedSeconds * 1000;
  let t = +start;
  for (let guard = 0; remaining > 0 && guard < 400; guard++) {
    const day = istDate(t);
    const nextDay = +istMoment(addDays(day, 1));
    if (!isWorkingDay(day, holidays)) {
      t = nextDay;
      continue;
    }
    const { startHour, endHour } = hoursOn(day, schedule);
    const open = +istMoment(day, startHour);
    const close = +istMoment(day, endHour);
    if (t < open) t = open;
    if (t >= close) {
      t = nextDay;
      continue;
    }
    const left = close - t;
    if (remaining <= left) return new Date(t + remaining);
    remaining -= left;
    t = nextDay;
  }
  return new Date(t);
}

/** Urgent work (set by a design lead) gets half the usual time (at least two hours). */
export const slaHoursFor = (typeSla: number, priority: Priority) => (priority === "urgent" ? Math.max(2, Math.floor(typeSla / 2)) : typeSla);

// ── The 48-hour buffer ───────────────────────────────────────────────────────

/** Every request needs at least this much notice: 48 hours, counted on working days only (two working days). */
export const BUFFER_HOURS = 48;
/** How long a form may stay open: the server allows a date that was allowed this long ago, so a slow form is not refused at the last step. */
export const FORM_GRACE_HOURS = 3;

/** The first working moment at or after `at` (within a working day's hours). */
function firstWorkingMoment(at: Date, schedule: Record<number, WorkingDay>, holidays: ReadonlySet<string>): number {
  let t = +at;
  for (let guard = 0; guard < 400; guard++) {
    const day = istDate(t);
    const nextDay = +istMoment(addDays(day, 1));
    if (!isWorkingDay(day, holidays)) {
      t = nextDay;
      continue;
    }
    const { startHour, endHour } = hoursOn(day, schedule);
    if (t < +istMoment(day, startHour)) return +istMoment(day, startHour);
    if (t < +istMoment(day, endHour)) return t;
    t = nextDay;
  }
  return t;
}

/**
 * The earliest moment a design can be due when the form is opened at `openedAt`: from the first working moment (opened out of hours, the
 * next opening), 48 hours on, with only working days counting, so the same time two working days later. Monday 10:00 gives Wednesday 10:00;
 * Friday 17:00 gives Tuesday 17:00 (the weekend skipped), or Monday 17:00 when that Saturday is a working one.
 */
export function earliestDelivery(openedAt: Date, schedule: Record<number, WorkingDay>, holidays: ReadonlySet<string> = NO_HOLIDAYS): Date {
  let t = firstWorkingMoment(openedAt, schedule, holidays);
  let remaining = BUFFER_HOURS * HOUR_MS;
  for (let guard = 0; remaining > 0 && guard < 400; guard++) {
    const day = istDate(t);
    const nextDay = +istMoment(addDays(day, 1));
    if (!isWorkingDay(day, holidays)) {
      t = nextDay;
      continue;
    }
    if (remaining <= nextDay - t) return new Date(t + remaining);
    remaining -= nextDay - t;
    t = nextDay;
  }
  return new Date(t);
}

/** Form requests are due at 18:00 IST on the delivery date asked for. */
export const deliveryDueAt = (deliveryDate: string) => istMoment(deliveryDate, 18);

/**
 * The first delivery date the form allows, for a form opened at `openedAt`: the first working day whose 18:00 deadline is at or after the
 * earliest moment. Every date before it is blocked.
 */
export function minDeliveryDate(openedAt: Date, schedule: Record<number, WorkingDay>, holidays: ReadonlySet<string> = NO_HOLIDAYS): string {
  const earliest = earliestDelivery(openedAt, schedule, holidays);
  let day = istDate(earliest);
  if (+deliveryDueAt(day) < +earliest) day = addDays(day, 1);
  for (let guard = 0; guard < 60 && !isWorkingDay(day, holidays); guard++) day = addDays(day, 1);
  return day;
}

// ── Priority ─────────────────────────────────────────────────────────────────

/** Working days after `today`, up to and including the delivery date. */
export function workingDaysUntil(deliveryDate: string, today: string, holidays: ReadonlySet<string> = NO_HOLIDAYS): number {
  let n = 0;
  for (let d = addDays(today, 1), guard = 0; d <= deliveryDate && guard < 800; d = addDays(d, 1), guard++) if (isWorkingDay(d, holidays)) n++;
  return n;
}

/**
 * Priority follows how soon the design is needed, in working days (the form never asks for it): up to 3 working days High, up to 10 Normal,
 * later Low. Anything under 48 working hours cannot be asked for at all (see minDeliveryDate), so it is never Urgent: only a design lead sets
 * that.
 */
export function priorityFor(deliveryDate: string, today: string = istDate(), holidays: ReadonlySet<string> = NO_HOLIDAYS): Exclude<Priority, "urgent"> {
  const days = workingDaysUntil(deliveryDate, today, holidays);
  if (days <= 3) return "high";
  if (days <= 10) return "normal";
  return "low";
}

/** What the form shows as a date is picked: "HIGH — 2 working days from now". */
export function priorityText(deliveryDate: string, today: string = istDate(), holidays: ReadonlySet<string> = NO_HOLIDAYS): string {
  const days = workingDaysUntil(deliveryDate, today, holidays);
  return `${priorityFor(deliveryDate, today, holidays).toUpperCase()} — ${days} working day${days === 1 ? "" : "s"} from now`;
}
