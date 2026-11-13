import "server-only";
import { db } from "./db";
import { auditLogs } from "@/db/eru-schema";

/** Writes one line of a project's history (project null: a module-wide event, such as a settings change). Never throws: history must not undo the change it records. */
export async function audit(projectId: string | null, userId: string | null, action: string, details: Record<string, unknown> = {}): Promise<void> {
  try {
    await db.insert(auditLogs).values({ projectId, userId, action, details });
  } catch {
    // see above
  }
}
