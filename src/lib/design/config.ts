import "server-only";
import { asc, eq, sql } from "drizzle-orm";
import { db } from "./db";
import { designTypes, holidays, settings, workingSchedule, type DesignType } from "@/db/design-schema";
import { DEFAULT_SCHEDULE, slaHoursFor, workingDue, type WorkingDay } from "./rules";
import type { FormType } from "./form";
import type { Priority } from "@/db/design-schema";

/**
 * DesignDesk's own settings and reference data: the one settings row, the kinds of design, the working week and holidays, and the next
 * ticket number. Read fresh on every call (they change rarely and are small).
 */

export type Settings = typeof settings.$inferSelect;

export async function getSettings(): Promise<Settings> {
  const [row] = await db.select().from(settings).where(eq(settings.id, 1)).limit(1);
  if (row) return row;
  await db.insert(settings).values({ id: 1 }).onConflictDoNothing();
  const [made] = await db.select().from(settings).where(eq(settings.id, 1)).limit(1);
  return made;
}

/**
 * The next DF-number. One statement takes it, so two requests at the same moment get different numbers; numbers only ever go up, even
 * after "Delete all past data".
 */
export async function nextTicketSeq(): Promise<number> {
  await getSettings();
  const [r] = await db
    .update(settings)
    .set({ ticketNumberFloor: sql`${settings.ticketNumberFloor} + 1` })
    .where(eq(settings.id, 1))
    .returning({ n: settings.ticketNumberFloor });
  return r.n;
}

export async function listTypes(includeInactive = false): Promise<DesignType[]> {
  const rows = await db.select().from(designTypes).orderBy(asc(designTypes.sortOrder), asc(designTypes.name));
  return includeInactive ? rows : rows.filter((t) => t.isActive);
}

/** The active kinds of design, by key, as the form checks them. */
export async function formTypes(): Promise<Map<string, FormType & { id: string; slaHours: number; effortHours: number }>> {
  return new Map((await listTypes()).map((t) => [t.key, { id: t.id, key: t.key, name: t.name, questions: t.questions, slaHours: t.slaHours, effortHours: t.effortHours }]));
}

/** Every kind of design (active or not), by key, for showing old tickets. */
export async function typeNames(): Promise<Map<string, string>> {
  return new Map((await listTypes(true)).map((t) => [t.key, t.name]));
}

export async function getSchedule(): Promise<Record<number, WorkingDay>> {
  const rows = await db.select().from(workingSchedule);
  if (!rows.length) return DEFAULT_SCHEDULE;
  const out: Record<number, WorkingDay> = { ...DEFAULT_SCHEDULE };
  for (const r of rows) out[r.dayOfWeek] = { isWorking: r.isWorking, startHour: r.startHour, endHour: r.endHour };
  return out;
}

export async function getHolidays(): Promise<Set<string>> {
  return new Set((await db.select({ date: holidays.date }).from(holidays)).map((h) => h.date));
}

/** A deadline counted in working hours from now (or `start`), for tickets made inside the app (new versions, accepted requests with no date). */
export async function workingDeadline(typeSlaHours: number, priority: Priority, start = new Date()): Promise<Date> {
  const [schedule, hols] = await Promise.all([getSchedule(), getHolidays()]);
  return workingDue(start, slaHoursFor(typeSlaHours, priority), schedule, hols);
}
