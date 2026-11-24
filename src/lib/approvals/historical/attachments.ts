import "server-only";
import { eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { aprAttachments, aprHistoricalRecords, aprRequests } from "@/db/approvals-schema";
import { recordAudit } from "../audit";
import { ApprovalsError } from "../errors";
import { checkFilesReady, claimFiles, releaseFiles } from "../files";
import type { ApprovalsUser } from "../host-adapter";

/**
 * A recovered copy of a file the source names (Zoho's export carries file names only). An Approvals admin uploads it through the ordinary
 * uploads, then attaches it here to the historical ticket, against the file name the source gave. It becomes an ordinary attachment of
 * the ticket, so it is downloaded through the same check as any other (only people who may see the ticket). Nothing else on the ticket
 * changes, and it stays archived.
 */
export async function attachRecovered(actor: ApprovalsUser, requestId: string, input: { fileId: string; reference: string }): Promise<{ attachmentId: string }> {
  const [row] = await db
    .select({ h: aprHistoricalRecords, status: aprRequests.status, requestNo: aprRequests.requestNo })
    .from(aprHistoricalRecords)
    .innerJoin(aprRequests, eq(aprRequests.id, aprHistoricalRecords.requestId))
    .where(eq(aprHistoricalRecords.requestId, requestId));
  if (!row || row.status !== "historical") throw new ApprovalsError("That historical ticket was not found.", 404);
  const extra = row.h.extra;
  const at = extra.findIndex((f) => f.kind === "attachment" && f.value === input.reference);
  if (at < 0) throw new ApprovalsError("The source does not name that file for this ticket.", 400);
  if (extra[at].attachmentId) {
    const [still] = await db.select({ id: aprAttachments.id }).from(aprAttachments).where(eq(aprAttachments.id, extra[at].attachmentId!));
    if (still) throw new ApprovalsError("A recovered copy of that file is already attached.", 409);
  }

  const meta = (await checkFilesReady(actor, [input.fileId])).get(input.fileId)!;
  if (!(await claimFiles([input.fileId]))) throw new ApprovalsError(`"${meta.fileName}" has already been used. Please upload it again.`, 409);
  let attachmentId: string;
  try {
    const [made] = await db.insert(aprAttachments).values({
      requestId, slot: "file_upload", fileName: meta.fileName, mime: meta.mime, size: meta.size, storageKey: meta.id, uploadedBy: actor.id,
    }).returning({ id: aprAttachments.id });
    attachmentId = made.id;
    const next = extra.map((f, i) => (i === at ? { ...f, attachmentId } : f));
    await db.update(aprHistoricalRecords).set({ extra: next }).where(eq(aprHistoricalRecords.requestId, requestId));
  } catch (e) {
    await releaseFiles([input.fileId]).catch(() => {});
    throw e;
  }
  await recordAudit(actor, "historical_import", row.h.batchId, "update",
    `Attached the recovered file "${meta.fileName}" for "${input.reference}" to ${row.requestNo ?? "a historical ticket"} (ID ${row.h.legacyId} in the source)`,
    null, { requestId, attachmentId, reference: input.reference });
  return { attachmentId };
}

export type FileReference = { requestId: string; requestNo: string | null; legacyId: string; requesterName: string; name: string; attachmentId: string | null; attachmentName: string | null };

/** Every file the imported tickets' sources name, with whether a recovered copy is attached: the Historical Import page's Files list. */
export async function listFileReferences(): Promise<FileReference[]> {
  const rows = await db
    .select({ requestId: aprHistoricalRecords.requestId, extra: aprHistoricalRecords.extra, legacyId: aprHistoricalRecords.legacyId, requestNo: aprRequests.requestNo, requesterName: aprRequests.requesterName })
    .from(aprHistoricalRecords)
    .innerJoin(aprRequests, eq(aprRequests.id, aprHistoricalRecords.requestId))
    .where(sql`exists (select 1 from jsonb_array_elements(${aprHistoricalRecords.extra}) f where f->>'kind' = 'attachment')`)
    .orderBy(aprRequests.requestNo);
  const ids = rows.flatMap((r) => r.extra.filter((f) => f.kind === "attachment" && f.attachmentId).map((f) => f.attachmentId!));
  const kept = new Map(ids.length ? (await db.select({ id: aprAttachments.id, fileName: aprAttachments.fileName }).from(aprAttachments).where(inArray(aprAttachments.id, ids))).map((a) => [a.id, a.fileName]) : []);
  return rows.flatMap((r) => r.extra.filter((f) => f.kind === "attachment").map((f) => {
    const id = f.attachmentId && kept.has(f.attachmentId) ? f.attachmentId : null;
    return { requestId: r.requestId, requestNo: r.requestNo, legacyId: r.legacyId, requesterName: r.requesterName, name: f.value, attachmentId: id, attachmentName: id ? kept.get(id)! : null };
  }));
}
