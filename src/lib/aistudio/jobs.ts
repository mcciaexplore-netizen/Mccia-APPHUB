import "server-only";
import { and, eq, isNull, lt, or } from "drizzle-orm";
import { db } from "./db";
import { settings } from "@/db/aistudio-schema";
import { removeUnclaimed } from "./files";
import { aistudioEnabled } from "./flags";
import { logError } from "./host-adapter";

/**
 * Background work, run while people use the module (no cron): uploads never used by a request are removed after a day. At most once every
 * five minutes across every server: the run is claimed by moving last_tick_at forward in one statement, so two at once cannot both run.
 */
const GAP_MS = 5 * 60_000;

export async function runIfDue(): Promise<void> {
  if (!aistudioEnabled()) return;
  try {
    const now = new Date();
    const [claimed] = await db
      .update(settings)
      .set({ lastTickAt: now })
      .where(and(eq(settings.id, 1), or(isNull(settings.lastTickAt), lt(settings.lastTickAt, new Date(now.getTime() - GAP_MS)))))
      .returning({ id: settings.id });
    if (!claimed) return;
    await removeUnclaimed(new Date(now.getTime() - 24 * 3600_000));
  } catch (e) {
    logError("[aistudio] background jobs failed", e);
  }
}
