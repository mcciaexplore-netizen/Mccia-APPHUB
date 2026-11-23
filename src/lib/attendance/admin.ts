import "server-only";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "./db";
import {
  announcements,
  compoffRequests,
  holidays,
  leaveAdjustments,
  leaveBalances,
  leaveRequests,
  leaveTypes,
  shifts,
  timeLogs,
  timeProjects,
  timesheets,
  userProfiles,
  type LeaveType,
} from "@/db/attendance-schema";
import { AttError } from "./dal";
import { getSettings, listShifts, profilesFor, saveSettings } from "./config";
import { listMembers, peopleByIds, setManager } from "./host-adapter";
import { notify } from "./notice";
import { ensureBalances, listLeaveTypes } from "./leave";
import { accrued, balanceOf, entitlementFor } from "./leave-rules";
import { compoffBalance } from "./compoff";
import { parseSettings, type AttSettings } from "./settings";
import { EMPLOYMENT_TYPES, LEAVE_COLORS, isUuid } from "./att.manifest";
import { formatDay, isDay, istDay, parseHm } from "./time";

/** What HR change in Attendance Admin: people, settings, shifts, leave types, holidays, projects, balances and announcements. */

type Actor = { id: string; name: string };
const oneLine = (s: unknown, max: number) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, max);

// ── People ────────────────────────────────────────────────────────────────

export async function peopleList() {
  const members = await listMembers();
  const [profiles, allShifts] = await Promise.all([profilesFor(members.map((m) => m.id)), listShifts()]);
  const names = new Map(members.map((m) => [m.id, m.name]));
  const managers = await peopleByIds(members.map((m) => m.managerId).filter((id) => id && !names.has(id)));
  return {
    shifts: allShifts.map((s) => ({ id: s.id, name: s.name, isDefault: s.isDefault })),
    people: members.map((m) => {
      const p = profiles.get(m.id)!;
      return {
        ...m,
        managerName: m.managerId ? (names.get(m.managerId) ?? managers.get(m.managerId)?.name ?? "Former member") : null,
        shiftId: p.shiftId,
        shiftName: p.shift.name,
        employmentType: p.employmentType,
        dateOfJoining: p.dateOfJoining,
        dateOfBirth: p.dateOfBirth,
      };
    }),
  };
}

export type PersonPatch = { shiftId: string | null; employmentType: string; dateOfJoining: string | null; dateOfBirth: string | null; managerId: string | null };

export async function updatePerson(actor: Actor, userId: string, patch: PersonPatch): Promise<void> {
  if (!isUuid(userId)) throw new AttError("That person was not found.");
  if (!(await listMembers()).some((m) => m.id === userId)) throw new AttError("That person does not have the Attendance application.");
  const shiftId = patch.shiftId && isUuid(patch.shiftId) ? patch.shiftId : null;
  if (shiftId && !(await listShifts()).some((s) => s.id === shiftId)) throw new AttError("That shift no longer exists.");
  const employmentType = (EMPLOYMENT_TYPES as readonly string[]).includes(patch.employmentType) ? (patch.employmentType as (typeof EMPLOYMENT_TYPES)[number]) : "staff";
  const doj = patch.dateOfJoining || null;
  const dob = patch.dateOfBirth || null;
  if (doj && !isDay(doj)) throw new AttError("The joining date is not a valid date.");
  if (dob && (!isDay(dob) || dob > istDay())) throw new AttError("The date of birth is not a valid date.");
  const values = { userId, shiftId, employmentType, dateOfJoining: doj, dateOfBirth: dob, updatedAt: new Date() };
  await db.insert(userProfiles).values(values).onConflictDoUpdate({ target: userProfiles.userId, set: values });
  await setManager(actor, userId, patch.managerId && isUuid(patch.managerId) ? patch.managerId : null);
}

// ── Settings ──────────────────────────────────────────────────────────────

export async function updateSettings(actor: Actor, raw: unknown): Promise<AttSettings> {
  const r = (raw ?? {}) as Record<string, unknown>;
  const bad = (Array.isArray(r.officeIps) ? r.officeIps : []).map((s) => String(s).trim()).filter(Boolean).filter((s) => !parseSettings({ officeIps: [s] }).officeIps.length);
  if (bad.length) throw new AttError(`Not a valid IP address or IPv4 range: ${bad.slice(0, 3).join(", ")}`);
  if (r.goLiveDate && !isDay(r.goLiveDate)) throw new AttError("The go-live date is not a valid date.");
  // The recorded first-use day is the server's, never the form's.
  const s = { ...parseSettings(raw), firstEnabledOn: (await getSettings()).firstEnabledOn };
  await saveSettings(actor.id, s);
  return s;
}

// ── Shifts ────────────────────────────────────────────────────────────────

export type ShiftInput = { id?: string; name: string; startTime: string; endTime: string; graceMinutes: number; fullDayHours: number; halfDayHours: number; firstHalfEnd: string; secondHalfStart: string; isDefault: boolean };

export async function saveShift(input: ShiftInput): Promise<void> {
  const name = oneLine(input.name, 60);
  if (name.length < 2) throw new AttError("Give the shift a name.");
  const start = parseHm(input.startTime);
  const end = parseHm(input.endTime);
  const fhe = parseHm(input.firstHalfEnd);
  const shs = parseHm(input.secondHalfStart);
  if (start == null || end == null || fhe == null || shs == null) throw new AttError("Enter every time as HH:MM.");
  if (end <= start) throw new AttError("The shift must end after it starts (overnight shifts are not supported).");
  if (fhe <= start || fhe > end || shs < start || shs >= end) throw new AttError("The halves must fall inside the shift.");
  const grace = Math.round(Number(input.graceMinutes));
  const full = Number(input.fullDayHours);
  const half = Number(input.halfDayHours);
  if (!(grace >= 0 && grace <= 240)) throw new AttError("Grace must be 0 to 240 minutes.");
  if (!(full > 0 && full <= 24) || !(half > 0 && half < full)) throw new AttError("Full-day hours must be more than half-day hours (both above 0).");
  const values = { name, startTime: input.startTime.slice(0, 5), endTime: input.endTime.slice(0, 5), graceMinutes: grace, fullDayHours: full, halfDayHours: half, firstHalfEnd: input.firstHalfEnd.slice(0, 5), secondHalfStart: input.secondHalfStart.slice(0, 5), isDefault: !!input.isDefault };
  let id = input.id && isUuid(input.id) ? input.id : null;
  if (id) await db.update(shifts).set(values).where(eq(shifts.id, id));
  else id = (await db.insert(shifts).values(values).returning({ id: shifts.id }))[0].id;
  // Exactly one default: setting one clears the others; clearing the only default is refused.
  if (values.isDefault) await db.update(shifts).set({ isDefault: false }).where(sql`${shifts.id} <> ${id}`);
  else if (!(await db.select({ id: shifts.id }).from(shifts).where(eq(shifts.isDefault, true))).length) await db.update(shifts).set({ isDefault: true }).where(eq(shifts.id, id));
}

export async function deleteShift(id: string): Promise<void> {
  if (!isUuid(id)) throw new AttError("That shift was not found.");
  const [s] = await db.select().from(shifts).where(eq(shifts.id, id));
  if (!s) throw new AttError("That shift was not found.");
  if (s.isDefault) throw new AttError("The default shift cannot be deleted. Make another shift the default first.");
  // People on it fall back to the default shift (the foreign key clears their shift).
  await db.delete(shifts).where(eq(shifts.id, id));
}

// ── Leave types ───────────────────────────────────────────────────────────

export type LeaveTypeInput = Omit<LeaveType, "id" | "createdAt" | "daysPerYear" | "carryForwardCap"> & { id?: string; daysPerYear: number; carryForwardCap: number };

export async function saveLeaveType(input: LeaveTypeInput): Promise<void> {
  const name = oneLine(input.name, 60);
  if (name.length < 2) throw new AttError("Give the leave type a name.");
  const n = (v: unknown, lo: number, hi: number, what: string) => {
    const x = Number(v);
    if (!Number.isFinite(x) || x < lo || x > hi) throw new AttError(`${what} must be between ${lo} and ${hi}.`);
    return x;
  };
  const opt = (v: unknown, lo: number, hi: number, what: string) => (v === null || v === undefined || v === "" ? null : Math.round(n(v, lo, hi, what)));
  const values = {
    name,
    color: (LEAVE_COLORS as readonly string[]).includes(input.color) ? input.color : "blue",
    daysPerYear: input.isCompoff ? 0 : n(input.daysPerYear, 0, 365, "Days per year"),
    accrualType: input.accrualType === "monthly" ? ("monthly" as const) : ("full_year" as const),
    carryForwardCap: n(input.carryForwardCap, 0, 365, "Carry-forward cap"),
    maxConsecutiveDays: opt(input.maxConsecutiveDays, 1, 365, "Max consecutive days"),
    noticePeriodDays: Math.round(n(input.noticePeriodDays, 0, 365, "Notice period")),
    allowHalfDay: !!input.allowHalfDay,
    halfDayFirst: !!input.halfDayFirst,
    halfDaySecond: !!input.halfDaySecond,
    requiresDocumentAfterDays: opt(input.requiresDocumentAfterDays, 0, 365, "Document after days"),
    requiresReason: !!input.requiresReason,
    availableTo: ["all", ...EMPLOYMENT_TYPES].includes(input.availableTo) ? input.availableTo : "all",
    countWeekends: !!input.countWeekends,
    isCompoff: !!input.isCompoff,
    isActive: input.isActive !== false,
    sortOrder: Math.round(n(input.sortOrder ?? 0, 0, 999, "Order")),
  };
  if (values.allowHalfDay && !values.halfDayFirst && !values.halfDaySecond) throw new AttError("Allow at least one half (first or second) for half days.");
  if (input.id && isUuid(input.id)) await db.update(leaveTypes).set(values).where(eq(leaveTypes.id, input.id));
  else await db.insert(leaveTypes).values(values);
  // Entitlements already made for this year follow the new days per year.
  if (input.id && isUuid(input.id) && !values.isCompoff) {
    const year = Number(istDay().slice(0, 4));
    const rows = await db.select({ id: leaveBalances.id, userId: leaveBalances.userId }).from(leaveBalances).where(and(eq(leaveBalances.leaveTypeId, input.id), eq(leaveBalances.year, year)));
    const profiles = await profilesFor(rows.map((r) => r.userId));
    for (const r of rows) await db.update(leaveBalances).set({ entitled: entitlementFor(values.daysPerYear, year, profiles.get(r.userId)?.dateOfJoining ?? null) }).where(eq(leaveBalances.id, r.id));
  }
}

/** Deletes a leave type nobody has used; one with requests is switched off instead (its history stays). */
export async function deleteLeaveType(id: string): Promise<"deleted" | "deactivated"> {
  if (!isUuid(id)) throw new AttError("That leave type was not found.");
  const used = await db.select({ id: leaveRequests.id }).from(leaveRequests).where(eq(leaveRequests.leaveTypeId, id)).limit(1);
  if (used.length) {
    await db.update(leaveTypes).set({ isActive: false }).where(eq(leaveTypes.id, id));
    return "deactivated";
  }
  await db.delete(leaveTypes).where(eq(leaveTypes.id, id));
  return "deleted";
}

// ── Holidays ──────────────────────────────────────────────────────────────

export async function saveHoliday(input: { id?: string; date: string; name: string; isOptional: boolean }): Promise<void> {
  if (!isDay(input.date)) throw new AttError("Choose the date.");
  const name = oneLine(input.name, 80);
  if (name.length < 2) throw new AttError("Give the holiday a name.");
  const values = { date: input.date, name, isOptional: !!input.isOptional, year: Number(input.date.slice(0, 4)) };
  try {
    if (input.id && isUuid(input.id)) await db.update(holidays).set(values).where(eq(holidays.id, input.id));
    else await db.insert(holidays).values(values);
  } catch (e) {
    if (String((e as { code?: string })?.code ?? (e as { cause?: { code?: string } })?.cause?.code) === "23505") throw new AttError(`There is already a holiday on ${formatDay(input.date)}.`);
    throw e;
  }
}

export async function deleteHoliday(id: string): Promise<void> {
  if (!isUuid(id)) throw new AttError("That holiday was not found.");
  await db.delete(holidays).where(eq(holidays.id, id));
}

// ── Time projects ─────────────────────────────────────────────────────────

export async function saveProject(input: { id?: string; name: string; description: string; isActive: boolean }): Promise<void> {
  const name = oneLine(input.name, 80);
  if (name.length < 2) throw new AttError("Give the project a name.");
  const values = { name, description: String(input.description ?? "").trim().slice(0, 500), isActive: input.isActive !== false };
  if (input.id && isUuid(input.id)) await db.update(timeProjects).set(values).where(eq(timeProjects.id, input.id));
  else await db.insert(timeProjects).values(values);
}

export async function deleteProject(id: string): Promise<"deleted" | "deactivated"> {
  if (!isUuid(id)) throw new AttError("That project was not found.");
  const used = await db.select({ id: timeLogs.id }).from(timeLogs).where(eq(timeLogs.projectId, id)).limit(1);
  if (used.length) {
    await db.update(timeProjects).set({ isActive: false }).where(eq(timeProjects.id, id));
    return "deactivated";
  }
  await db.delete(timeProjects).where(eq(timeProjects.id, id));
  return "deleted";
}

// ── Leave balances ────────────────────────────────────────────────────────

export type TrackerRow = { userId: string; name: string; balances: Record<string, { entitled: number; accrued: number; carried: number; adjusted: number; booked: number; pending: number; balance: number }> };

/** Everyone's balances for a year, in a few queries (rows are made for anyone missing them). */
export async function leaveTracker(year: number): Promise<{ types: LeaveType[]; rows: TrackerRow[] }> {
  const [types, members] = await Promise.all([listLeaveTypes(), listMembers()]);
  const ids = members.map((m) => m.id);
  if (!ids.length) return { types, rows: [] };
  let rows = await db.select().from(leaveBalances).where(and(inArray(leaveBalances.userId, ids), eq(leaveBalances.year, year)));
  const regular = types.filter((t) => !t.isCompoff);
  const missing = ids.filter((id) => regular.some((t) => !rows.some((r) => r.userId === id && r.leaveTypeId === t.id)));
  if (missing.length) {
    for (const id of missing) await ensureBalances(id, year, types);
    rows = await db.select().from(leaveBalances).where(and(inArray(leaveBalances.userId, ids), eq(leaveBalances.year, year)));
  }
  const today = istDay();
  const profiles = await profilesFor(ids);
  const co = types.find((t) => t.isCompoff);
  const coBalances = new Map<string, number>();
  if (co) {
    const [earned, spends] = await Promise.all([
      db.select().from(compoffRequests).where(and(inArray(compoffRequests.userId, ids), inArray(compoffRequests.status, ["approved", "used"]))),
      db
        .select({ userId: leaveRequests.userId, date: leaveRequests.startDate, days: leaveRequests.daysCount })
        .from(leaveRequests)
        .where(and(inArray(leaveRequests.userId, ids), eq(leaveRequests.leaveTypeId, co.id), inArray(leaveRequests.status, ["pending", "approved"]))),
    ]);
    for (const id of ids)
      coBalances.set(
        id,
        compoffBalance(
          earned.filter((e) => e.userId === id && e.expiryDate).map((e) => ({ id: e.id, workedDate: e.workedDate, expiryDate: e.expiryDate!, days: e.compoffType === "half" ? 0.5 : 1 })),
          spends.filter((s) => s.userId === id).map((s) => ({ date: s.date, days: Number(s.days) })),
          today,
        ),
      );
  }
  return {
    types,
    rows: members.map((m) => {
      const balances: TrackerRow["balances"] = {};
      for (const t of types) {
        if (t.isCompoff) {
          const b = coBalances.get(m.id) ?? 0;
          balances[t.id] = { entitled: 0, accrued: 0, carried: 0, adjusted: 0, booked: 0, pending: 0, balance: b };
          continue;
        }
        const r = rows.find((x) => x.userId === m.id && x.leaveTypeId === t.id);
        const parts = {
          accrued: accrued({ entitled: Number(r?.entitled ?? 0), accrualType: t.accrualType, year, today, dateOfJoining: profiles.get(m.id)?.dateOfJoining ?? null }),
          carried: Number(r?.carried ?? 0),
          adjusted: Number(r?.adjusted ?? 0),
          booked: Number(r?.booked ?? 0),
          pending: Number(r?.pending ?? 0),
        };
        balances[t.id] = { entitled: Number(r?.entitled ?? 0), ...parts, balance: balanceOf(parts) };
      }
      return { userId: m.id, name: m.name, balances };
    }),
  };
}

/** Adds (positive) or deducts (negative) days with a remark; the person is told on the bell. */
export async function adjustBalance(actor: Actor, input: { userId: string; leaveTypeId: string; year: number; days: number; remark: string }): Promise<void> {
  if (!isUuid(input.userId) || !isUuid(input.leaveTypeId)) throw new AttError("Choose the person and the leave type.");
  const days = Number(input.days);
  if (!Number.isFinite(days) || days === 0 || Math.abs(days) > 365 || Math.round(days * 2) !== days * 2) throw new AttError("Enter the days to add or deduct, in half days (for example 1, 0.5 or −2).");
  const remark = String(input.remark ?? "").trim().slice(0, 500);
  if (remark.length < 3) throw new AttError("Give a remark for the adjustment.");
  const year = Math.round(Number(input.year));
  if (!(year >= 2000 && year <= 2100)) throw new AttError("Choose the year.");
  const [type] = await db.select().from(leaveTypes).where(eq(leaveTypes.id, input.leaveTypeId));
  if (!type) throw new AttError("That leave type no longer exists.");
  if (type.isCompoff) throw new AttError("Comp-off balance comes from approved comp-offs and cannot be adjusted here.");
  if (!(await listMembers()).some((m) => m.id === input.userId)) throw new AttError("That person does not have the Attendance application.");
  await ensureBalances(input.userId, year);
  await db.insert(leaveAdjustments).values({ userId: input.userId, leaveTypeId: type.id, year, days, remark, createdBy: actor.id });
  await db.execute(sql`
    update att_leave_balances set adjusted = coalesce((select sum(days) from att_leave_adjustments a where a.user_id = ${input.userId} and a.leave_type_id = ${type.id} and a.year = ${year}), 0), updated_at = now()
    where user_id = ${input.userId} and leave_type_id = ${type.id} and year = ${year}`);
  const abs = Math.abs(days);
  await notify([
    {
      userId: input.userId,
      title: `HR ${days > 0 ? "added" : "deducted"} ${abs} day${abs === 1 ? "" : "s"} of ${type.name}`,
      body: `${year} balance · ${remark} · by ${actor.name}`,
      link: "/attendance/leave",
      key: `adjust:${input.userId}:${type.id}:${Date.now()}`,
    },
  ]);
}

export async function adjustmentHistory(limit = 200) {
  const rows = await db
    .select({ a: leaveAdjustments, typeName: leaveTypes.name })
    .from(leaveAdjustments)
    .innerJoin(leaveTypes, eq(leaveTypes.id, leaveAdjustments.leaveTypeId))
    .orderBy(desc(leaveAdjustments.createdAt))
    .limit(limit);
  const people = await peopleByIds(rows.flatMap((r) => [r.a.userId, r.a.createdBy]));
  return rows.map((r) => ({ id: r.a.id, person: people.get(r.a.userId)?.name ?? "Former member", typeName: r.typeName, year: r.a.year, days: Number(r.a.days), remark: r.a.remark, by: people.get(r.a.createdBy)?.name ?? "HR", createdAt: r.a.createdAt }));
}

/** Every leave request (any status), newest first, for the Leave Tracker's history and the report. */
export async function leaveHistory(filter: { userId?: string | null; from?: string | null; to?: string | null } = {}, limit = 500) {
  const conds = [
    filter.userId && isUuid(filter.userId) ? eq(leaveRequests.userId, filter.userId) : undefined,
    filter.from && isDay(filter.from) ? sql`${leaveRequests.endDate} >= ${filter.from}` : undefined,
    filter.to && isDay(filter.to) ? sql`${leaveRequests.startDate} <= ${filter.to}` : undefined,
  ].filter(Boolean);
  const rows = await db
    .select({ r: leaveRequests, typeName: leaveTypes.name })
    .from(leaveRequests)
    .innerJoin(leaveTypes, eq(leaveTypes.id, leaveRequests.leaveTypeId))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(leaveRequests.startDate))
    .limit(limit);
  const people = await peopleByIds(rows.flatMap((r) => [r.r.userId, r.r.decidedBy]));
  return rows.map(({ r, typeName }) => ({
    id: r.id,
    person: people.get(r.userId)?.name ?? "Former member",
    typeName,
    startDate: r.startDate,
    endDate: r.endDate,
    halfDay: r.halfDay,
    days: Number(r.daysCount),
    status: r.status,
    reason: r.reason,
    decidedBy: r.decidedBy ? (people.get(r.decidedBy)?.name ?? "Former member") : null,
    remark: r.approverRemark,
    createdAt: r.createdAt,
  }));
}

// ── Timesheets (HR) ───────────────────────────────────────────────────────

export async function allTimesheets(status: string | null, limit = 200) {
  const valid = ["draft", "submitted", "approved", "rejected"].includes(status ?? "") ? (status as "draft" | "submitted" | "approved" | "rejected") : null;
  const rows = await db.select().from(timesheets).where(valid ? eq(timesheets.status, valid) : sql`${timesheets.status} <> 'draft'`).orderBy(desc(timesheets.weekStartDate)).limit(limit);
  const people = await peopleByIds(rows.flatMap((r) => [r.userId, r.decidedBy, r.approverId]));
  return rows.map((r) => ({
    id: r.id,
    userId: r.userId,
    person: people.get(r.userId)?.name ?? "Former member",
    weekStartDate: r.weekStartDate,
    status: r.status,
    total: Number(r.totalHours),
    approver: r.approverId ? (people.get(r.approverId)?.name ?? "Former member") : "HR",
    decidedBy: r.decidedBy ? (people.get(r.decidedBy)?.name ?? "") : null,
    remark: r.approverRemark,
  }));
}

export async function timesheetLogs(userId: string, weekStart: string) {
  if (!isUuid(userId) || !isDay(weekStart)) return [];
  const rows = await db
    .select({ date: timeLogs.date, hours: timeLogs.hours, description: timeLogs.description, project: timeProjects.name })
    .from(timeLogs)
    .innerJoin(timeProjects, eq(timeProjects.id, timeLogs.projectId))
    .where(and(eq(timeLogs.userId, userId), eq(timeLogs.weekStartDate, weekStart)))
    .orderBy(asc(timeLogs.date));
  return rows.map((r) => ({ ...r, hours: Number(r.hours) }));
}

// ── Announcements ─────────────────────────────────────────────────────────

export async function postAnnouncement(actor: Actor, input: { title: string; content: string }): Promise<void> {
  const title = oneLine(input.title, 120);
  if (title.length < 3) throw new AttError("Give the announcement a title.");
  await db.insert(announcements).values({ createdBy: actor.id, title, content: String(input.content ?? "").trim().slice(0, 2000) });
}

export async function deleteAnnouncement(id: string): Promise<void> {
  if (!isUuid(id)) throw new AttError("That announcement was not found.");
  await db.delete(announcements).where(eq(announcements.id, id));
}

export const listAnnouncements = () => db.select().from(announcements).orderBy(desc(announcements.createdAt)).limit(20);
