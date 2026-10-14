import "server-only";
import { and, count, eq, gt, lt } from "drizzle-orm";
import { db } from "@/db";
import { aprRateLimits } from "@/db/approvals-schema";
import { ApprovalsError } from "./errors";

/**
 * Counts a hit for a person on a named route and refuses once they have made more than `max` in the last `windowSeconds`.
 * The counter is a table, because serverless instances do not share memory.
 */
export async function rateLimit(bucket: string, userId: string, max: number, windowSeconds: number): Promise<void> {
  const since = new Date(Date.now() - windowSeconds * 1000);
  await db.insert(aprRateLimits).values({ bucket, userId });
  const [row] = await db
    .select({ n: count() })
    .from(aprRateLimits)
    .where(and(eq(aprRateLimits.bucket, bucket), eq(aprRateLimits.userId, userId), gt(aprRateLimits.createdAt, since)));
  if ((row?.n ?? 0) > max) throw new ApprovalsError("You are doing that too quickly. Please wait a moment and try again.", 429);
  // Housekeeping: one hit in fifty also clears rows older than an hour.
  if (Math.random() < 0.02) await db.delete(aprRateLimits).where(lt(aprRateLimits.createdAt, new Date(Date.now() - 3600 * 1000)));
}
