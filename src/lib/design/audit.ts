import "server-only";
import { db } from "./db";
import { auditLogs } from "@/db/design-schema";

/** Writes one line of a ticket's history. Never throws: history must not undo the change it records. */
export async function audit(ticketId: string, userId: string | null, action: string, details: Record<string, unknown> = {}, actorLabel?: string): Promise<void> {
  try {
    await db.insert(auditLogs).values({ ticketId, userId, action, details, actorLabel: actorLabel ?? null });
  } catch {
    // see above
  }
}
