import "server-only";
import { and, desc, eq, isNull, ne, sql } from "drizzle-orm";
import { db } from "./db";
import { attendance, earlyDepartures, type AttendanceRow } from "@/db/attendance-schema";
import { AttError } from "./dal";
import { getSettings, profileOf, type ShiftRules } from "./config";
import { loadDays, recordOf, viewOf } from "./days";
import { checkoutGate, computeDay, decideCheckIn, decideCheckOut, expectedWindow, formatDistance, formatWait, isLate, placeOfPunch, validPosition, type PlaceTag, type Position } from "./checkin-rules";
import { areaAt } from "./area";
import { approverName } from "./people";
import { dayKind, type DayKind } from "./calendar";
import { formatHours, istDay, istMinutes } from "./time";

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
  record: {
    checkIn: string | null;
    checkOut: string | null;
    method: string | null;
    /** Where the check-in was made (null for a regularized day), its distance from the office and, when remote, the area if known. */
    place: PlaceTag | null;
    distanceM: number | null;
    area: string | null;
    isLate: boolean; isEarlyOut: boolean; isWfh: boolean; isExtraWork: boolean; hoursWorked: number | null } | null;
  leaveToday: "none" | "first" | "second" | null;
  wfhApproved: boolean;
  /** Hours to work before check-out opens (full day, or half with half-day leave; 0 on extra work). */
  requiredHours: number;
  /** Today's request to leave early, if any. */
  early: { id: string; status: "pending" | "approved" | "rejected"; remark: string | null } | null;
  /** Who an early-departure request goes to, in words. */
  approver: string;
  /** Within this many metres of the office counts as in office (Settings). */
  officeRadiusM: number;
  /** When this was worked out (ms): the card's clock starts here, so the page renders the same on the server and in the browser. */
  serverNow: number;
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
        place: placeOfPunch(r.checkInPlace, r.checkInMethod),
        distanceM: r.checkInDistanceM,
        area: r.checkInArea,
        isLate: r.isLate,
        isEarlyOut: r.isEarlyOut,
        isWfh: r.isWfh,
        isExtraWork: r.isExtraWork,
        hoursWorked: r.hoursWorked == null ? null : Number(r.hoursWorked),
      }
    : null;

/** Today's latest early-departure request (the live one, else the last decided one). */
async function earlyToday(userId: string, today: string) {
  const rows = await db
    .select({ id: earlyDepartures.id, status: earlyDepartures.status, remark: earlyDepartures.approverRemark })
    .from(earlyDepartures)
    .where(and(eq(earlyDepartures.userId, userId), eq(earlyDepartures.date, today), ne(earlyDepartures.status, "cancelled")))
    .orderBy(desc(earlyDepartures.createdAt));
  const r = rows.find((x) => x.status === "approved" || x.status === "pending") ?? rows[0];
  return r ? { id: r.id, status: r.status as "pending" | "approved" | "rejected", remark: r.remark } : null;
}

const required = (f: Awaited<ReturnType<typeof todayFacts>>) => (f.record?.isExtraWork ? 0 : expectedWindow(f.profile.shift, f.view.leave?.half ?? null).hours);

/** What the check-in card shows. */
export async function todayCard(userId: string): Promise<TodayCard> {
  const f = await todayFacts(userId);
  const [early, approver, settings] = await Promise.all([earlyToday(userId, f.today), approverName(userId), getSettings()]);
  const s = f.profile.shift;
  return {
    today: f.today,
    kind: f.view.kind,
    holidayName: f.view.holidayName ?? null,
    shift: { name: s.name, startTime: s.startTime, endTime: s.endTime, graceMinutes: s.graceMinutes, fullDayHours: s.fullDayHours },
    record: cardRecord(f.record),
    leaveToday: f.view.leave?.half ?? null,
    wfhApproved: f.view.wfh,
    requiredHours: required(f),
    early,
    approver,
    officeRadiusM: settings.office.radiusM,
    serverNow: Date.now(),
  };
}

/** "at the office", "on the office network", or "remotely (2.3 km from the office)", for the toast. */
const where = (d: { method: "ip" | "gps"; place: PlaceTag; distanceM: number | null }) =>
  d.place === "in_office" ? (d.method === "ip" ? "on the office network" : "at the office") : `remotely${d.distanceM != null ? ` (${formatDistance(d.distanceM)} from the office)` : ""}`;

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
  // Late is judged the same wherever the check-in is made from.
  const late = !d.isExtraWork && isLate(istMinutes(now), w.startMin, s.graceMinutes);
  const area = d.place === "remote" && position ? await areaAt(position.lat, position.lng) : null;
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
      checkInAccuracyM: position?.accuracy ?? null,
      checkInPlace: d.place,
      checkInDistanceM: d.distanceM,
      checkInArea: area,
      isLate: late,
      isWfh: d.isWfh,
      isExtraWork: d.isExtraWork,
      status: d.isWfh ? "wfh" : "present",
    })
    .onConflictDoNothing()
    .returning({ id: attendance.id });
  if (!inserted.length) throw new AttError("You have already checked in today. There is one check-in and one check-out per day.");
  return { message: `Checked in ${where(d)}${d.isWfh ? " (WFH)" : ""}${late ? " (late)" : ""}${d.isExtraWork ? ", as extra work" : ""}.` };
}

export async function checkOut(userId: string, input: { ip: string | null; position: unknown }): Promise<{ message: string }> {
  const [f, settings] = await Promise.all([todayFacts(userId), getSettings()]);
  const r = f.record;
  const position = cleanPosition(input.position);
  const d = decideCheckOut({ checkedIn: !!r?.checkInTime, checkedOut: !!r?.checkOutTime, ip: input.ip, position, settings });
  if (!d.ok || !r?.checkInTime) throw new AttError(d.ok ? "You have not checked in today." : d.error);
  const now = new Date();
  const gate = checkoutGate({ workedMs: +now - +r.checkInTime, requiredHours: required(f), isExtraWork: r.isExtraWork, earlyApproved: (await earlyToday(userId, f.today))?.status === "approved" });
  if (!gate.allowed)
    throw new AttError(`You can check out once you have worked ${formatHours(gate.requiredHours)} (in ${formatWait(gate.remainingMs)}). To leave earlier, ask your manager to approve an early check-out.`);
  const area = d.place === "remote" && position ? await areaAt(position.lat, position.lng) : null;
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
      checkOutLat: position?.lat ?? null,
      checkOutLng: position?.lng ?? null,
      checkOutIp: input.ip,
      checkOutAccuracyM: position?.accuracy ?? null,
      checkOutPlace: d.place,
      checkOutDistanceM: d.distanceM,
      checkOutArea: area,
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
  return { message: `Checked out ${where(d)}. ${fig.hoursWorked} hours today${fig.isEarlyOut ? " (early out)" : ""}.` };
}
