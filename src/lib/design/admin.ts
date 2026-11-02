import "server-only";
import { asc, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "./db";
import { campaigns, designTypes, files, folders, holidays, leaves, libraryItems, libraryVersions, profiles, savedViews, settings, socialPosts, tickets, workingSchedule } from "@/db/design-schema";
import { DesignError, type SessionUser } from "./dal";
import { getSchedule, getSettings } from "./config";
import { LANGUAGE_QUESTION } from "./form";
import { listDesigners, peopleByIds, sendMail } from "./host-adapter";
import { isSlackWebhook } from "./rules";
import { SLACK_EVENTS, type SlackEvent } from "./notify";
import { removeObjects } from "./storage";
import { deleteTicketsAndParts } from "./tickets";

/** The leads' settings (kinds of design, working week, holidays, leave, team capacity, general) and the Support Admin's integrations. */

// ── Kinds of design ──────────────────────────────────────────────────────────

export const typeInput = z.object({
  name: z.string().trim().min(1, "Give it a name").max(80),
  slaHours: z.coerce.number().int().min(1, "Turnaround is at least 1 hour").max(2000),
  effortHours: z.coerce.number().min(0.5, "Effort is at least half an hour").max(500),
  editWindowHours: z.union([z.literal(""), z.coerce.number().int().min(1).max(720)]).default(""),
  isActive: z.boolean().default(true),
});

export async function saveType(id: string | null, input: z.input<typeof typeInput>): Promise<void> {
  const v = typeInput.parse(input);
  const row = { name: v.name, slaHours: v.slaHours, effortHours: v.effortHours, editWindowHours: v.editWindowHours === "" ? null : v.editWindowHours, isActive: v.isActive };
  if (id) {
    await db.update(designTypes).set(row).where(eq(designTypes.id, id));
    return;
  }
  const key = `custom-${v.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 30) || "type"}-${Date.now().toString(36)}`;
  const [last] = await db.select({ s: designTypes.sortOrder }).from(designTypes).orderBy(desc(designTypes.sortOrder)).limit(1);
  await db.insert(designTypes).values({ ...row, key, questions: [LANGUAGE_QUESTION], sortOrder: (last?.s ?? 0) + 100 });
}

// ── Working week ─────────────────────────────────────────────────────────────

export async function saveSchedule(days: { dayOfWeek: number; isWorking: boolean; startHour: number; endHour: number }[]): Promise<void> {
  for (const d of days) {
    if (!(d.dayOfWeek >= 0 && d.dayOfWeek <= 6)) throw new DesignError("Unknown day.");
    if (d.isWorking && !(d.startHour >= 0 && d.endHour <= 24 && d.startHour < d.endHour)) throw new DesignError("Each working day must end after it starts.");
  }
  if (!days.some((d) => d.isWorking)) throw new DesignError("Keep at least one working day.");
  for (const d of days) {
    const row = { isWorking: d.isWorking, startHour: Math.round(d.startHour), endHour: Math.round(d.endHour) };
    await db.insert(workingSchedule).values({ dayOfWeek: d.dayOfWeek, ...row }).onConflictDoUpdate({ target: workingSchedule.dayOfWeek, set: row });
  }
}

export { getSchedule };

// ── Holidays and leave ───────────────────────────────────────────────────────

export async function listHolidays() {
  return db.select().from(holidays).orderBy(asc(holidays.date));
}

export async function addHoliday(date: string, name: string, type: "national" | "company" | "optional"): Promise<void> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new DesignError("Choose a date.");
  const n = name.trim().slice(0, 80);
  if (!n) throw new DesignError("Name the holiday.");
  if (!["national", "company", "optional"].includes(type)) throw new DesignError("Choose a type.");
  const [dup] = await db.select({ id: holidays.id }).from(holidays).where(eq(holidays.date, date)).limit(1);
  if (dup) throw new DesignError("That day is already a holiday.");
  await db.insert(holidays).values({ date, name: n, type });
}

export async function removeHoliday(id: string): Promise<void> {
  await db.delete(holidays).where(eq(holidays.id, id));
}

export async function listTeam(): Promise<{ id: string; name: string; email: string; dailyHours: number; emailEnabled: boolean; leaves: { id: string; startDate: string; endDate: string; note: string | null }[] }[]> {
  const people = await listDesigners();
  const ids = people.map((p) => p.id);
  const [profs, ls] = await Promise.all([
    ids.length ? db.select().from(profiles).where(inArray(profiles.userId, ids)) : Promise.resolve([]),
    ids.length ? db.select().from(leaves).where(inArray(leaves.userId, ids)).orderBy(asc(leaves.startDate)) : Promise.resolve([]),
  ]);
  return people.map((p) => {
    const pr = profs.find((x) => x.userId === p.id);
    return {
      ...p,
      dailyHours: pr?.dailyCapacityHours ?? 8,
      emailEnabled: pr?.emailEnabled ?? true,
      leaves: ls.filter((l) => l.userId === p.id).map((l) => ({ id: l.id, startDate: l.startDate, endDate: l.endDate, note: l.note })),
    };
  });
}

export async function saveProfile(userId: string, patch: { dailyCapacityHours?: number; emailEnabled?: boolean }): Promise<void> {
  if (patch.dailyCapacityHours != null && !(patch.dailyCapacityHours >= 0 && patch.dailyCapacityHours <= 16)) throw new DesignError("Daily hours must be between 0 and 16.");
  await db
    .insert(profiles)
    .values({ userId, ...patch, updatedAt: new Date() })
    .onConflictDoUpdate({ target: profiles.userId, set: { ...patch, updatedAt: new Date() } });
}

export async function addLeave(userId: string, startDate: string, endDate: string, note: string): Promise<void> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) throw new DesignError("Choose the first and last day.");
  if (endDate < startDate) throw new DesignError("The last day cannot be before the first.");
  if (!(await peopleByIds([userId])).has(userId)) throw new DesignError("That person was not found.");
  await db.insert(leaves).values({ userId, startDate, endDate, note: note.trim().slice(0, 200) || null });
}

export async function removeLeave(id: string): Promise<void> {
  await db.delete(leaves).where(eq(leaves.id, id));
}

// ── General and integrations ─────────────────────────────────────────────────

export async function saveGeneral(p: { editWindowHours: number; maxFreeRevisions: number; ticketNumberFloor: number }): Promise<void> {
  const s = await getSettings();
  if (!(p.editWindowHours >= 1 && p.editWindowHours <= 720)) throw new DesignError("The edit window must be between 1 and 720 hours.");
  if (!(p.maxFreeRevisions >= 0 && p.maxFreeRevisions <= 20)) throw new DesignError("Free revisions must be between 0 and 20.");
  if (!Number.isInteger(p.ticketNumberFloor) || p.ticketNumberFloor < s.ticketNumberFloor) throw new DesignError(`The ticket number can only go up (it is ${s.ticketNumberFloor} now), so old numbers are never reused.`);
  await db.update(settings).set({ editWindowHours: Math.round(p.editWindowHours), maxFreeRevisions: Math.round(p.maxFreeRevisions), ticketNumberFloor: p.ticketNumberFloor, updatedAt: new Date() }).where(eq(settings.id, 1));
}

export async function saveSlack(webhook: string, events: Partial<Record<SlackEvent, boolean>>): Promise<void> {
  const url = webhook.trim();
  if (url && !isSlackWebhook(url)) throw new DesignError("Paste a Slack incoming-webhook address (https://hooks.slack.com/services/...).");
  await getSettings();
  const clean = Object.fromEntries(Object.keys(SLACK_EVENTS).map((k) => [k, !!events[k as SlackEvent]]));
  await db.update(settings).set({ slackWebhook: url || null, slackEvents: clean, updatedAt: new Date() }).where(eq(settings.id, 1));
}

export async function testSlack(): Promise<string> {
  const s = await getSettings();
  if (!s.slackWebhook) throw new DesignError("Save a Slack webhook first.");
  const res = await fetch(s.slackWebhook, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: "DesignDesk test message from the MCCIA App Hub." }), signal: AbortSignal.timeout(8000) }).catch(() => null);
  if (!res?.ok) throw new DesignError(`Slack did not accept the message${res ? ` (${res.status})` : ""}. Check the webhook.`);
  return "Sent. Check the Slack channel.";
}

export async function testEmail(u: SessionUser): Promise<string> {
  const r = await sendMail(u.email, "DesignDesk test email", `Hi ${u.name.split(" ")[0]},\n\nThis is a test email from DesignDesk in the MCCIA App Hub. Email is working.`);
  if (r === "sent") return `Sent to ${u.email}.`;
  throw new DesignError(r === "not_configured" ? "Email is not set up in the hub (SMTP_HOST and SMTP_FROM)." : "The email could not be sent. Check the hub's SMTP settings.");
}

/**
 * "Delete all past data": every ticket and what belongs to it, the library, campaigns and saved views, and every stored file. Kinds of
 * design, the working week, holidays, leave, team capacity and settings stay, and ticket numbering carries on (old tracking links never
 * point at a new request).
 */
export async function deleteAllData(confirm: string): Promise<{ tickets: number; files: number }> {
  if (confirm.trim() !== "DELETE") throw new DesignError('Type DELETE to confirm.');
  const all = await db.select({ id: tickets.id }).from(tickets);
  for (let i = 0; i < all.length; i += 200) await deleteTicketsAndParts(all.slice(i, i + 200).map((t) => t.id));
  await db.delete(libraryVersions);
  await db.delete(libraryItems);
  await db.delete(folders);
  await db.delete(socialPosts);
  await db.delete(campaigns);
  await db.delete(savedViews);
  const rest = await db.delete(files).returning({ key: files.storageKey });
  for (let i = 0; i < rest.length; i += 100) await removeObjects(rest.slice(i, i + 100).map((r) => r.key));
  return { tickets: all.length, files: rest.length };
}
