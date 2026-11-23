"use server";

import { revalidatePath } from "next/cache";
import { assertMember, run, type ActionResult } from "../dal";
import { checkIn, checkOut } from "../checkin";
import { applyLeave, beginLeaveUpload, cancelLeave, previewDays, type LeaveInput } from "../leave";
import { applyCompoff, applyEarlyDeparture, applyRegularization, applyWfh, cancelRequest } from "../requests";
import { addTimeLog, deleteTimeLog, submitWeek } from "../timesheets";
import { decide } from "../approvals";
import { sendWish } from "../overview";
import { requestIp, searchHubUsers, type Person } from "../host-adapter";
import { removeSubscription, saveSubscription } from "../push";
import type { HalfDay, MissedPunch } from "@/db/attendance-schema";
import type { RequestKind } from "../att.manifest";
import type { FeedType } from "../feeds";

/**
 * What a member of staff does in Attendance. Each action proves who is asking first (assertMember); the rules are in the files it calls.
 * Managers decide requests sent to them here too (decideAction): approvals.ts checks the request was sent to them.
 */

const refresh = () => revalidatePath("/attendance", "layout");
const ip = requestIp;

export async function checkInAction(position: unknown): Promise<ActionResult<{ message: string }>> {
  return run(async () => {
    const u = await assertMember();
    const r = await checkIn(u.id, { ip: await ip(), position });
    refresh();
    return r;
  });
}

export async function checkOutAction(position: unknown): Promise<ActionResult<{ message: string }>> {
  return run(async () => {
    const u = await assertMember();
    const r = await checkOut(u.id, { ip: await ip(), position });
    refresh();
    return r;
  });
}

export async function previewLeaveAction(leaveTypeId: string, start: string, end: string, halfDay: HalfDay): Promise<ActionResult<number>> {
  return run(async () => {
    await assertMember();
    return previewDays(leaveTypeId, start, end, halfDay);
  });
}

export async function beginUploadAction(fileName: string, size: number, mime: string): Promise<ActionResult<{ key: string; uploadUrl: string }>> {
  return run(async () => beginLeaveUpload((await assertMember()).id, fileName, size, mime));
}

export async function applyLeaveAction(input: LeaveInput): Promise<ActionResult<{ id: string }>> {
  return run(async () => {
    const r = await applyLeave(await assertMember(), input);
    refresh();
    return r;
  }, "Leave requested");
}

export async function cancelLeaveAction(id: string): Promise<ActionResult> {
  return run(async () => {
    await cancelLeave((await assertMember()).id, id);
    refresh();
  }, "Leave cancelled");
}

export async function applyWfhAction(input: { date: string; reason: string; planNote?: string }): Promise<ActionResult<{ id: string }>> {
  return run(async () => {
    const r = await applyWfh(await assertMember(), input);
    refresh();
    return r;
  }, "Work from home requested");
}

export async function applyRegularizationAction(input: { date: string; missed: MissedPunch; checkIn?: string; checkOut?: string; reason: string }): Promise<ActionResult<{ id: string }>> {
  return run(async () => {
    const r = await applyRegularization(await assertMember(), input);
    refresh();
    return r;
  }, "Regularization requested");
}

export async function applyCompoffAction(input: { workedDate: string; type: "full" | "half"; reason: string }): Promise<ActionResult<{ id: string }>> {
  return run(async () => {
    const r = await applyCompoff(await assertMember(), input);
    refresh();
    return r;
  }, "Comp-off claimed");
}

export async function applyEarlyDepartureAction(reason: string): Promise<ActionResult<{ id: string }>> {
  return run(async () => {
    const r = await applyEarlyDeparture(await assertMember(), { reason });
    refresh();
    return r;
  }, "Early check-out requested");
}

export async function cancelRequestAction(kind: "wfh" | "regularization" | "compoff" | "early", id: string): Promise<ActionResult> {
  return run(async () => {
    await cancelRequest((await assertMember()).id, kind, id);
    refresh();
  }, "Request withdrawn");
}

export async function addTimeAction(input: { projectId: string; date: string; hours: number; description: string }): Promise<ActionResult> {
  return run(async () => {
    await addTimeLog((await assertMember()).id, input);
    refresh();
  }, "Time logged");
}

export async function deleteTimeAction(id: string): Promise<ActionResult> {
  return run(async () => {
    await deleteTimeLog((await assertMember()).id, id);
    refresh();
  }, "Entry removed");
}

export async function submitWeekAction(start: string): Promise<ActionResult> {
  return run(async () => {
    await submitWeek(await assertMember(), start);
    refresh();
  }, "Week submitted for approval");
}

/** A manager's (or HR's) decision on a request sent to them. */
export async function decideAction(kind: RequestKind, id: string, approve: boolean, remark: string): Promise<ActionResult<string>> {
  return run(async () => {
    const u = await assertMember();
    const message = await decide({ id: u.id, name: u.name, hr: u.admin }, kind, id, approve, remark);
    refresh();
    return message;
  });
}

export async function sendWishAction(input: { toUserId: string; type: FeedType; date: string; message: string }): Promise<ActionResult> {
  return run(async () => {
    await sendWish(await assertMember(), input);
    refresh();
  }, "Wishes sent 🎉");
}

export async function searchPeopleAction(q: string): Promise<ActionResult<Person[]>> {
  return run(async () => {
    await assertMember();
    return searchHubUsers(q);
  });
}

/** Turns phone notifications on for this browser (its Web Push subscription). */
export async function subscribePushAction(subscription: unknown): Promise<ActionResult> {
  return run(async () => {
    await saveSubscription((await assertMember()).id, subscription);
  }, "Notifications are on for this device");
}

export async function unsubscribePushAction(endpoint: string): Promise<ActionResult> {
  return run(async () => {
    await removeSubscription((await assertMember()).id, endpoint);
  }, "Notifications are off for this device");
}
