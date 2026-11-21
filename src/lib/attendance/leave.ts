import "server-only";
import { and, asc, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db, rowsOf } from "./db";
import { attendance, compoffRequests, holidays, leaveBalances, leaveRequests, leaveTypes, type HalfDay, type LeaveType } from "@/db/attendance-schema";
import { AttError } from "./dal";
import { calendarFor, getSettings, profileOf } from "./config";
import { accrued, balanceOf, canCancelLeave, carryForward, checkLeave, entitlementFor, leaveDays } from "./leave-rules";
import { allocate, availableOn, compoffBalance, type Earned, type Spend } from "./compoff";
import { ALLOWED_DOC_TYPES, MAX_FILE_BYTES, MAX_FILE_MB, MAX_REASON, isUuid } from "./att.manifest";
import { objectSize, signedUploadUrl } from "./storage";
import { notifyNewRequest } from "./notify";
import { addDays, formatDay, istDay, isDay } from "./time";

/**
 * Leave: types, balances, requests and the team calendar (rules in leave-rules.ts, comp-off in compoff.ts).
 *
 * A balance row is made the first time a person's year is looked at: the year's entitlement (prorated for a joiner) and what carries over
 * from last year's row, if there is one. `booked` and `pending` are recomputed from the requests in one statement after every change (syncBalance), so they never
 * drift even without transactions. A request's days count in the year it starts.
 */

export const listLeaveTypes = async (activeOnly = true): Promise<LeaveType[]> =>
  db.select().from(leaveTypes).where(activeOnly ? eq(leaveTypes.isActive, true) : undefined).orderBy(asc(leaveTypes.sortOrder), asc(leaveTypes.name));

/** Recomputes booked (approved) and pending for one person, type and year from the requests. */
export async function syncBalance(userId: string, leaveTypeId: string, year: number): Promise<void> {
  await db.execute(sql`
    update att_leave_balances b set
      booked = coalesce((select sum(r.days_count) from att_leave_requests r where r.user_id = b.user_id and r.leave_type_id = b.leave_type_id
        and r.status = 'approved' and extract(year from r.start_date) = b.year), 0),
      pending = coalesce((select sum(r.days_count) from att_leave_requests r where r.user_id = b.user_id and r.leave_type_id = b.leave_type_id
        and r.status = 'pending' and extract(year from r.start_date) = b.year), 0),
      updated_at = now()
    where b.user_id = ${userId} and b.leave_type_id = ${leaveTypeId} and b.year = ${year}`);
}

/** Makes any missing balance rows for the person's year (entitlement and carry forward), then syncs them. */
export async function ensureBalances(userId: string, year: number, types?: LeaveType[]): Promise<void> {
  const all = (types ?? (await listLeaveTypes())).filter((t) => !t.isCompoff);
  if (!all.length) return;
  const have = await db.select({ typeId: leaveBalances.leaveTypeId }).from(leaveBalances).where(and(eq(leaveBalances.userId, userId), eq(leaveBalances.year, year)));
  const missing = all.filter((t) => !have.some((h) => h.typeId === t.id));
  if (!missing.length) return;
  const profile = await profileOf(userId);
  // Carry forward comes only from a real row for last year (the person used Attendance then); a first year carries nothing, and HR enter any
  // opening balance from before Attendance as an adjustment. Last year's row is synced first so its booked and pending are current.
  for (const t of missing) if (Number(t.carryForwardCap) > 0) await syncBalance(userId, t.id, year - 1);
  const prev = await db.select().from(leaveBalances).where(and(eq(leaveBalances.userId, userId), eq(leaveBalances.year, year - 1)));
  await db
    .insert(leaveBalances)
    .values(
      missing.map((t) => {
        const p = prev.find((b) => b.leaveTypeId === t.id);
        const leftLastYear = p ? balanceOf({ accrued: Number(p.entitled), carried: Number(p.carried), adjusted: Number(p.adjusted), booked: Number(p.booked), pending: Number(p.pending) }) : 0;
        return { userId, leaveTypeId: t.id, year, entitled: entitlementFor(Number(t.daysPerYear), year, profile.dateOfJoining), carried: carryForward(leftLastYear, Number(t.carryForwardCap)) };
      }),
    )
    .onConflictDoNothing();
  for (const t of missing) await syncBalance(userId, t.id, year);
}

// ── Comp-off ──────────────────────────────────────────────────────────────

/** A person's approved comp-offs and the comp-off leave drawing on them (pending and approved), for compoff.ts. */
export async function compoffLedger(userId: string, excludeLeaveId?: string): Promise<{ earned: Earned[]; spends: Spend[] }> {
  const [earned, spends] = await Promise.all([
    db
      .select({ id: compoffRequests.id, workedDate: compoffRequests.workedDate, expiryDate: compoffRequests.expiryDate, type: compoffRequests.compoffType })
      .from(compoffRequests)
      .where(and(eq(compoffRequests.userId, userId), inArray(compoffRequests.status, ["approved", "used"]))),
    db
      .select({ id: leaveRequests.id, date: leaveRequests.startDate, days: leaveRequests.daysCount })
      .from(leaveRequests)
      .innerJoin(leaveTypes, eq(leaveTypes.id, leaveRequests.leaveTypeId))
      .where(and(eq(leaveRequests.userId, userId), eq(leaveTypes.isCompoff, true), inArray(leaveRequests.status, ["pending", "approved"]))),
  ]);
  return {
    earned: earned.filter((e) => e.expiryDate).map((e) => ({ id: e.id, workedDate: e.workedDate, expiryDate: e.expiryDate!, days: e.type === "half" ? 0.5 : 1 })),
    spends: spends.filter((s) => s.id !== excludeLeaveId).map((s) => ({ date: s.date, days: Number(s.days) })),
  };
}

export async function compoffSummary(userId: string) {
  const today = istDay();
  const { earned, spends } = await compoffLedger(userId);
  return { balance: compoffBalance(earned, spends, today), states: allocate(earned, spends, today).states };
}

// ── Balances ──────────────────────────────────────────────────────────────

export type BalanceLine = { type: LeaveType; entitled: number; accrued: number; carried: number; adjusted: number; booked: number; pending: number; balance: number };

/** Every active type's balance for the person's year (comp-off from the comp-off ledger). */
export async function balancesFor(userId: string, year: number): Promise<BalanceLine[]> {
  const types = await listLeaveTypes();
  await ensureBalances(userId, year, types);
  const [rows, profile, co] = await Promise.all([
    db.select().from(leaveBalances).where(and(eq(leaveBalances.userId, userId), eq(leaveBalances.year, year))),
    profileOf(userId),
    types.some((t) => t.isCompoff) ? compoffSummary(userId) : Promise.resolve(null),
  ]);
  const today = istDay();
  return types
    .filter((t) => t.availableTo === "all" || t.availableTo === profile.employmentType)
    .map((t) => {
      if (t.isCompoff) return { type: t, entitled: 0, accrued: 0, carried: 0, adjusted: 0, booked: 0, pending: 0, balance: co?.balance ?? 0 };
      const r = rows.find((b) => b.leaveTypeId === t.id);
      const parts = {
        accrued: accrued({ entitled: Number(r?.entitled ?? 0), accrualType: t.accrualType, year, today, dateOfJoining: profile.dateOfJoining }),
        carried: Number(r?.carried ?? 0),
        adjusted: Number(r?.adjusted ?? 0),
        booked: Number(r?.booked ?? 0),
        pending: Number(r?.pending ?? 0),
      };
      return { type: t, entitled: Number(r?.entitled ?? 0), ...parts, balance: balanceOf(parts) };
    });
}

// ── Requests ──────────────────────────────────────────────────────────────

export type LeaveInput = { leaveTypeId: string; startDate: string; endDate: string; halfDay: HalfDay; reason: string; attachmentKey?: string | null; attachmentName?: string | null; ccUserIds?: string[] };

/** A signed link to upload a supporting document to; the key is tied to the person, so nobody can attach someone else's file. */
export async function beginLeaveUpload(userId: string, fileName: string, size: number, mime: string): Promise<{ key: string; uploadUrl: string }> {
  if (!ALLOWED_DOC_TYPES.includes(mime)) throw new AttError("Attach a PDF or a photo (JPEG, PNG, WebP or HEIC).");
  if (!(size > 0) || size > MAX_FILE_BYTES) throw new AttError(`The document must be under ${MAX_FILE_MB} MB.`);
  const safe = String(fileName).replace(/[^\w.\- ]+/g, "_").slice(-80) || "document";
  const key = `leave/${userId}/${randomUUID()}/${safe}`;
  return { key, uploadUrl: await signedUploadUrl(key) };
}

/** Days in the range the person has checked in on. */
async function checkedInDays(userId: string, from: string, to: string): Promise<Set<string>> {
  const rows = await db
    .select({ date: attendance.date })
    .from(attendance)
    .where(and(eq(attendance.userId, userId), gte(attendance.date, from), lte(attendance.date, to), sql`${attendance.checkInTime} is not null`));
  return new Set(rows.map((r) => r.date));
}

export async function overlapsLeave(userId: string, from: string, to: string, halfDay: HalfDay, excludeId?: string): Promise<boolean> {
  const rows = await db
    .select({ id: leaveRequests.id, half: leaveRequests.halfDay, start: leaveRequests.startDate, end: leaveRequests.endDate })
    .from(leaveRequests)
    .where(and(eq(leaveRequests.userId, userId), inArray(leaveRequests.status, ["pending", "approved"]), lte(leaveRequests.startDate, to), gte(leaveRequests.endDate, from)));
  // Two half days on the same date are fine when they are different halves.
  return rows.some((r) => r.id !== excludeId && !(halfDay !== "none" && r.half !== "none" && r.half !== halfDay && r.start === from && r.end === to));
}

export async function applyLeave(user: { id: string; name: string }, input: LeaveInput): Promise<{ id: string }> {
  if (!isUuid(input.leaveTypeId)) throw new AttError("Choose a leave type.");
  if (!isDay(input.startDate) || !isDay(input.endDate)) throw new AttError("Choose the dates.");
  const halfDay: HalfDay = (["none", "first", "second"] as const).includes(input.halfDay) ? input.halfDay : "none";
  const endDate = halfDay !== "none" ? input.startDate : input.endDate;
  const reason = String(input.reason ?? "").trim().slice(0, MAX_REASON);
  const [type] = await db.select().from(leaveTypes).where(eq(leaveTypes.id, input.leaveTypeId));
  if (!type) throw new AttError("That leave type no longer exists.");
  const today = istDay();
  const year = Number(input.startDate.slice(0, 4));
  const [cal, settings, profile, checked, overlaps] = await Promise.all([
    calendarFor(input.startDate, endDate),
    getSettings(),
    profileOf(user.id),
    checkedInDays(user.id, input.startDate, endDate),
    overlapsLeave(user.id, input.startDate, endDate, halfDay),
  ]);
  const days = leaveDays({ start: input.startDate, end: endDate, halfDay, countWeekends: type.countWeekends, cal });

  let available: number;
  if (type.isCompoff) {
    const { earned, spends } = await compoffLedger(user.id);
    available = availableOn(earned, spends, input.startDate, today);
  } else {
    available = (await balancesFor(user.id, year)).find((b) => b.type.id === type.id)?.balance ?? 0;
  }

  let attachmentKey: string | null = null;
  if (input.attachmentKey) {
    if (!String(input.attachmentKey).startsWith(`leave/${user.id}/`)) throw new AttError("That document could not be attached. Upload it again.");
    if ((await objectSize(input.attachmentKey)) == null) throw new AttError("The document did not finish uploading. Upload it again.");
    attachmentKey = input.attachmentKey;
  }

  const error = checkLeave({
    type,
    employmentType: profile.employmentType,
    start: input.startDate,
    end: endDate,
    halfDay,
    days,
    today,
    windowDays: settings.regularizationWindowDays,
    reason,
    hasAttachment: !!attachmentKey,
    checkedInDays: checked,
    overlaps,
    available,
  });
  if (error) throw new AttError(error);

  const cc = [...new Set((input.ccUserIds ?? []).filter((x) => isUuid(x) && x !== user.id))].slice(0, 10);
  const [row] = await db
    .insert(leaveRequests)
    .values({
      userId: user.id,
      leaveTypeId: type.id,
      startDate: input.startDate,
      endDate,
      halfDay,
      daysCount: days,
      reason,
      attachmentUrl: attachmentKey,
      attachmentName: attachmentKey ? String(input.attachmentName ?? "document").slice(0, 120) : null,
      approverId: await approverIdFor(user.id),
      ccUserIds: cc,
    })
    .returning({ id: leaveRequests.id, approverId: leaveRequests.approverId });
  if (!type.isCompoff) await syncBalance(user.id, type.id, year);
  const when = input.startDate === endDate ? formatDay(input.startDate) + (halfDay !== "none" ? ` (${halfDay} half)` : "") : `${formatDay(input.startDate)} – ${formatDay(endDate)}`;
  await notifyNewRequest({ kind: "leave", id: row.id, requester: user, approverId: row.approverId, summary: `${type.name}, ${when} (${days} day${days === 1 ? "" : "s"})`, cc });
  return { id: row.id };
}

export async function cancelLeave(userId: string, id: string): Promise<void> {
  if (!isUuid(id)) throw new AttError("That request was not found.");
  const [r] = await db.select().from(leaveRequests).where(and(eq(leaveRequests.id, id), eq(leaveRequests.userId, userId)));
  if (!r) throw new AttError("That request was not found.");
  if (!canCancelLeave(r, istDay())) throw new AttError("Only a pending request, or approved leave that has not started, can be cancelled.");
  const done = await db
    .update(leaveRequests)
    .set({ status: "cancelled" })
    .where(and(eq(leaveRequests.id, id), inArray(leaveRequests.status, ["pending", "approved"])))
    .returning({ id: leaveRequests.id });
  if (!done.length) throw new AttError("That request has just changed. Reload the page.");
  await syncBalance(userId, r.leaveTypeId, Number(r.startDate.slice(0, 4)));
}

/** Who a person's requests go to (manager or HR = null); see att.manifest.ts approverFor. */
export async function approverIdFor(userId: string): Promise<string | null> {
  const res = await db.execute(sql`
    select u.reporting_manager_id as manager_id, (m.is_active and m.status = 'approved') as manager_active
    from users u left join users m on m.id = u.reporting_manager_id where u.id = ${userId}`);
  const r = rowsOf<{ manager_id: string | null; manager_active: boolean | null }>(res)[0];
  return r?.manager_id && r.manager_active && r.manager_id !== userId ? r.manager_id : null;
}

export type MyLeave = { id: string; typeName: string; color: string; startDate: string; endDate: string; halfDay: HalfDay; days: number; reason: string; status: string; remark: string | null; hasAttachment: boolean; createdAt: Date; canCancel: boolean };

export async function myLeaveRequests(userId: string, limit = 100): Promise<MyLeave[]> {
  const today = istDay();
  const rows = await db
    .select({ r: leaveRequests, typeName: leaveTypes.name, color: leaveTypes.color })
    .from(leaveRequests)
    .innerJoin(leaveTypes, eq(leaveTypes.id, leaveRequests.leaveTypeId))
    .where(eq(leaveRequests.userId, userId))
    .orderBy(desc(leaveRequests.createdAt))
    .limit(limit);
  return rows.map(({ r, typeName, color }) => ({
    id: r.id,
    typeName,
    color,
    startDate: r.startDate,
    endDate: r.endDate,
    halfDay: r.halfDay,
    days: Number(r.daysCount),
    reason: r.reason,
    status: r.status,
    remark: r.approverRemark,
    hasAttachment: !!r.attachmentUrl,
    createdAt: r.createdAt,
    canCancel: canCancelLeave(r, today),
  }));
}

/** Approved leave of everyone in `userIds` overlapping the month (no reasons: only who, when and the type). */
export async function leaveCalendar(userIds: string[], from: string, to: string) {
  if (!userIds.length) return [];
  return db
    .select({ userId: leaveRequests.userId, startDate: leaveRequests.startDate, endDate: leaveRequests.endDate, halfDay: leaveRequests.halfDay, typeName: leaveTypes.name, color: leaveTypes.color })
    .from(leaveRequests)
    .innerJoin(leaveTypes, eq(leaveTypes.id, leaveRequests.leaveTypeId))
    .where(and(inArray(leaveRequests.userId, userIds), eq(leaveRequests.status, "approved"), lte(leaveRequests.startDate, to), gte(leaveRequests.endDate, from)))
    .orderBy(asc(leaveRequests.startDate));
}

export const holidaysOfYear = (year: number) => db.select().from(holidays).where(eq(holidays.year, year)).orderBy(asc(holidays.date));

/** For the leave form: how many days the chosen dates would take (so the person sees it before sending). */
export async function previewDays(leaveTypeId: string, start: string, end: string, halfDay: HalfDay): Promise<number> {
  if (!isUuid(leaveTypeId) || !isDay(start) || !isDay(end) || end < start || end > addDays(start, 120)) return 0;
  const [type] = await db.select({ countWeekends: leaveTypes.countWeekends }).from(leaveTypes).where(eq(leaveTypes.id, leaveTypeId));
  if (!type) return 0;
  const cal = await calendarFor(start, end);
  return leaveDays({ start, end: halfDay !== "none" ? start : end, halfDay, countWeekends: type.countWeekends, cal });
}
