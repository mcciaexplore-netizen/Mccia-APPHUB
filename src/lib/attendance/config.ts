import "server-only";
import { cache } from "react";
import { and, asc, eq, gte, inArray, lte } from "drizzle-orm";
import { db } from "./db";
import { holidays, settings as settingsTable, shifts, userProfiles, type Shift, type UserProfile } from "@/db/attendance-schema";
import { parseSettings, type AttSettings } from "./settings";
import type { Calendar, ShiftHours } from "./calendar";
import { parseHm } from "./time";

/** What every page needs: the settings, the shifts, holidays as a calendar, and people's profiles with their shift. */

export const getSettings = cache(async (): Promise<AttSettings> => {
  const [row] = await db.select({ value: settingsTable.value }).from(settingsTable).where(eq(settingsTable.key, "config"));
  return parseSettings(row?.value);
});

/** Saves the whole settings object (already checked by parseSettings). */
export async function saveSettings(userId: string, value: AttSettings): Promise<void> {
  await db
    .insert(settingsTable)
    .values({ key: "config", value: value as unknown as Record<string, unknown>, updatedBy: userId })
    .onConflictDoUpdate({ target: settingsTable.key, set: { value: value as unknown as Record<string, unknown>, updatedBy: userId, updatedAt: new Date() } });
}

export const listShifts = cache(async (): Promise<Shift[]> => db.select().from(shifts).orderBy(asc(shifts.name)));

export type ShiftRules = ShiftHours & { id: string | null; name: string; firstHalfEndMin: number; secondHalfStartMin: number; startTime: string; endTime: string };

/** A shift as minutes (General's hours if there is none at all). */
export function shiftRules(s: Shift | null | undefined): ShiftRules {
  if (!s) return { id: null, name: "General", startMin: 600, endMin: 1050, graceMinutes: 45, fullDayHours: 7.5, halfDayHours: 4, firstHalfEndMin: 840, secondHalfStartMin: 840, startTime: "10:00", endTime: "17:30" };
  return {
    id: s.id,
    name: s.name,
    startMin: parseHm(s.startTime) ?? 600,
    endMin: parseHm(s.endTime) ?? 1050,
    graceMinutes: s.graceMinutes,
    fullDayHours: Number(s.fullDayHours),
    halfDayHours: Number(s.halfDayHours),
    firstHalfEndMin: parseHm(s.firstHalfEnd) ?? 840,
    secondHalfStartMin: parseHm(s.secondHalfStart) ?? 840,
    startTime: s.startTime.slice(0, 5),
    endTime: s.endTime.slice(0, 5),
  };
}

/** The holidays from `from` to `to` and the Saturday rule, as a calendar. */
export async function calendarFor(from: string, to: string): Promise<Calendar> {
  const [rows, s] = await Promise.all([
    db.select({ date: holidays.date, name: holidays.name, isOptional: holidays.isOptional }).from(holidays).where(and(gte(holidays.date, from), lte(holidays.date, to))),
    getSettings(),
  ]);
  return { holidays: new Map(rows.map((r) => [r.date, { name: r.name, isOptional: r.isOptional }])), offSaturdays: s.offSaturdays };
}

export type Profile = { userId: string; shift: ShiftRules; employmentType: UserProfile["employmentType"]; dateOfJoining: string | null; dateOfBirth: string | null; shiftId: string | null };

/** Profiles for these people (anyone without a row gets the default shift and "staff"). */
export async function profilesFor(userIds: string[]): Promise<Map<string, Profile>> {
  const [rows, all] = await Promise.all([userIds.length ? db.select().from(userProfiles).where(inArray(userProfiles.userId, userIds)) : Promise.resolve([] as UserProfile[]), listShifts()]);
  const byId = new Map(all.map((s) => [s.id, s]));
  const dflt = all.find((s) => s.isDefault) ?? all[0] ?? null;
  const got = new Map(rows.map((r) => [r.userId, r]));
  return new Map(
    userIds.map((id) => {
      const r = got.get(id);
      const shift = (r?.shiftId && byId.get(r.shiftId)) || dflt;
      return [id, { userId: id, shift: shiftRules(shift), shiftId: r?.shiftId ?? null, employmentType: r?.employmentType ?? "staff", dateOfJoining: r?.dateOfJoining ?? null, dateOfBirth: r?.dateOfBirth ?? null }];
    }),
  );
}

export async function profileOf(userId: string): Promise<Profile> {
  return (await profilesFor([userId])).get(userId)!;
}
