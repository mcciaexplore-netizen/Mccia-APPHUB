"use server";

import { revalidatePath } from "next/cache";
import { assertLead, assertSuperAdmin, run, type ActionResult } from "../dal";
import { addHoliday, addLeave, deleteAllData, removeHoliday, removeLeave, saveGeneral, saveProfile, saveSchedule, saveSlack, saveType, testEmail, testSlack, typeInput } from "../admin";
import { checkStorage } from "../storage";
import type { SlackEvent } from "../notify";
import type { z } from "zod";

/** Settings: design leads for the studio's set-up; the Support Admin for integrations and deleting everything. */

const refresh = () => revalidatePath("/design", "layout");
const lead = <T>(fn: () => Promise<T>, message = "Saved") =>
  run(async () => {
    await assertLead();
    const r = await fn();
    refresh();
    return r;
  }, message);
const superOnly = <T>(fn: () => Promise<T>, message?: string) =>
  run(async () => {
    await assertSuperAdmin();
    const r = await fn();
    refresh();
    return r;
  }, message);

export async function saveTypeAction(id: string | null, input: z.input<typeof typeInput>): Promise<ActionResult> {
  return lead(() => saveType(id, input));
}
export async function saveScheduleAction(days: { dayOfWeek: number; isWorking: boolean; startHour: number; endHour: number }[]): Promise<ActionResult> {
  return lead(() => saveSchedule(days));
}
export async function addHolidayAction(date: string, name: string, type: "national" | "company" | "optional"): Promise<ActionResult> {
  return lead(() => addHoliday(date, name, type), "Holiday added");
}
export async function removeHolidayAction(id: string): Promise<ActionResult> {
  return lead(() => removeHoliday(id), "Removed");
}
export async function saveCapacityAction(userId: string, dailyCapacityHours: number): Promise<ActionResult> {
  return lead(() => saveProfile(userId, { dailyCapacityHours }));
}
export async function addLeaveAction(userId: string, startDate: string, endDate: string, note: string): Promise<ActionResult> {
  return lead(() => addLeave(userId, startDate, endDate, note), "Leave added");
}
export async function removeLeaveAction(id: string): Promise<ActionResult> {
  return lead(() => removeLeave(id), "Removed");
}
export async function saveGeneralAction(p: { editWindowHours: number; maxFreeRevisions: number; ticketNumberFloor: number }): Promise<ActionResult> {
  return lead(() => saveGeneral(p));
}
export async function saveSlackAction(webhook: string, events: Partial<Record<SlackEvent, boolean>>): Promise<ActionResult> {
  return superOnly(() => saveSlack(webhook, events), "Saved");
}
export async function testSlackAction(): Promise<ActionResult<string>> {
  return superOnly(() => testSlack());
}
export async function testEmailAction(): Promise<ActionResult<string>> {
  return run(async () => testEmail(await assertSuperAdmin()));
}
export async function checkStorageAction(): Promise<ActionResult<{ ok: boolean; message: string }>> {
  return superOnly(() => checkStorage());
}
export async function deleteAllDataAction(confirm: string): Promise<ActionResult<{ tickets: number; files: number }>> {
  return superOnly(() => deleteAllData(confirm), "All past data deleted.");
}
