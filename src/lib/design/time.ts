import "server-only";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "./db";
import { tickets, timeEntries } from "@/db/design-schema";
import { DesignError, type SessionUser } from "./dal";
import { peopleByIds } from "./host-adapter";
import { ticketForTeam } from "./tickets";

/**
 * Time on a ticket: a start/stop timer (one running timer per person: starting one stops any other) and hours logged by hand. The
 * ticket's time_spent_seconds is the sum of its finished entries, kept up to date here.
 */

export type TimeDto = { id: string; user: string | null; userId: string; startedAt: string; endedAt: string | null; seconds: number; note: string | null; source: string };

export async function timeFor(ticketId: string): Promise<TimeDto[]> {
  const rows = await db.select().from(timeEntries).where(eq(timeEntries.ticketId, ticketId)).orderBy(desc(timeEntries.startedAt)).limit(200);
  const people = await peopleByIds(rows.map((r) => r.userId));
  return rows.map((r) => ({ id: r.id, user: people.get(r.userId)?.name ?? null, userId: r.userId, startedAt: r.startedAt.toISOString(), endedAt: r.endedAt?.toISOString() ?? null, seconds: r.seconds, note: r.note, source: r.source }));
}

async function recount(ticketId: string) {
  await db
    .update(tickets)
    .set({ timeSpentSeconds: sql`(select coalesce(sum(seconds), 0)::int from design_time_entries where ticket_id = ${ticketId} and ended_at is not null)` })
    .where(eq(tickets.id, ticketId));
}

async function stopRunning(userId: string) {
  const running = await db.select().from(timeEntries).where(and(eq(timeEntries.userId, userId), isNull(timeEntries.endedAt)));
  const now = new Date();
  for (const r of running) {
    const seconds = Math.max(0, Math.min(16 * 3600, Math.floor((+now - +r.startedAt) / 1000)));
    await db.update(timeEntries).set({ endedAt: now, seconds }).where(eq(timeEntries.id, r.id));
    await recount(r.ticketId);
  }
}

export async function startTimer(u: SessionUser, ticketId: string) {
  await ticketForTeam(u, ticketId);
  await stopRunning(u.id);
  await db.insert(timeEntries).values({ ticketId, userId: u.id, startedAt: new Date(), source: "timer" });
}

export async function stopTimer(u: SessionUser) {
  await stopRunning(u.id);
}

export async function logTime(u: SessionUser, ticketId: string, minutes: number, note: string, day: string | null) {
  await ticketForTeam(u, ticketId);
  if (!Number.isFinite(minutes) || minutes < 1 || minutes > 16 * 60) throw new DesignError("Log between 1 minute and 16 hours.");
  const startedAt = day && /^\d{4}-\d{2}-\d{2}$/.test(day) ? new Date(`${day}T04:30:00Z`) : new Date();
  if (+startedAt > Date.now() + 86_400_000) throw new DesignError("Time cannot be logged for a future day.");
  const seconds = Math.round(minutes * 60);
  await db.insert(timeEntries).values({ ticketId, userId: u.id, startedAt, endedAt: new Date(+startedAt + seconds * 1000), seconds, note: note.trim().slice(0, 200) || null, source: "manual" });
  await recount(ticketId);
}

export async function deleteTime(u: SessionUser, entryId: string) {
  const [e] = await db.select().from(timeEntries).where(eq(timeEntries.id, entryId)).limit(1);
  if (!e) throw new DesignError("That entry was not found.");
  await ticketForTeam(u, e.ticketId);
  if (e.userId !== u.id && !u.lead) throw new DesignError("Only the person who logged it, or a design lead, can remove it.");
  await db.delete(timeEntries).where(eq(timeEntries.id, entryId));
  await recount(e.ticketId);
}

/** The person's running timer, if any (for the ticket page). */
export async function runningTimer(userId: string): Promise<{ ticketId: string; startedAt: string } | null> {
  const [r] = await db.select().from(timeEntries).where(and(eq(timeEntries.userId, userId), isNull(timeEntries.endedAt))).limit(1);
  return r ? { ticketId: r.ticketId, startedAt: r.startedAt.toISOString() } : null;
}
