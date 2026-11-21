import "server-only";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "./db";
import { attendance, type AttendanceRow } from "@/db/attendance-schema";
import { AttError } from "./dal";
import { getSettings, profileOf, type ShiftRules } from "./config";
import { loadDays, recordOf, viewOf } from "./days";
import { computeDay, decideCheckIn, decideCheckOut, isLate, expectedWindow, validPosition, type Position } from "./checkin-rules";
import { dayKind, type DayKind } from "./calendar";
import { istDay, istMinutes } from "./time";

/**
 * Checking in and out (rules in checkin-rules.ts). The unique (user, day) index makes a second check-in impossible even when two taps race;
 * the check-out only fills an empty check-out, so it cannot happen twice either. The IP comes from the request (set by Vercel), the
 * position from the browser.
 */

export type TodayCard = {
  today: string;
  kind: DayKind;
  holidayName: string | null;
  shift: Pick<ShiftRules, "name" | "startTime" | "endTime" | "graceMinutes" | "fullDayHours">;
  record: { checkIn: string | null; checkOut: string | null; method: string | null; isLate: boolean; isEarlyOut: boolean; isWfh: boolean; isExtraWork: boolean; hoursWorked: number | null } | null;
  leaveToday: "none" | "first" | "second" | null;
  wfhApproved: boolean;
};

async function todayFacts(userId: string) {
  const today = istDay();
  const [profile, data] = await Promise.all([profileOf(userId), loadDays([userId], today, today)]);
  const view = viewOf(data, userId, today, today);
  return { today, profile, data, view, record: recordOf(data, userId, today) };
}

const cardRecord = (r: AttendanceRow | null): TodayCard["record"] =>
  r
    ? {
        checkIn: r.checkInTime?.toISOString() ?? null,
        checkOut: r.checkOutTime?.toISOString() ?? null,
        method: r.checkInMethod,
        isLate: r.isLate,
        isEarlyOut: r.isEarlyOut,
        isWfh: r.isWfh,
        isExtraWork: r.isExtraWork,
        hoursWorked: r.hoursWorked == null ? null : Number(r.hoursWorked),
      }
    : null;

/** What the check-in card shows. */
export async function todayCard(userId: string): Promise<TodayCard> {
  const f = await todayFacts(userId);
  const s = f.profile.shift;
  return {
    today: f.today,
    kind: f.view.kind,
    holidayName: f.view.holidayName ?? null,
    shift: { name: s.name, startTime: s.startTime, endTime: s.endTime, graceMinutes: s.graceMinutes, fullDayHours: s.fullDayHours },
    record: cardRecord(f.record),
    leaveToday: f.view.leave?.half ?? null,
    wfhApproved: f.view.wfh,
  };
}

const cleanPosition = (p: unknown): Position | null => (validPosition(p) ? { lat: Number(p.lat), lng: Number(p.lng), accuracy: Number.isFinite(p.accuracy) ? Number(p.accuracy) : null } : null);

export async function checkIn(userId: string, input: { ip: string | null; position: unknown }): Promise<{ message: string }> {
  const [f, settings] = await Promise.all([todayFacts(userId), getSettings()]);
  const position = cleanPosition(input.position);
  const kind = dayKind(f.today, f.data.cal);
  const d = decideCheckIn({ alreadyCheckedIn: !!f.record?.checkInTime, leaveToday: f.view.leave?.half ?? null, kind, wfhApproved: f.view.wfh, ip: input.ip, position, settings });
  if (!d.ok) throw new AttError(d.error);
  const now = new Date();
  const s = f.profile.shift;
  const w = expectedWindow(s, f.view.leave?.half ?? null);
  const late = !d.isExtraWork && isLate(istMinutes(now), w.startMin, s.graceMinutes);
  const inserted = await db
    .insert(attendance)
    .values({
      userId,
      date: f.today,
      shiftId: s.id,
      checkInTime: now,
      checkInMethod: d.method,
      checkInLat: position?.lat ?? null,
      checkInLng: position?.lng ?? null,
      checkInIp: input.ip,
      isLate: late,
      isWfh: d.isWfh,
      isExtraWork: d.isExtraWork,
      status: d.isWfh ? "wfh" : "present",
    })
    .onConflictDoNothing()
    .returning({ id: attendance.id });
  if (!inserted.length) throw new AttError("You have already checked in today. There is one check-in and one check-out per day.");
  const how = d.method === "ip" ? "on the office network" : d.method === "gps" ? "at the office" : "from home (WFH)";
  return { message: `Checked in ${how}${late ? " (late)" : ""}${d.isExtraWork ? ", as extra work" : ""}.` };
}

export async function checkOut(userId: string, input: { ip: string | null; position: unknown }): Promise<{ message: string }> {
  const [f, settings] = await Promise.all([todayFacts(userId), getSettings()]);
  const r = f.record;
  const position = cleanPosition(input.position);
  const d = decideCheckOut({ checkedIn: !!r?.checkInTime, checkedOut: !!r?.checkOutTime, isWfhDay: !!r?.isWfh || f.view.wfh, ip: input.ip, position, settings });
  if (!d.ok || !r?.checkInTime) throw new AttError(d.ok ? "You have not checked in today." : d.error);
  const now = new Date();
  const fig = computeDay({
    workedMs: +now - +r.checkInTime,
    checkInMin: istMinutes(r.checkInTime),
    checkOutMin: istMinutes(now),
    shift: f.profile.shift,
    earlyOutMinutes: settings.earlyOutMinutes,
    isWfh: r.isWfh,
    isExtraWork: r.isExtraWork,
    halfLeave: f.view.leave?.half ?? null,
  });
  const done = await db
    .update(attendance)
    .set({
      checkOutTime: now,
      checkOutMethod: d.method,
      hoursWorked: fig.hoursWorked,
      deficitHours: fig.deficitHours,
      excessHours: fig.excessHours,
      isLate: fig.isLate,
      isEarlyOut: fig.isEarlyOut,
      status: fig.status,
      updatedAt: sql`now()`,
    })
    .where(and(eq(attendance.id, r.id), isNull(attendance.checkOutTime)))
    .returning({ id: attendance.id });
  if (!done.length) throw new AttError("You have already checked out today.");
  return { message: `Checked out. ${fig.hoursWorked} hours today${fig.isEarlyOut ? " (early out)" : ""}.` };
}
