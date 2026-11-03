import "server-only";
import { eq } from "drizzle-orm";
import { db } from "./db";
import { profiles } from "@/db/design-schema";

/** Small reads for the Design Team Forms pages. */

/** Whether this team member gets DesignDesk emails (on until they turn it off). */
export async function emailEnabledFor(userId: string): Promise<boolean> {
  const [p] = await db.select({ on: profiles.emailEnabled }).from(profiles).where(eq(profiles.userId, userId)).limit(1);
  return p?.on ?? true;
}
