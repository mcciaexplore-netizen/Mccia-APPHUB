import "server-only";
import { and, eq, isNull, lt, or } from "drizzle-orm";
import { db } from "./db";
import { settings } from "@/db/eru-schema";
import { removeUnclaimed } from "./files";
import { eruEnabled } from "./flags";
import { logError } from "./host-adapter";

/**
 * Background work, run while people use the module (no cron): uploads never claimed by a project or document are removed after a day. At
 * most once every five minutes across every server: the run is claimed by moving last_tick_at forward in one statement, so two at once
 * cannot both run.
 */
const GAP_MS = 5 * 60_000;

export async function runIfDue(): Promise<void> {
  if (!eruEnabled()) return;
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
    logError("[eru] background jobs failed", e);
  }
}
