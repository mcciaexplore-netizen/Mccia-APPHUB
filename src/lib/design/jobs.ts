import "server-only";
import { and, eq, inArray, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { auditLogs } from "@/db/design-schema";
import { siteUrl } from "./host-adapter";
import { db } from "./db";
import { approvalRequests, settings, tickets, type TicketStatus } from "@/db/design-schema";
import { audit } from "./audit";
import { designEnabled } from "./flags";
import { getSettings } from "./config";
import { removeUnclaimed } from "./files";
import { logError } from "@/lib/log-error";
import * as notice from "./notify";
import { REVIEW_REMINDER_AFTER_HOURS } from "./rules";

/**
 * The scheduled jobs. They run from the daily cron (/api/cron/design-tick) and, between those, after any DesignDesk page is served if they
 * last ran more than five minutes ago (runIfDue). One run:
 *   1. closes delivered tickets whose edit window has ended (Closed, or Closed without approval when nothing was approved)
 *   2. warns when an open ticket is due within 6 hours, and marks it overdue (telling the leads once) when its deadline passes
 *   3. reminds the requester after a day of an unanswered review, and closes it without approval after two days
 *   4. removes uploads that were never used, after a day
 * Every step works ticket by ticket; one failure is logged and the rest carry on. Notices are de-duplicated by the hub bell's key.
 */

const OPEN: TicketStatus[] = ["new", "assigned", "in_progress"];
export const TICK_GAP_MS = 5 * 60_000;

async function each<T>(items: T[], step: string, fn: (item: T) => Promise<void>) {
  for (const item of items) {
    try {
      await fn(item);
    } catch (e) {
      logError(`[design] job ${step} failed`, e);
    }
  }
}

/** True the first time it is asked for this ticket, action and key (each warning or reminder goes out once); notes it in the history. */
async function once(ticketId: string, action: string, key: string): Promise<boolean> {
  const [seen] = await db
    .select({ id: auditLogs.id })
    .from(auditLogs)
    .where(and(eq(auditLogs.ticketId, ticketId), eq(auditLogs.action, action), sql`${auditLogs.details}->>'key' = ${key}`))
    .limit(1);
  if (seen) return false;
  await audit(ticketId, null, action, { key }, "System");
  return true;
}

const istText = (d: Date) => {
  const x = new Date(+d + 330 * 60_000);
  return `${x.getUTCDate()} ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][x.getUTCMonth()]}, ${String(x.getUTCHours()).padStart(2, "0")}:${String(x.getUTCMinutes()).padStart(2, "0")}`;
};

export async function runJobs(): Promise<Record<string, number>> {
  const now = new Date();
  const counts = { closed: 0, warned: 0, overdue: 0, reminded: 0, expired: 0, cleaned: 0 };

  const ended = await db.select().from(tickets).where(and(eq(tickets.status, "delivered"), isNotNull(tickets.editWindowEndsAt), lt(tickets.editWindowEndsAt, now)));
  await each(ended, "edit-window", async (t) => {
    const [approved] = await db.select({ id: approvalRequests.id }).from(approvalRequests).where(and(eq(approvalRequests.ticketId, t.id), eq(approvalRequests.status, "approved"))).limit(1);
    const status = approved ? "closed" : "closed_without_approval";
    const [done] = await db.update(tickets).set({ status, isLocked: true, updatedAt: now }).where(and(eq(tickets.id, t.id), eq(tickets.status, "delivered"))).returning({ id: tickets.id });
    if (!done) return;
    counts.closed++;
    await audit(t.id, null, "Auto-closed", { status, reason: "Edit window ended" }, "System");
  });

  const open = await db.select().from(tickets).where(and(inArray(tickets.status, OPEN), isNotNull(tickets.dueAt), lt(tickets.dueAt, new Date(+now + 6 * 3_600_000))));
  await each(open, "sla", async (t) => {
    if (+t.dueAt! <= +now) {
      if (t.isOverdue) return;
      const [flagged] = await db.update(tickets).set({ isOverdue: true }).where(and(eq(tickets.id, t.id), eq(tickets.isOverdue, false))).returning({ id: tickets.id });
      if (!flagged) return;
      counts.overdue++;
      await notice.overdue(t);
    } else {
      if (!(await once(t.id, "Due-soon warning sent", t.dueAt!.toISOString()))) return;
      counts.warned++;
      await notice.dueSoon(t);
    }
  });

  const pending = await db
    .select({ r: approvalRequests, t: tickets })
    .from(approvalRequests)
    .innerJoin(tickets, eq(tickets.id, approvalRequests.ticketId))
    .where(and(eq(approvalRequests.status, "pending"), eq(tickets.status, "in_review"), eq(tickets.isLocked, false)));
  await each(pending, "review", async ({ r, t }) => {
    if (+r.expiresAt <= +now) {
      const [settled] = await db.update(approvalRequests).set({ status: "expired" }).where(and(eq(approvalRequests.id, r.id), eq(approvalRequests.status, "pending"))).returning({ id: approvalRequests.id });
      if (!settled) return;
      await db.update(tickets).set({ status: "closed_without_approval", isLocked: true, updatedAt: now }).where(eq(tickets.id, t.id));
      await audit(t.id, null, "Auto-closed", { status: "Closed without approval", reason: "No reply to the review within 2 days" }, "System");
      await notice.autoClosed(t, "The requester did not reply to the review within 2 days.");
      counts.expired++;
      return;
    }
    if (+now - +r.createdAt >= REVIEW_REMINDER_AFTER_HOURS * 3_600_000) {
      if (!(await once(t.id, "Review reminder sent", r.id))) return;
      await notice.reviewReminder(t, `${siteUrl()}/design/my-requests`, istText(r.expiresAt));
      counts.reminded++;
    }
  });

  counts.cleaned = await removeUnclaimed(new Date(+now - 86_400_000)).catch(() => 0);
  return counts;
}

/** After a page is served: run the jobs if they last ran more than five minutes ago. Claiming the run is one statement, so only one runs. */
export async function runIfDue(): Promise<void> {
  if (!designEnabled()) return;
  try {
    await getSettings();
    const cutoff = new Date(Date.now() - TICK_GAP_MS);
    const [claimed] = await db
      .update(settings)
      .set({ lastTickAt: new Date() })
      .where(and(eq(settings.id, 1), or(isNull(settings.lastTickAt), lt(settings.lastTickAt, cutoff))))
      .returning({ id: settings.id });
    if (claimed) await runJobs();
  } catch (e) {
    logError("[design] scheduled jobs failed", e);
  }
}

