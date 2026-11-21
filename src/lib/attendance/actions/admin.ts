"use server";

import { revalidatePath } from "next/cache";
import { assertAdmin, run, type ActionResult } from "../dal";
import * as A from "../admin";
import { checkStorage } from "../storage";
import { timesheetLogs } from "../admin";

/** What HR do in Attendance Admin. Each action proves the person is HR first (assertAdmin); the rules are in admin.ts. */

const refresh = () => revalidatePath("/attendance", "layout");
const hr = (u: { id: string; name: string }) => ({ id: u.id, name: u.name });

export async function updatePersonAction(userId: string, patch: A.PersonPatch): Promise<ActionResult> {
  return run(async () => {
    await A.updatePerson(hr(await assertAdmin()), userId, patch);
    refresh();
  }, "Saved");
}

export async function saveSettingsAction(raw: unknown): Promise<ActionResult> {
  return run(async () => {
    await A.updateSettings(hr(await assertAdmin()), raw);
    refresh();
  }, "Settings saved");
}

export async function saveShiftAction(input: A.ShiftInput): Promise<ActionResult> {
  return run(async () => {
    await assertAdmin();
    await A.saveShift(input);
    refresh();
  }, "Shift saved");
}

export async function deleteShiftAction(id: string): Promise<ActionResult> {
  return run(async () => {
    await assertAdmin();
    await A.deleteShift(id);
    refresh();
  }, "Shift deleted");
}

export async function saveLeaveTypeAction(input: A.LeaveTypeInput): Promise<ActionResult> {
  return run(async () => {
    await assertAdmin();
    await A.saveLeaveType(input);
    refresh();
  }, "Leave type saved");
}

export async function deleteLeaveTypeAction(id: string): Promise<ActionResult<"deleted" | "deactivated">> {
  return run(async () => {
    await assertAdmin();
    const r = await A.deleteLeaveType(id);
    refresh();
    return r;
  });
}

export async function saveHolidayAction(input: { id?: string; date: string; name: string; isOptional: boolean }): Promise<ActionResult> {
  return run(async () => {
    await assertAdmin();
    await A.saveHoliday(input);
    refresh();
  }, "Holiday saved");
}

export async function deleteHolidayAction(id: string): Promise<ActionResult> {
  return run(async () => {
    await assertAdmin();
    await A.deleteHoliday(id);
    refresh();
  }, "Holiday removed");
}

export async function saveProjectAction(input: { id?: string; name: string; description: string; isActive: boolean }): Promise<ActionResult> {
  return run(async () => {
    await assertAdmin();
    await A.saveProject(input);
    refresh();
  }, "Project saved");
}

export async function deleteProjectAction(id: string): Promise<ActionResult<"deleted" | "deactivated">> {
  return run(async () => {
    await assertAdmin();
    const r = await A.deleteProject(id);
    refresh();
    return r;
  });
}

export async function adjustBalanceAction(input: { userId: string; leaveTypeId: string; year: number; days: number; remark: string }): Promise<ActionResult> {
  return run(async () => {
    await A.adjustBalance(hr(await assertAdmin()), input);
    refresh();
  }, "Balance adjusted; they have been told");
}

export async function postAnnouncementAction(input: { title: string; content: string }): Promise<ActionResult> {
  return run(async () => {
    await A.postAnnouncement(hr(await assertAdmin()), input);
    refresh();
  }, "Announcement posted");
}

export async function deleteAnnouncementAction(id: string): Promise<ActionResult> {
  return run(async () => {
    await assertAdmin();
    await A.deleteAnnouncement(id);
    refresh();
  }, "Announcement removed");
}

export async function timesheetLogsAction(userId: string, weekStart: string): Promise<ActionResult<Awaited<ReturnType<typeof timesheetLogs>>>> {
  return run(async () => {
    await assertAdmin();
    return timesheetLogs(userId, weekStart);
  });
}

export async function checkStorageAction(): Promise<ActionResult<{ ok: boolean; message: string }>> {
  return run(async () => {
    await assertAdmin();
    return checkStorage();
  });
}
