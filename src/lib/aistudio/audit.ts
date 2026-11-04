import "server-only";
import { db } from "./db";
import { auditLogs } from "@/db/aistudio-schema";

/** Writes one line of a request's history. Never throws: history must not undo the change it records. */
export async function audit(requestId: string, userId: string | null, action: string, details: Record<string, unknown> = {}, actorLabel?: string): Promise<void> {
  try {
    await db.insert(auditLogs).values({ requestId, userId, action, details, actorLabel: actorLabel ?? null });
  } catch {
    // see above
  }
}
