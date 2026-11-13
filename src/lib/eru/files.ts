import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq, inArray, lt } from "drizzle-orm";
import { db } from "./db";
import { files } from "@/db/eru-schema";
import { EruError } from "./dal";
import { MAX_FILE_BYTES, MAX_FILE_MB } from "./eru.manifest";
import { objectSize, removeObjects, signedDownloadUrl, signedUploadUrl } from "./storage";
import { mimeFor, safeFileName } from "./file-types";

/**
 * Files, in two steps. startUpload records the file and returns a signed link the browser uploads the bytes to, straight to Supabase
 * Storage. Whatever then uses the file (a project's files, or the original of an imported document) claims it with claimFile, which checks it
 * is the uploader's own, not used yet, really in storage, and within the size limit. Files never claimed are removed by the clean-up after a
 * day.
 */

export type StoredFile = { id: string; projectId: string | null; documentId: string | null; fileName: string; mime: string; size: number; storageKey: string; uploadedBy: string; createdAt: Date };

export async function startUpload(userId: string, input: { fileName: string; size: number }): Promise<{ fileId: string; uploadUrl: string; mime: string }> {
  const name = safeFileName(input.fileName);
  if (!name) throw new EruError("That file name cannot be used.");
  const mime = mimeFor(name);
  if (!Number.isInteger(input.size) || input.size <= 0) throw new EruError(`"${name}" is empty.`);
  if (input.size > MAX_FILE_BYTES) throw new EruError(`"${name}" is larger than ${MAX_FILE_MB} MB.`);
  const storageKey = `${new Date().toISOString().slice(0, 7)}/${randomUUID()}/${name}`;
  const uploadUrl = await signedUploadUrl(storageKey);
  const [row] = await db.insert(files).values({ storageKey, fileName: name, mime, size: input.size, uploadedBy: userId }).returning({ id: files.id });
  return { fileId: row.id, uploadUrl, mime };
}

/** Claims one uploaded file for a project (and, for an imported document's original, that document). */
export async function claimFile(userId: string, fileId: string, target: { projectId: string; documentId?: string | null }): Promise<StoredFile> {
  const [f] = await db.select().from(files).where(eq(files.id, fileId)).limit(1);
  if (!f || f.uploadedBy !== userId) throw new EruError("The uploaded file could not be found. Please upload it again.");
  if (f.attached) throw new EruError(`"${f.fileName}" has already been used. Please upload it again.`);
  const size = await objectSize(f.storageKey);
  if (size == null) throw new EruError(`"${f.fileName}" did not finish uploading. Please upload it again.`);
  if (size > MAX_FILE_BYTES) {
    await removeObjects([f.storageKey]);
    throw new EruError(`"${f.fileName}" is larger than ${MAX_FILE_MB} MB.`);
  }
  const [got] = await db
    .update(files)
    .set({ attached: true, size, projectId: target.projectId, documentId: target.documentId ?? null })
    .where(and(eq(files.id, fileId), eq(files.attached, false)))
    .returning();
  if (!got) throw new EruError("The file was used somewhere else at the same moment. Please upload it again.");
  return got;
}

export async function fileById(id: string): Promise<StoredFile | null> {
  const [f] = await db.select().from(files).where(eq(files.id, id)).limit(1);
  return f ?? null;
}

/** A 60-second link to the file. Images and PDFs can be shown in the page (`inline`); anything else downloads. */
export async function fileLink(f: StoredFile, inline = false): Promise<string> {
  return signedDownloadUrl(f.storageKey, f.fileName, inline && (f.mime.startsWith("image/") || f.mime === "application/pdf"));
}

/** Deletes file rows and their objects (the caller has checked nothing else needs them). */
export async function deleteFiles(ids: string[]): Promise<void> {
  const want = [...new Set(ids)];
  if (!want.length) return;
  const rows = await db.delete(files).where(inArray(files.id, want)).returning({ key: files.storageKey });
  await removeObjects(rows.map((r) => r.key));
}

/** Clean-up: uploads that were never used, a day on. */
export async function removeUnclaimed(olderThan: Date): Promise<number> {
  const rows = await db.delete(files).where(and(eq(files.attached, false), lt(files.createdAt, olderThan))).returning({ key: files.storageKey });
  await removeObjects(rows.map((r) => r.key));
  return rows.length;
}
