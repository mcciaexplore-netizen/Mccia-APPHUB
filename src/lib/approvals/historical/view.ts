import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { aprHistoricalRecords, aprImportBatches, type HistoricalField, type HistoricalTimelineEntry } from "@/db/approvals-schema";
import { adapterByKey } from "./rules";

/** What an opened historical ticket shows besides its ordinary details (see RequestDetailView). */
export type HistoricalView = {
  systemLabel: string;
  legacyId: string;
  sourceStatus: string;
  requester: { name: string; email: string; linkedName: string | null; note: string | null };
  category: { name: string; sourceId: string | null; hubName: string | null };
  sourceDates: HistoricalField[];
  timeline: HistoricalTimelineEntry[];
  notes: string[];
  extra: HistoricalField[];
  importedAt: Date;
  importedByName: string;
  fileName: string;
  /** The record as it was in the file: administrators only. */
  sourceRecord: unknown | null;
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
  return {
    systemLabel: adapterByKey(h.sourceKey)?.systemLabel ?? r.sourceSystem, legacyId: r.legacyId, sourceStatus: r.sourceStatus,
    requester: { name: r.requester.name, email: r.requester.email, linkedName: r.requester.linkedName, note: r.requester.note },
    category: { name: r.category.name, sourceId: r.category.sourceId, hubName: r.category.hubName },
    sourceDates: r.sourceDates, timeline: r.timeline, notes: r.notes, extra: r.extra, importedAt: r.importedAt, importedByName: h.importedByName, fileName: h.fileName,
    sourceRecord: withSource ? r.sourceRecord : null,
  };
}
