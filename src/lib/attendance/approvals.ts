import "server-only";
import { and, desc, eq, gte, inArray, isNotNull, lte, ne, or, sql, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import { db, rowsOf } from "./db";
import { attendance, compoffRequests, earlyDepartures, leaveRequests, leaveTypes, regularizationRequests, timesheets, wfhRequests } from "@/db/attendance-schema";
import { AttError } from "./dal";
import { getSettings, profileOf } from "./config";
import { loadDays, viewOf } from "./days";
import { activeUserIds, peopleByIds } from "./host-adapter";
import { syncBalance } from "./leave";
import { notifyDecision } from "./notify";
import { computeDay } from "./checkin-rules";
import { expiryFor } from "./compoff";
import { canDecide, isUuid, MAX_REASON, REQUEST_KINDS, type RequestKind } from "./att.manifest";
import { addDays, formatDay, istDay, istMinutes, istMoment, parseHm } from "./time";

/**
 * One inbox for every kind of request (leave, WFH, early check-out, regularization, comp-off, timesheets), the decision and what it changes,
 * and the history. The reporting manager a request was sent to decides it (Team approvals). HR decide only what was sent to HR (no manager
 * assigned) or what waits for a manager who is no longer active; everything else they can see but not change (att.manifest.ts canDecide).
 * Nobody decides their own request. A decision only changes a request that is still pending (the update says so), so two people deciding
 * at once cannot both win.
 */

export type InboxItem = {
  kind: RequestKind;
  id: string;
  userId: string;
  person: string;
  title: string;
  when: string;
  detail: string;
  reason: string;
  status: string;
  approverId: string | null;
  approver: string | null;
  decidedBy: string | null;
  decidedAt: Date | null;
  remark: string | null;
  createdAt: Date;
  attachment: boolean;
  /** Who decided it (a name), for the history. */
  decider: string | null;
  /** Sent to HR: no manager assigned, or the manager is no longer active. */
  toHr: boolean;
  /** Whether the person looking at the list may decide it. */
  canAct: boolean;
};

type Actor = { id: string; name: string; hr: boolean };
type Scope = { mode: "pending" | "history"; actor: Actor; all: boolean; limit?: number; hrOnly?: boolean };

const range = (a: string, b: string) => (a === b ? formatDay(a) : `${formatDay(a)} – ${formatDay(b)}`);

/** Which rows a list may show: pending ones sent to the actor (or all, for HR), or decided ones they decided or were sent. */
type Cols = { status: PgColumn; approverId: PgColumn; decidedBy: PgColumn; userId: PgColumn };
function visible(t: Cols, s: Scope, pendingValue: string, cancellable = true): SQL | undefined {
  const notOwn = ne(t.userId, s.actor.id);
  if (s.mode === "pending") return s.all ? and(eq(t.status, pendingValue), notOwn) : and(eq(t.status, pendingValue), eq(t.approverId, s.actor.id), notOwn);
  // Decided: approved or rejected, or cancelled by its owner after it was decided (the decision still happened).
  const decided = cancellable ? or(inArray(t.status, ["approved", "rejected"]), and(eq(t.status, "cancelled"), isNotNull(t.decidedBy))) : inArray(t.status, ["approved", "rejected"]);
  return s.all ? decided : and(decided, or(eq(t.decidedBy, s.actor.id), eq(t.approverId, s.actor.id)));
}

async function items(s: Scope): Promise<InboxItem[]> {
  const limit = s.limit ?? 200;
  const order = s.mode === "pending" ? "asc" : "desc";
  const [leave, wfh, reg, co, ts, early] = await Promise.all([
    db
      .select({ r: leaveRequests, typeName: leaveTypes.name })
      .from(leaveRequests)
      .innerJoin(leaveTypes, eq(leaveTypes.id, leaveRequests.leaveTypeId))
      .where(visible(leaveRequests, s, "pending"))
      .orderBy(order === "asc" ? leaveRequests.createdAt : desc(leaveRequests.approvedAt))
      .limit(limit),
    db.select().from(wfhRequests).where(visible(wfhRequests, s, "pending")).orderBy(order === "asc" ? wfhRequests.createdAt : desc(wfhRequests.approvedAt)).limit(limit),
    db.select().from(regularizationRequests).where(visible(regularizationRequests, s, "pending")).orderBy(order === "asc" ? regularizationRequests.createdAt : desc(regularizationRequests.approvedAt)).limit(limit),
    db.select().from(compoffRequests).where(visible(compoffRequests, s, "pending")).orderBy(order === "asc" ? compoffRequests.createdAt : desc(compoffRequests.approvedAt)).limit(limit),
    db.select().from(timesheets).where(visible(timesheets, s, "submitted", false)).orderBy(order === "asc" ? timesheets.submittedAt : desc(timesheets.approvedAt)).limit(limit),
    db.select().from(earlyDepartures).where(visible(earlyDepartures, s, "pending")).orderBy(order === "asc" ? earlyDepartures.createdAt : desc(earlyDepartures.approvedAt)).limit(limit),
  ]);
  const base = (r: { id: string; userId: string; status: string; approverId: string | null; decidedBy: string | null; approvedAt: Date | null; approverRemark: string | null; createdAt: Date }) => ({
    id: r.id,
    userId: r.userId,
    status: r.status,
    approverId: r.approverId,
    decidedBy: r.decidedBy,
    decidedAt: r.approvedAt,
    remark: r.approverRemark,
    createdAt: r.createdAt,
  });
  const out: Omit<InboxItem, "person" | "approver" | "decider" | "toHr" | "canAct">[] = [
    ...leave.map(({ r, typeName }) => ({
      ...base(r),
      kind: "leave" as const,
      title: typeName,
      when: range(r.startDate, r.endDate) + (r.halfDay !== "none" ? ` (${r.halfDay} half)` : ""),
      detail: `${Number(r.daysCount)} day${Number(r.daysCount) === 1 ? "" : "s"}`,
      reason: r.reason,
      attachment: !!r.attachmentUrl,
    })),
    ...early.map((r) => ({ ...base(r), kind: "early" as const, title: "Check out early", when: formatDay(r.date), detail: "Before the shift's hours are worked", reason: r.reason, attachment: false })),
    ...wfh.map((r) => ({ ...base(r), kind: "wfh" as const, title: "Work from home", when: formatDay(r.date), detail: r.planNote, reason: r.reason, attachment: false })),
    ...reg.map((r) => ({
      ...base(r),
      kind: "regularization" as const,
      title: r.isFuture ? "Planned working day" : r.missed === "checkout" ? "Missed check-out" : r.missed === "checkin" ? "Missed check-in" : "Missed both punches",
      when: formatDay(r.date),
      detail: r.isFuture
        ? `Plans to work ${r.plannedCheckin?.slice(0, 5) ?? "?"} – ${r.plannedCheckout?.slice(0, 5) ?? "?"}`
        : [r.requestedCheckin ? `In ${r.requestedCheckin.slice(0, 5)}` : null, r.requestedCheckout ? `Out ${r.requestedCheckout.slice(0, 5)}` : null].filter(Boolean).join(" · "),
      reason: r.reason,
      attachment: false,
    })),
    ...co.map((r) => ({
      ...base(r),
      kind: "compoff" as const,
      title: `${r.compoffType === "half" ? "Half" : "Full"}-day comp-off`,
      when: `Worked ${formatDay(r.workedDate)}`,
      detail: r.expiryDate ? `Expires ${formatDay(r.expiryDate)}` : "",
      reason: r.reason,
      attachment: false,
    })),
    ...ts.map((r) => ({
      ...base({ ...r, createdAt: r.submittedAt ?? r.createdAt }),
      kind: "timesheet" as const,
      title: "Timesheet",
      when: range(r.weekStartDate, addDays(r.weekStartDate, 6)),
      detail: `${Number(r.totalHours)} hours`,
      reason: "",
      attachment: false,
    })),
  ];
  const [people, active] = await Promise.all([peopleByIds(out.flatMap((i) => [i.userId, i.approverId, i.decidedBy])), activeUserIds(out.map((i) => i.approverId))]);
  return out
    .map((i) => {
      const approverActive = !i.approverId || active.has(i.approverId);
      return {
        ...i,
        person: people.get(i.userId)?.name ?? "Former member",
        approver: i.approverId ? (people.get(i.approverId)?.name ?? "Former member") : null,
        decider: i.decidedBy ? (people.get(i.decidedBy)?.name ?? "Former member") : null,
        toHr: !i.approverId || !approverActive,
        canAct: (i.status === "pending" || i.status === "submitted") && canDecide(s.actor, i, approverActive),
      };
    })
    .filter((i) => !s.hrOnly || i.toHr)
    .sort((a, b) => (s.mode === "pending" ? +a.createdAt - +b.createdAt : +(b.decidedAt ?? b.createdAt) - +(a.decidedAt ?? a.createdAt)));
}

/** What waits for the actor as a reporting manager: sent to them by name (Team approvals). With `all` (HR), every pending request, to see. */
export const pendingFor = (actor: Actor, all = false) => items({ mode: "pending", actor, all: all && actor.hr });
/** What waits for HR to decide: sent to HR (no manager assigned), or waiting for a manager who is no longer active. */
export const hrQueue = (actor: Actor) => (actor.hr ? items({ mode: "pending", actor, all: true, hrOnly: true }) : Promise.resolve([] as InboxItem[]));
/** Past decisions the actor made or was sent; HR with `all` see every decision. */
export const historyFor = (actor: Actor, all = false) => items({ mode: "history", actor, all: all && actor.hr, limit: 100 });

/** How many requests wait for the person as an approver (sent to them by name). */
export async function pendingCountFor(userId: string): Promise<number> {
  const res = await db.execute(sql`
    select (select count(*) from att_leave_requests where status = 'pending' and approver_id = ${userId})
      + (select count(*) from att_wfh_requests where status = 'pending' and approver_id = ${userId})
      + (select count(*) from att_early_departures where status = 'pending' and approver_id = ${userId})
      + (select count(*) from att_regularization_requests where status = 'pending' and approver_id = ${userId})
      + (select count(*) from att_compoff_requests where status = 'pending' and approver_id = ${userId})
      + (select count(*) from att_timesheets where status = 'submitted' and approver_id = ${userId}) as n`);
  return Number(rowsOf<{ n: string }>(res)[0]?.n ?? 0);
}

/** What waits for HR to decide (sent to HR, or its manager is no longer active), for HR's sidebar. */
export async function pendingCountAll(): Promise<number> {
  const toHr = sql`(approver_id is null or approver_id not in (select id from users where is_active and status = 'approved'))`;
  const res = await db.execute(sql`
    select (select count(*) from att_leave_requests where status = 'pending' and ${toHr}) + (select count(*) from att_wfh_requests where status = 'pending' and ${toHr})
      + (select count(*) from att_early_departures where status = 'pending' and ${toHr})
      + (select count(*) from att_regularization_requests where status = 'pending' and ${toHr}) + (select count(*) from att_compoff_requests where status = 'pending' and ${toHr})
      + (select count(*) from att_timesheets where status = 'submitted' and ${toHr}) as n`);
  return Number(rowsOf<{ n: string }>(res)[0]?.n ?? 0);
}

/** canDecide with the manager's standing looked up (HR may take over only from a manager who is no longer active). */
async function mayDecide(actor: Actor, r: { userId: string; approverId: string | null }): Promise<boolean> {
  if (canDecide(actor, r)) return true;
  if (!actor.hr || !r.approverId) return false;
  return canDecide(actor, r, (await activeUserIds([r.approverId])).has(r.approverId));
}

const NOT_YOURS = (r: { approverId: string | null; userId?: string }, actorId?: string) =>
  new AttError(
    actorId && r.userId === actorId
      ? "You cannot decide your own request."
      : r.approverId
        ? "Only the reporting manager this was sent to can decide it. HR can see it but not change it."
        : "This request is not yours to decide.",
  );

// ── Deciding ──────────────────────────────────────────────────────────────

const decidedSet = (actorId: string, approve: boolean, remark: string | null) => ({ status: approve ? ("approved" as const) : ("rejected" as const), decidedBy: actorId, approvedAt: new Date(), approverRemark: remark });

/** Approves or rejects one request (a rejection needs a remark). Returns a message for the page. */
export async function decide(actor: Actor, kind: RequestKind, id: string, approve: boolean, remarkIn: string): Promise<string> {
  if (!REQUEST_KINDS.includes(kind) || !isUuid(id)) throw new AttError("That request was not found.");
  const remark = String(remarkIn ?? "").trim().slice(0, MAX_REASON) || null;
  if (!approve && !remark) throw new AttError("Give a remark when rejecting, so the person knows why.");
  const stale = () => new AttError("That request has already been decided or withdrawn. Reload the page.");
  const word = approve ? "Approved" : "Rejected";

  if (kind === "leave") {
    const [r] = await db.select({ r: leaveRequests, typeName: leaveTypes.name, isCompoff: leaveTypes.isCompoff }).from(leaveRequests).innerJoin(leaveTypes, eq(leaveTypes.id, leaveRequests.leaveTypeId)).where(eq(leaveRequests.id, id));
    if (!r || r.r.status !== "pending") throw stale();
    if (!(await mayDecide(actor, r.r))) throw NOT_YOURS(r.r, actor.id);
    if (approve) {
      const punched = await db
        .select({ date: attendance.date })
        .from(attendance)
        .where(and(eq(attendance.userId, r.r.userId), gte(attendance.date, r.r.startDate), lte(attendance.date, r.r.endDate), sql`${attendance.checkInTime} is not null`));
      if (punched.length && r.r.halfDay !== "second") throw new AttError(`They have since checked in on ${formatDay(punched[0].date)}. Reject it and ask them to apply again.`);
    }
    const done = await db.update(leaveRequests).set(decidedSet(actor.id, approve, remark)).where(and(eq(leaveRequests.id, id), eq(leaveRequests.status, "pending"))).returning({ id: leaveRequests.id });
    if (!done.length) throw stale();
    if (!r.isCompoff) await syncBalance(r.r.userId, r.r.leaveTypeId, Number(r.r.startDate.slice(0, 4)));
    await notifyDecision({ kind, id, requesterId: r.r.userId, approved: approve, by: actor.name, deciderId: actor.id, remark, summary: `${r.typeName}, ${range(r.r.startDate, r.r.endDate)}`, link: "/attendance/leave" });
    return `${word}.`;
  }

  if (kind === "wfh") {
    const [r] = await db.select().from(wfhRequests).where(eq(wfhRequests.id, id));
    if (!r || r.status !== "pending") throw stale();
    if (!(await mayDecide(actor, r))) throw NOT_YOURS(r, actor.id);
    const done = await db.update(wfhRequests).set(decidedSet(actor.id, approve, remark)).where(and(eq(wfhRequests.id, id), eq(wfhRequests.status, "pending"))).returning({ id: wfhRequests.id });
    if (!done.length) throw stale();
    await notifyDecision({ kind, id, requesterId: r.userId, approved: approve, by: actor.name, deciderId: actor.id, remark, summary: `Work from home on ${formatDay(r.date)}`, link: "/attendance/more/wfh" });
    return `${word}.`;
  }

  if (kind === "early") {
    const [r] = await db.select().from(earlyDepartures).where(eq(earlyDepartures.id, id));
    if (!r || r.status !== "pending") throw stale();
    if (!(await mayDecide(actor, r))) throw NOT_YOURS(r, actor.id);
    const done = await db.update(earlyDepartures).set(decidedSet(actor.id, approve, remark)).where(and(eq(earlyDepartures.id, id), eq(earlyDepartures.status, "pending"))).returning({ id: earlyDepartures.id });
    if (!done.length) throw stale();
    await notifyDecision({ kind, id, requesterId: r.userId, approved: approve, by: actor.name, deciderId: actor.id, remark, summary: approve ? `You can check out now (${formatDay(r.date)})` : `Early check-out on ${formatDay(r.date)}`, link: "/attendance" });
    return `${word}${approve ? ": they can check out now" : ""}.`;
  }

  if (kind === "regularization") {
    const [r] = await db.select().from(regularizationRequests).where(eq(regularizationRequests.id, id));
    if (!r || r.status !== "pending") throw stale();
    if (!(await mayDecide(actor, r))) throw NOT_YOURS(r, actor.id);
    const done = await db
      .update(regularizationRequests)
      .set(decidedSet(actor.id, approve, remark))
      .where(and(eq(regularizationRequests.id, id), eq(regularizationRequests.status, "pending")))
      .returning({ id: regularizationRequests.id });
    if (!done.length) throw stale();
    // A plan for a day ahead is only agreed: the person still checks in and out that day.
    if (approve && !r.isFuture) await applyRegularization(r);
    const summary = r.isFuture ? `Planned working day ${formatDay(r.date)} (${r.plannedCheckin?.slice(0, 5)} – ${r.plannedCheckout?.slice(0, 5)})` : `Regularization for ${formatDay(r.date)}`;
    await notifyDecision({ kind, id, requesterId: r.userId, approved: approve, by: actor.name, deciderId: actor.id, remark, summary, link: "/attendance/more/regularization" });
    return `${word}${approve ? (r.isFuture ? ": the day is planned" : ": the day is corrected") : ""}.`;
  }

  if (kind === "compoff") {
    const [r] = await db.select().from(compoffRequests).where(eq(compoffRequests.id, id));
    if (!r || r.status !== "pending") throw stale();
    if (!(await mayDecide(actor, r))) throw NOT_YOURS(r, actor.id);
    const expiry = expiryFor(r.workedDate, (await getSettings()).compoffExpiryDays);
    const done = await db
      .update(compoffRequests)
      .set({ ...decidedSet(actor.id, approve, remark), expiryDate: approve ? expiry : null })
      .where(and(eq(compoffRequests.id, id), eq(compoffRequests.status, "pending")))
      .returning({ id: compoffRequests.id });
    if (!done.length) throw stale();
    await notifyDecision({ kind, id, requesterId: r.userId, approved: approve, by: actor.name, deciderId: actor.id, remark, summary: `Comp-off for working ${formatDay(r.workedDate)}${approve ? ` (use by ${formatDay(expiry)})` : ""}`, link: "/attendance/more/compoff" });
    return `${word}.`;
  }

  const [t] = await db.select().from(timesheets).where(eq(timesheets.id, id));
  if (!t || t.status !== "submitted") throw stale();
  if (!(await mayDecide(actor, t))) throw NOT_YOURS(t, actor.id);
  const done = await db.update(timesheets).set(decidedSet(actor.id, approve, remark)).where(and(eq(timesheets.id, id), eq(timesheets.status, "submitted"))).returning({ id: timesheets.id });
  if (!done.length) throw stale();
  await notifyDecision({ kind, id: `${id}:${Date.now()}`, requesterId: t.userId, approved: approve, by: actor.name, deciderId: actor.id, remark, summary: `Week of ${formatDay(t.weekStartDate)}${approve ? "" : ": it is open again for changes"}`, link: `/attendance/time?week=${t.weekStartDate}` });
  return `${word}.`;
}

/** Writes an approved regularization onto the day: the corrected punch(es), method "manual", figures recomputed, linked to the request. */
async function applyRegularization(r: typeof regularizationRequests.$inferSelect): Promise<void> {
  if (r.isFuture) return;
  const [profile, settings, data] = await Promise.all([profileOf(r.userId), getSettings(), loadDays([r.userId], r.date, r.date)]);
  const view = viewOf(data, r.userId, r.date, istDay());
  const [existing] = await db.select().from(attendance).where(and(eq(attendance.userId, r.userId), eq(attendance.date, r.date)));
  const inMin = parseHm(r.requestedCheckin);
  const outMin = parseHm(r.requestedCheckout);
  const checkIn = inMin != null ? istMoment(r.date, inMin) : (existing?.checkInTime ?? null);
  const checkOut = outMin != null ? istMoment(r.date, outMin) : (existing?.checkOutTime ?? null);
  if (!checkIn || !checkOut) return;
  const isExtraWork = existing?.isExtraWork ?? view.kind !== "working";
  const isWfh = existing?.isWfh ?? false;
  const fig = computeDay({
    workedMs: +checkOut - +checkIn,
    checkInMin: istMinutes(checkIn),
    checkOutMin: istMinutes(checkOut),
    shift: profile.shift,
    earlyOutMinutes: settings.earlyOutMinutes,
    isWfh,
    isExtraWork,
    halfLeave: view.leave?.half ?? null,
  });
  const values = {
    checkInTime: checkIn,
    checkOutTime: checkOut,
    checkOutMethod: "manual" as const,
    hoursWorked: fig.hoursWorked,
    deficitHours: fig.deficitHours,
    excessHours: fig.excessHours,
    isLate: fig.isLate,
    isEarlyOut: fig.isEarlyOut,
    status: fig.status,
    regularizationId: r.id,
    updatedAt: new Date(),
  };
  if (existing) await db.update(attendance).set(values).where(eq(attendance.id, existing.id));
  else
    await db
      .insert(attendance)
      .values({ userId: r.userId, date: r.date, shiftId: profile.shift.id, checkInMethod: "manual", isWfh, isExtraWork, ...values })
      .onConflictDoUpdate({ target: [attendance.userId, attendance.date], set: values });
}

/** Whether `viewerId` may open a leave request's document: its owner, the person it was sent to, or HR. */
export async function leaveAttachmentFor(viewer: { id: string; hr: boolean }, leaveId: string): Promise<{ key: string; name: string } | null> {
  if (!isUuid(leaveId)) return null;
  const [r] = await db.select().from(leaveRequests).where(eq(leaveRequests.id, leaveId));
  if (!r?.attachmentUrl) return null;
  if (!(viewer.hr || r.userId === viewer.id || r.approverId === viewer.id)) return null;
  return { key: r.attachmentUrl, name: r.attachmentName ?? "document" };
}
