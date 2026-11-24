import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { aprAttachments, aprHistoricalRecords, aprImportBatches, aprRequests, type HistoricalField, type HistoricalTimelineEntry } from "@/db/approvals-schema";
import { adapterByKey } from "./rules";

/** What an opened historical ticket shows besides its ordinary details (see RequestDetailView). */
export type HistoricalView = {
  requestId: string;
  /** Which form it was filed as. */
  form: "hr" | "expenditure";
  systemLabel: string;
  legacyId: string;
  sourceStatus: string;
  requester: { name: string; email: string; linkedName: string | null; note: string | null };
  category: { name: string; sourceId: string | null; hubName: string | null };
  sourceDates: HistoricalField[];
  /** When the source has no request date: what the ticket is listed by instead (never shown as the request date). */
  listedBy: HistoricalField | null;
  /** The files the source names, and whether a recovered copy has been attached in the hub (its attachment's id). */
  attachments: { name: string; attachmentId: string | null }[];
  timeline: HistoricalTimelineEntry[];
  notes: string[];
  extra: HistoricalField[];
  importedAt: Date;
  importedByName: string;
  fileName: string;
  /** The record as it was in the file: administrators only. */
  sourceRecord: unknown | null;
  /** Whether the person may attach a recovered copy of a file the source names (administrators, from the Historical Import page). */
  canAttach: boolean;
};

/** What a historical ticket keeps from its source, or null for an ordinary request. The caller has already checked the person may see it. */
export async function historicalView(requestId: string, withSource: boolean): Promise<HistoricalView | null> {
  const [h] = await db
    .select({ h: aprHistoricalRecords, fileName: aprImportBatches.fileName, importedByName: aprImportBatches.importedByName, sourceKey: aprImportBatches.sourceKey })
    .from(aprHistoricalRecords)
    .innerJoin(aprImportBatches, eq(aprImportBatches.id, aprHistoricalRecords.batchId))
    .where(eq(aprHistoricalRecords.requestId, requestId));
  if (!h) return null;
  const r = h.h;
  // A recovered file counts only while its attachment is still on this ticket.
  const kept = new Set((await db.select({ id: aprAttachments.id }).from(aprAttachments).where(eq(aprAttachments.requestId, requestId))).map((a) => a.id));
  const [req] = await db.select({ type: aprRequests.type }).from(aprRequests).where(eq(aprRequests.id, requestId));
  return {
    requestId, form: req?.type === "hr" ? "hr" : "expenditure",
    systemLabel: adapterByKey(h.sourceKey)?.systemLabel ?? r.sourceSystem, legacyId: r.legacyId, sourceStatus: r.sourceStatus,
    requester: { name: r.requester.name, email: r.requester.email, linkedName: r.requester.linkedName, note: r.requester.note },
    category: { name: r.category.name, sourceId: r.category.sourceId, hubName: r.category.hubName },
    sourceDates: r.sourceDates.filter((f) => f.kind !== "listed_by"), listedBy: r.sourceDates.find((f) => f.kind === "listed_by") ?? null,
    attachments: r.extra.filter((f) => f.kind === "attachment").map((f) => ({ name: f.value, attachmentId: f.attachmentId && kept.has(f.attachmentId) ? f.attachmentId : null })),
    timeline: r.timeline, notes: r.notes, extra: r.extra.filter((f) => f.kind !== "attachment"), importedAt: r.importedAt, importedByName: h.importedByName, fileName: h.fileName,
    sourceRecord: withSource ? r.sourceRecord : null, canAttach: withSource,
  };
}
