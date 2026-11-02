"use server";

import { revalidatePath } from "next/cache";
import { assertLead, assertTeam, run, type ActionResult } from "../dal";
import {
  acceptRequest,
  addAttachments,
  addClientChange,
  addSubtask,
  askQuestion,
  assigneeOptions,
  bulkUpdate,
  declineRequest,
  deleteTicket,
  removeAttachment,
  setSubtask,
  updateTicket,
  type TicketPatch,
} from "../tickets";
import { addProof, revokeReview, sendForReview } from "../approvals";
import { decideCdr, requestCdr, uploadCdr, cdrDownloadLink } from "../cdr";
import { deleteTime, logTime, startTimer, stopTimer } from "../time";
import { addPin, deleteView, saveView, setPin } from "../detail";
import { saveProfile } from "../admin";

/** What the design team does on tickets. Every action checks who is asking and whether the ticket is theirs (src/lib/design/tickets.ts). */

const refresh = () => revalidatePath("/design", "layout");
const ok = <T>(fn: () => Promise<T>, message?: string) =>
  run(async () => {
    const r = await fn();
    refresh();
    return r;
  }, message);

export async function updateTicketAction(id: string, patch: TicketPatch): Promise<ActionResult> {
  return ok(async () => {
    await updateTicket(await assertTeam(), id, patch);
  }, "Saved");
}

export async function bulkAction(ids: string[], patch: Pick<TicketPatch, "status" | "assigneeId" | "priority">): Promise<ActionResult<{ updated: number; skipped: number }>> {
  return ok(async () => bulkUpdate(await assertTeam(), ids, patch));
}

export async function acceptAction(id: string, assigneeId: string | "auto"): Promise<ActionResult<{ assigned: boolean }>> {
  return ok(async () => ({ assigned: !!(await acceptRequest(await assertLead(), id, assigneeId)).assigneeId }));
}

export async function declineAction(id: string, reason: string): Promise<ActionResult> {
  return ok(async () => declineRequest(await assertLead(), id, reason), "Declined. The requester has been told.");
}

export async function askAction(id: string, question: string): Promise<ActionResult> {
  return ok(async () => askQuestion(await assertTeam(), id, question), "Question sent to the requester.");
}

export async function assigneeOptionsAction(): Promise<ActionResult<Awaited<ReturnType<typeof assigneeOptions>>>> {
  return run(async () => {
    await assertLead();
    return assigneeOptions();
  });
}

export async function deleteTicketAction(id: string): Promise<ActionResult> {
  return ok(async () => deleteTicket(await assertLead(), id), "Deleted");
}

export async function subtaskAction(ticketId: string, title: string): Promise<ActionResult> {
  return ok(async () => addSubtask(await assertTeam(), ticketId, title));
}

export async function setSubtaskAction(subtaskId: string, done: boolean | null): Promise<ActionResult> {
  return ok(async () => setSubtask(await assertTeam(), subtaskId, done));
}

export async function clientChangeAction(ticketId: string, text: string): Promise<ActionResult> {
  return ok(async () => addClientChange(await assertTeam(), ticketId, text), "Noted");
}

export async function addAttachmentsAction(ticketId: string, fileIds: string[]): Promise<ActionResult> {
  return ok(async () => addAttachments(await assertTeam(), ticketId, fileIds), "Files added");
}

export async function removeAttachmentAction(attachmentId: string): Promise<ActionResult> {
  return ok(async () => removeAttachment(await assertTeam(), attachmentId), "Removed");
}

export async function addProofAction(ticketId: string, fileId: string, note: string, send: boolean): Promise<ActionResult<{ version: number; link: string | null; emailedTo: string | null }>> {
  return ok(async () => addProof(await assertTeam(), ticketId, fileId, note, send));
}

export async function sendForReviewAction(proofId: string): Promise<ActionResult<{ link: string; emailedTo: string | null }>> {
  return ok(async () => sendForReview(await assertTeam(), proofId));
}

export async function revokeReviewAction(requestId: string): Promise<ActionResult> {
  return ok(async () => revokeReview(await assertTeam(), requestId), "Link withdrawn");
}

export async function requestCdrTeamAction(ticketId: string): Promise<ActionResult> {
  return ok(async () => requestCdr(await assertTeam(), ticketId, false), "Source file requested");
}

export async function decideCdrAction(requestId: string, approve: boolean): Promise<ActionResult> {
  return ok(async () => decideCdr(await assertTeam(), requestId, approve), approve ? "Approved" : "Declined");
}

export async function uploadCdrAction(requestId: string, fileId: string): Promise<ActionResult> {
  return ok(async () => uploadCdr(await assertTeam(), requestId, fileId), "Uploaded. The requester has been told.");
}

export async function cdrLinkTeamAction(requestId: string): Promise<ActionResult<string>> {
  return run(async () => cdrDownloadLink(await assertTeam(), requestId));
}

export async function startTimerAction(ticketId: string): Promise<ActionResult> {
  return ok(async () => startTimer(await assertTeam(), ticketId));
}

export async function stopTimerAction(): Promise<ActionResult> {
  return ok(async () => stopTimer(await assertTeam()));
}

export async function logTimeAction(ticketId: string, minutes: number, note: string, day: string | null): Promise<ActionResult> {
  return ok(async () => logTime(await assertTeam(), ticketId, minutes, note, day), "Logged");
}

export async function deleteTimeAction(entryId: string): Promise<ActionResult> {
  return ok(async () => deleteTime(await assertTeam(), entryId));
}

export async function addPinAction(proofId: string, xPct: number, yPct: number, content: string): Promise<ActionResult> {
  return ok(async () => addPin(await assertTeam(), proofId, xPct, yPct, content));
}

export async function setPinAction(pinId: string, resolved: boolean | null): Promise<ActionResult> {
  return ok(async () => setPin(await assertTeam(), pinId, resolved));
}

export async function saveViewAction(name: string, filters: Record<string, string>, isShared: boolean): Promise<ActionResult> {
  return ok(async () => saveView(await assertTeam(), name, filters, isShared), "View saved");
}

export async function deleteViewAction(id: string): Promise<ActionResult> {
  return ok(async () => deleteView(await assertTeam(), id));
}

/** A designer's own email switch (My Dashboard). */
export async function setMyEmailAction(enabled: boolean): Promise<ActionResult> {
  return ok(async () => saveProfile((await assertTeam()).id, { emailEnabled: enabled }), enabled ? "Emails on" : "Emails off");
}
