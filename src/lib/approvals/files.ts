import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { aprFileChunks, aprFiles } from "@/db/approvals-schema";
import { ApprovalsError } from "./errors";
import type { ApprovalsUser } from "./host-adapter";
import { CHUNK_BYTES, mimeFor } from "./request-schemas";

/**
 * File storage in Postgres. An upload is three steps: startUpload makes the file record, putChunk stores each slice of at most
 * CHUNK_BYTES, and a request that is submitted with the file's id claims it (attachFiles). Nothing here hands out a public address:
 * bytes leave only through readFileStream, which the download route calls after checking who may see the request.
 */

export type StoredFile = { id: string; fileName: string; mime: string; size: number; chunkCount: number };

const chunkCountFor = (size: number) => Math.ceil(size / CHUNK_BYTES);

export async function startUpload(actor: Pick<ApprovalsUser, "id">, input: { fileName: string; size: number }): Promise<{ fileId: string; chunkCount: number; chunkBytes: number }> {
  const [row] = await db
    .insert(aprFiles)
    .values({ uploadedBy: actor.id, fileName: input.fileName, mime: mimeFor(input.fileName), size: input.size, chunkCount: chunkCountFor(input.size) })
    .returning({ id: aprFiles.id, chunkCount: aprFiles.chunkCount });
  return { fileId: row.id, chunkCount: row.chunkCount, chunkBytes: CHUNK_BYTES };
}

/** Stores one slice. Sending the same slice again simply replaces it, so a retry after a dropped connection is safe. */
export async function putChunk(actor: Pick<ApprovalsUser, "id">, fileId: string, index: number, bytes: Buffer): Promise<void> {
  const [file] = await db.select().from(aprFiles).where(eq(aprFiles.id, fileId));
  if (!file || file.uploadedBy !== actor.id) throw new ApprovalsError("That upload no longer exists.", 404);
  if (file.attached) throw new ApprovalsError("That file has already been submitted.", 409);
  if (!Number.isInteger(index) || index < 0 || index >= file.chunkCount) throw new ApprovalsError("Unexpected part of the file.");
  const expected = index < file.chunkCount - 1 ? CHUNK_BYTES : file.size - CHUNK_BYTES * (file.chunkCount - 1);
  if (bytes.length !== expected) throw new ApprovalsError("The file arrived incomplete. Please try again.");
  const data = sql`decode(${bytes.toString("base64")}, 'base64')` as unknown as string;
  await db
    .insert(aprFileChunks)
    .values({ fileId, idx: index, data })
    .onConflictDoUpdate({ target: [aprFileChunks.fileId, aprFileChunks.idx], set: { data } });
}

/**
 * Checks that every file a request points at is the submitter's own, not yet used, and fully uploaded; returns their details.
 * Run before anything is written, so a bad reference stops the whole submission.
 */
export async function checkFilesReady(actor: Pick<ApprovalsUser, "id">, fileIds: string[]): Promise<Map<string, StoredFile>> {
  const ids = [...new Set(fileIds)];
  const found = new Map<string, StoredFile>();
  if (ids.length === 0) return found;
  const files = await db.select().from(aprFiles).where(inArray(aprFiles.id, ids));
  const stored = await db
    .select({ fileId: aprFileChunks.fileId, parts: sql<number>`count(*)::int`, bytes: sql<number>`coalesce(sum(octet_length(${aprFileChunks.data})), 0)::bigint`.mapWith(Number) })
    .from(aprFileChunks)
    .where(inArray(aprFileChunks.fileId, ids))
    .groupBy(aprFileChunks.fileId);
  const have = new Map(stored.map((s) => [s.fileId, s]));
  for (const id of ids) {
    const f = files.find((x) => x.id === id);
    if (!f || f.uploadedBy !== actor.id) throw new ApprovalsError("An attached file could not be found. Please attach it again.", 400);
    if (f.attached) throw new ApprovalsError(`"${f.fileName}" has already been used on another request. Please attach it again.`, 409);
    const s = have.get(id);
    if (!s || s.parts !== f.chunkCount || s.bytes !== f.size) throw new ApprovalsError(`"${f.fileName}" did not finish uploading. Please attach it again.`, 400);
    found.set(id, { id, fileName: f.fileName, mime: f.mime, size: f.size, chunkCount: f.chunkCount });
  }
  return found;
}

/**
 * Claims the files for a request, all or none. Only files not yet claimed are touched, and the claim is one statement, so two requests
 * submitted at the same moment can never share one upload: the second finds it already claimed and gets false.
 */
export async function claimFiles(fileIds: string[]): Promise<boolean> {
  if (fileIds.length === 0) return true;
  const got = await db.update(aprFiles).set({ attached: true }).where(and(inArray(aprFiles.id, fileIds), eq(aprFiles.attached, false))).returning({ id: aprFiles.id });
  if (got.length === fileIds.length) return true;
  await releaseFiles(got.map((r) => r.id));
  return false;
}

/** Gives claimed files back, when the request they were claimed for could not be saved. */
export async function releaseFiles(fileIds: string[]): Promise<void> {
  if (fileIds.length > 0) await db.update(aprFiles).set({ attached: false }).where(inArray(aprFiles.id, fileIds));
}

export async function getStoredFile(fileId: string): Promise<StoredFile | null> {
  const [f] = await db.select().from(aprFiles).where(eq(aprFiles.id, fileId));
  return f ? { id: f.id, fileName: f.fileName, mime: f.mime, size: f.size, chunkCount: f.chunkCount } : null;
}

/** The file's bytes as a stream, one stored slice at a time, so a 10 MB file is never held in memory whole. */
export function readFileStream(file: StoredFile): ReadableStream<Uint8Array> {
  let next = 0;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (next >= file.chunkCount) { controller.close(); return; }
      const [row] = await db
        .select({ b64: sql<string>`encode(${aprFileChunks.data}, 'base64')` })
        .from(aprFileChunks)
        .where(and(eq(aprFileChunks.fileId, file.id), eq(aprFileChunks.idx, next)));
      if (!row) { controller.error(new Error("A stored part of the file is missing.")); return; }
      next++;
      controller.enqueue(new Uint8Array(Buffer.from(row.b64, "base64")));
    },
  });
}
