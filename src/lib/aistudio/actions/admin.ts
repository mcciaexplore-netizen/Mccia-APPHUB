"use server";

import { revalidatePath } from "next/cache";
import type { Priority } from "@/db/aistudio-schema";
import { assertLead, assertSuperAdmin, assertTeam, run, type ActionResult } from "../dal";
import { checkStorage } from "../storage";
import * as notice from "../notify";
import { acceptRequest, addDeliverables, addNote, declineRequest, deleteAllData, deleteRequest, markDelivered, removeDeliverable, saveSlack, updateRequest, type RequestPatch } from "../requests";

/** What the AI Studio team does (each checks who may: see requests.ts). */

const refresh = () => revalidatePath("/aistudio", "layout");
const done = <T>(fn: () => Promise<T>, message?: string) =>
  run(async () => {
    const r = await fn();
    refresh();
    return r;
  }, message);

export async function acceptAction(id: string, p: { assigneeId: string | null; deadline: string | null; priority: Priority | null; note?: string }): Promise<ActionResult> {
  return done(async () => acceptRequest(await assertLead(), id, p), "Accepted. The requester has been told.");
}
export async function declineAction(id: string, reason: string): Promise<ActionResult> {
  return done(async () => declineRequest(await assertLead(), id, reason), "Declined. The requester has been told.");
}
export async function updateAction(id: string, patch: RequestPatch): Promise<ActionResult> {
  return done(async () => {
    await updateRequest(await assertTeam(), id, patch);
  }, "Saved");
}
export async function noteAction(id: string, body: string, internal: boolean): Promise<ActionResult> {
  return done(async () => addNote(await assertTeam(), id, body, internal), internal ? "Note added" : "Note shared with the requester");
}
export async function deliverablesAction(id: string, fileIds: string[]): Promise<ActionResult> {
  return done(async () => addDeliverables(await assertTeam(), id, fileIds), "Uploaded");
}
export async function removeDeliverableAction(attachmentId: string): Promise<ActionResult> {
  return done(async () => removeDeliverable(await assertTeam(), attachmentId), "Removed");
}
export async function deliverAction(id: string, deliveryNotes: string): Promise<ActionResult> {
  return done(async () => markDelivered(await assertTeam(), id, deliveryNotes), "Marked as delivered. The requester has been told.");
}
export async function deleteAction(id: string): Promise<ActionResult> {
  return done(async () => deleteRequest(await assertLead(), id), "Deleted");
}
export async function saveSlackAction(webhook: string): Promise<ActionResult> {
  return done(async () => saveSlack(await assertLead(), webhook), "Saved");
}
export async function testEmailAction(): Promise<ActionResult<string>> {
  return run(async () => {
    const u = await assertLead();
    return notice.testEmail({ id: u.id, name: u.name, email: u.email });
  });
}
export async function checkStorageAction(): Promise<ActionResult<{ ok: boolean; message: string }>> {
  return run(async () => {
    await assertLead();
    return checkStorage();
  });
}
export async function deleteAllAction(confirm: string): Promise<ActionResult<{ requests: number }>> {
  return done(async () => deleteAllData(await assertSuperAdmin(), confirm));
}
