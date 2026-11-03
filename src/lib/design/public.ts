import "server-only";
import { and, asc, eq, ilike, or } from "drizzle-orm";
import { db } from "./db";
import { auditLogs, tickets, type Ticket, type TicketStatus } from "@/db/design-schema";
import { STATUS_LABEL, STEPS, stepOf } from "./rules";
import { numberFromTrackingToken } from "./tokens";

/**
 * What a tracking link (/track/<token>) shows, without signing in: the request's title, its five steps with when each was reached, the
 * deadline, and a short history of status changes and decisions. Never names, the brief or files.
 */

export type Tracking = {
  number: string;
  title: string;
  status: TicketStatus;
  statusLabel: string;
  currentStep: number;
  steps: { label: string; at: string | null }[];
  dueAt: string | null;
  deliveredAt: string | null;
  newerVersion: string | null;
  history: { at: string; text: string }[];
};

const STATUS_STEP_TEXT: Record<string, number> = { [STATUS_LABEL.assigned]: 1, [STATUS_LABEL.in_progress]: 2, [STATUS_LABEL.in_review]: 3, [STATUS_LABEL.delivered]: 4, [STATUS_LABEL.closed]: 4 };

/**
 * A request's five steps with when each was reached, and its history of status changes and decisions, newest first: what a requester may
 * see. Never who did what (no designer names, no assignment details), notes, time or files.
 */
export async function progressOf(t: Ticket): Promise<{ currentStep: number; steps: { label: string; at: string | null }[]; history: { at: string; text: string }[] }> {
  const logs = await db.select().from(auditLogs).where(eq(auditLogs.ticketId, t.id)).orderBy(asc(auditLogs.createdAt));
  const reached: (string | null)[] = [t.createdAt.toISOString(), null, null, null, null];
  const mark = (i: number, at: Date) => {
    if (!reached[i]) reached[i] = at.toISOString();
  };
  const history: { at: string; text: string }[] = [{ at: t.createdAt.toISOString(), text: "Request received" }];
  for (const l of logs) {
    const d = l.details as { status?: { to?: string }; assignee?: unknown; new_version?: string };
    const at = l.createdAt;
    if (l.action === "Accepted") {
      history.push({ at: at.toISOString(), text: "Accepted by the design team" });
      if (d.assignee) mark(1, at);
    } else if (l.action === "Updated" && d.status?.to) {
      history.push({ at: at.toISOString(), text: `Status changed to ${d.status.to}` });
      const step = STATUS_STEP_TEXT[d.status.to];
      if (step != null) for (let i = 1; i <= step; i++) mark(i, at);
    } else if (l.action === "Updated" && d.assignee) {
      mark(1, at);
    } else if (l.action === "Sent for review") {
      history.push({ at: at.toISOString(), text: "Design sent for review" });
      for (let i = 1; i <= 3; i++) mark(i, at);
    } else if (l.action === "Requester approved") {
      history.push({ at: at.toISOString(), text: "Design approved" });
      for (let i = 1; i <= 4; i++) mark(i, at);
    } else if (l.action === "Requester asked for changes") history.push({ at: at.toISOString(), text: "Changes requested" });
    else if (l.action === "Superseded") history.push({ at: at.toISOString(), text: d.new_version ? `A new version was opened: ${d.new_version}` : "A new version was opened" });
    else if (l.action === "Declined") history.push({ at: at.toISOString(), text: "Request declined" });
    else if (l.action === "Auto-closed") history.push({ at: at.toISOString(), text: "Closed" });
  }
  if (t.deliveredAt) for (let i = 1; i <= 4; i++) mark(i, t.deliveredAt);
  const current = stepOf(t.status);
  // A step can only show a time once the request is at or past it.
  const steps = STEPS.map((label, i) => ({ label, at: i <= current ? reached[i] : null }));

  return { currentStep: current, steps, history: history.reverse().slice(0, 20) };
}

export async function trackingByToken(token: string): Promise<Tracking | null> {
  const number = numberFromTrackingToken(token);
  if (!number) return null;
  const [t] = await db.select().from(tickets).where(eq(tickets.number, number)).limit(1);
  if (!t) return null;
  const { currentStep: current, steps, history } = await progressOf(t);

  let newerVersion: string | null = null;
  if (t.status === "superseded") {
    const base = t.number.split("-V")[0];
    const versions = await db
      .select({ number: tickets.number, v: tickets.versionNumber })
      .from(tickets)
      .where(and(or(eq(tickets.number, base), ilike(tickets.number, `${base}-V%`))));
    newerVersion = versions.filter((x) => x.v > t.versionNumber).sort((a, b) => b.v - a.v)[0]?.number ?? null;
  }

  return {
    number: t.number,
    title: t.title,
    status: t.status,
    statusLabel: STATUS_LABEL[t.status],
    currentStep: current,
    steps,
    dueAt: t.dueAt?.toISOString() ?? null,
    deliveredAt: t.deliveredAt?.toISOString() ?? null,
    newerVersion,
    history,
  };
}
