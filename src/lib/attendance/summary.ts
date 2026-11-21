/**
 * Counting a run of days for the monthly report and the attendance summary. Pure.
 *
 * Working days are Mon-Fri and working Saturdays, less holidays. A half day counts 0.5 present and 0.5 absent (or 0.5 leave with half-day
 * leave). A missed check-out counts absent until regularized. Holidays and weekly offs worked are counted as extra-work days, not present.
 * Days still to come are not counted.
 */

import type { DayView } from "./calendar";
import { round2 } from "./time";

export type MonthLine = { userId: string; name: string; workingDays: number; present: number; absent: number; late: number; earlyOut: number; leave: number; wfh: number; extraWork: number; hours: number };

export function tally(views: readonly DayView[]): Omit<MonthLine, "userId" | "name"> {
  const t = { workingDays: 0, present: 0, absent: 0, late: 0, earlyOut: 0, leave: 0, wfh: 0, extraWork: 0, hours: 0 };
  for (const v of views) {
    if (v.status === "upcoming") continue;
    if (v.kind === "working") t.workingDays++;
    const r = v.record;
    if (r?.isLate) t.late++;
    if (r?.isEarlyOut) t.earlyOut++;
    t.hours += r?.hoursWorked ?? 0;
    if (r?.isExtraWork && r.checkOut) {
      t.extraWork++;
      continue;
    }
    switch (v.status) {
      case "present":
        t.present++;
        break;
      case "wfh":
        t.wfh++;
        break;
      case "absent":
        t.absent++;
        break;
      case "leave":
        t.leave++;
        break;
      case "half_day":
        t.present += 0.5;
        if (v.leave) t.leave += 0.5;
        else t.absent += 0.5;
        break;
      default:
        break;
    }
  }
  return { ...t, hours: round2(t.hours) };
}

