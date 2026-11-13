"use server";

import { revalidatePath } from "next/cache";
import { assertAdmin, assertMember, run, type ActionResult } from "../dal";
import { startUpload } from "../files";
import * as P from "../projects";
import * as D from "../documents";
import type { ProjectInput } from "../eru.manifest";

/**
 * What the ERU team does in the workspace: projects, their files and documents, saving, track changes, reviews and comments. Each action
 * proves who is asking first (assertMember / assertAdmin); the rules for each step are in projects.ts and documents.ts.
 */

const refresh = () => revalidatePath("/eru", "layout");

/** A signed link to upload one file to (a project file, or a .docx being imported). */
export async function beginUpload(fileName: string, size: number): Promise<ActionResult<{ fileId: string; uploadUrl: string; mime: string }>> {
  return run(async () => {
    const u = await assertMember();
    return startUpload(u.id, { fileName, size });
  });
}

export async function createProjectAction(input: ProjectInput & { assignedTo?: string[] }): Promise<ActionResult<{ id: string; number: string; domainKey: string }>> {
  return run(async () => {
    const r = await P.createProject(await assertMember(), input);
    refresh();
    return r;
  });
}

export async function updateDetailsAction(id: string, input: { title: string; description: string; tags: string[]; referenceLinks: string[] }): Promise<ActionResult> {
  return run(async () => {
    await P.updateDetails(await assertMember(), id, input);
    refresh();
  }, "Saved");
}

export async function manageProjectAction(id: string, patch: P.ManagePatch): Promise<ActionResult> {
  return run(async () => {
    await P.manageProject(await assertAdmin(), id, patch);
    refresh();
  }, "Saved");
}

export async function setAssigneesAction(id: string, userIds: string[]): Promise<ActionResult> {
  return run(async () => {
    await P.setAssignees(await assertAdmin(), id, userIds);
    refresh();
  }, "Members updated");
}

export async function deleteProjectAction(id: string): Promise<ActionResult<{ domainKey: string }>> {
  return run(async () => {
    const r = await P.deleteProject(await assertAdmin(), id);
    refresh();
    return r;
  }, "Project deleted");
}

export async function addProjectFileAction(projectId: string, fileId: string): Promise<ActionResult> {
  return run(async () => {
    await P.addProjectFile(await assertMember(), projectId, fileId);
    refresh();
  }, "Uploaded");
}

export async function removeProjectFileAction(fileId: string): Promise<ActionResult> {
  return run(async () => {
    await P.removeProjectFile(await assertMember(), fileId);
    refresh();
  }, "File removed");
}

export async function createDocumentAction(projectId: string, input: { title: string; content?: unknown; originalFileId?: string | null }): Promise<ActionResult<{ id: string }>> {
  return run(async () => {
    const r = await D.createDocument(await assertMember(), projectId, input);
    refresh();
    return r;
  });
}

/** Saving is frequent (autosave): it does not refresh the page. */
export async function saveDocumentAction(id: string, input: { content: unknown; title?: string; baseVersion: number }): Promise<ActionResult<{ version: number; savedAt: string }>> {
  return run(async () => D.saveDocument(await assertMember(), id, input));
}

export async function setTrackChangesAction(id: string, on: boolean): Promise<ActionResult> {
  return run(async () => {
    await D.setTrackChanges(await assertMember(), id, on);
  }, on ? "Track changes is on: every edit is now tracked" : "Track changes is off");
}

export async function reviewChangesAction(id: string, input: { baseVersion: number; ids: string[] | null; decision: "accept" | "reject" }): Promise<ActionResult<{ content: Record<string, unknown>; version: number; decided: number }>> {
  return run(async () => D.reviewChanges(await assertAdmin(), id, input));
}

export async function deleteDocumentAction(id: string): Promise<ActionResult<{ projectId: string }>> {
  return run(async () => {
    const r = await D.deleteDocument(await assertAdmin(), id);
    refresh();
    return r;
  }, "Document deleted");
}

export async function addCommentAction(documentId: string, input: { content: string; from: number; to: number; quote: string }): Promise<ActionResult<{ id: string; createdAt: string }>> {
  return run(async () => D.addComment(await assertMember(), documentId, input));
}

export async function resolveCommentAction(id: string, resolved: boolean): Promise<ActionResult> {
  return run(async () => D.resolveComment(await assertMember(), id, resolved));
}

export async function deleteCommentAction(id: string): Promise<ActionResult> {
  return run(async () => D.deleteComment(await assertMember(), id));
}
