import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq, inArray, lt } from "drizzle-orm";
import { db } from "./db";
import { files, type FilePurpose } from "@/db/design-schema";
import { DesignError } from "./dal";
import { uploadLimit } from "./form";
import { objectSize, removeObjects, signedDownloadUrl, signedUploadUrl } from "./storage";
import { mimeFor, safeFileName } from "./file-types";

/**
 * Files, in two steps. startUpload records the file and returns a signed link the browser uploads the bytes to, straight to Supabase
 * Storage. Whatever then uses the file (a request, a proof, a library version ...) claims it with claimFiles, which checks it is the
 * uploader's own, not used yet, really in storage, and within the size limit for its purpose. Files never claimed are removed by the
 * scheduled jobs after a day.
 */

export type StoredFile = { id: string; fileName: string; mime: string; size: number; storageKey: string };

export async function startUpload(userId: string, input: { purpose: FilePurpose; fileName: string; size: number }): Promise<{ fileId: string; uploadUrl: string; mime: string }> {
  const name = safeFileName(input.fileName);
  if (!name) throw new DesignError("That file name cannot be used.");
  const mime = mimeFor(name);
  if (!mime) throw new DesignError(`"${name}" is not a file type that can be attached.`);
  const limit = uploadLimit(input.purpose);
  if (!Number.isInteger(input.size) || input.size <= 0) throw new DesignError(`"${name}" is empty.`);
  if (input.size > limit) throw new DesignError(`"${name}" is larger than ${Math.round(limit / 1048576)} MB.`);
  const month = new Date().toISOString().slice(0, 7);
  const storageKey = `${input.purpose}/${month}/${randomUUID()}/${name}`;
  const uploadUrl = await signedUploadUrl(storageKey);
  const [row] = await db.insert(files).values({ storageKey, fileName: name, mime, size: input.size, purpose: input.purpose, uploadedBy: userId }).returning({ id: files.id });
  return { fileId: row.id, uploadUrl, mime };
}

/**
 * Claims files for one use, all or none: each must be the user's own, of this purpose, unused, and in storage at the size announced.
 * The claim itself is one statement, so two submissions at the same moment can never share a file.
 */
export async function claimFiles(userId: string, ids: string[], purpose: FilePurpose): Promise<StoredFile[]> {
  const want = [...new Set(ids)];
  if (!want.length) return [];
  const rows = await db.select().from(files).where(inArray(files.id, want));
  for (const id of want) {
    const f = rows.find((r) => r.id === id);
    if (!f || f.uploadedBy !== userId || f.purpose !== purpose) throw new DesignError("An attached file could not be found. Please attach it again.");
    if (f.attached) throw new DesignError(`"${f.fileName}" has already been used. Please attach it again.`);
    const size = await objectSize(f.storageKey);
    if (size == null) throw new DesignError(`"${f.fileName}" did not finish uploading. Please attach it again.`);
    if (size > uploadLimit(purpose)) {
      await removeObjects([f.storageKey]);
      throw new DesignError(`"${f.fileName}" is larger than the limit.`);
    }
    if (size !== f.size) await db.update(files).set({ size }).where(eq(files.id, f.id));
  }
  const got = await db.update(files).set({ attached: true }).where(and(inArray(files.id, want), eq(files.attached, false))).returning({ id: files.id });
  if (got.length !== want.length) {
    if (got.length) await db.update(files).set({ attached: false }).where(inArray(files.id, got.map((g) => g.id)));
    throw new DesignError("A file was used somewhere else at the same moment. Please attach it again.");
  }
  return rows.map((r) => ({ id: r.id, fileName: r.fileName, mime: r.mime, size: r.size, storageKey: r.storageKey }));
}

/** Gives claimed files back, when what claimed them could not be saved. */
export async function releaseFiles(ids: string[]): Promise<void> {
  if (ids.length) await db.update(files).set({ attached: false }).where(inArray(files.id, ids));
}

export async function fileById(id: string): Promise<StoredFile | null> {
  const [f] = await db.select().from(files).where(eq(files.id, id)).limit(1);
  return f ? { id: f.id, fileName: f.fileName, mime: f.mime, size: f.size, storageKey: f.storageKey } : null;
}

export async function filesByIds(ids: (string | null)[]): Promise<Map<string, StoredFile>> {
  const want = [...new Set(ids.filter((x): x is string => !!x))];
  if (!want.length) return new Map();
  const rows = await db.select().from(files).where(inArray(files.id, want));
  return new Map(rows.map((f) => [f.id, { id: f.id, fileName: f.fileName, mime: f.mime, size: f.size, storageKey: f.storageKey }]));
}

/** A 60-second link to the file. Images and PDFs can be shown in the page (`inline`); anything else downloads. */
export async function fileLink(f: StoredFile, inline = false): Promise<string> {
  return signedDownloadUrl(f.storageKey, f.fileName, inline && (f.mime.startsWith("image/") || f.mime === "application/pdf"));
}

/** Deletes file rows and their objects (the caller has checked nothing else points at them). */
export async function deleteFiles(ids: string[]): Promise<void> {
  const want = [...new Set(ids)];
  if (!want.length) return;
  const rows = await db.delete(files).where(inArray(files.id, want)).returning({ key: files.storageKey });
  await removeObjects(rows.map((r) => r.key));
}

/** Scheduled clean-up: uploads that were never used, a day on. */
export async function removeUnclaimed(olderThan: Date): Promise<number> {
  const rows = await db.delete(files).where(and(eq(files.attached, false), lt(files.createdAt, olderThan))).returning({ key: files.storageKey });
  await removeObjects(rows.map((r) => r.key));
  return rows.length;
}
