import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { loginAttempts } from "@/db/schema";

export function clientIp(h: Headers): string | null {
  const fwd = h.get("x-forwarded-for")?.split(",")[0]?.trim();
  return fwd || h.get("x-real-ip") || null;
}

/** Logs every attempt for the record. Nothing is ever blocked: a wrong password just fails and can be retried at once. */
export async function recordLoginAttempt(email: string, ip: string | null, success: boolean) {
  await db.insert(loginAttempts).values({ email: email.slice(0, 254), ipAddress: ip, success });
}

/** Clears the logged attempts for one email (used when an admin resets a password). */
export async function clearLoginFailures(email: string) {
  await db.delete(loginAttempts).where(eq(loginAttempts.email, email));
}
