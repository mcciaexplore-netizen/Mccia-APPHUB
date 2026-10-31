import "server-only";
import { db } from "@/lib/ivr/db";
import { auditLog } from "@/db/ivr-schema";

export async function audit(userId: string | null, action: string, target?: string, detail?: Record<string, unknown>) {
  try {
    await db.insert(auditLog).values({ userId, action, target, detail });
  } catch {
    // Auditing must never break the action being audited.
  }
}
