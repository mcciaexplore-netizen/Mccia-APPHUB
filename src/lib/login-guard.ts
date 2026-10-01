import "server-only";
import { and, count, desc, eq, gte } from "drizzle-orm";
import { db } from "@/db";
import { loginAttempts } from "@/db/schema";

const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILS_PER_EMAIL = 5; // then the account is locked until the window passes
const MAX_FAILS_PER_IP = 25;

export function clientIp(h: Headers): string | null {
  const fwd = h.get("x-forwarded-for")?.split(",")[0]?.trim();
  return fwd || h.get("x-real-ip") || null;
}

/** True when this email (after repeated failures) or this IP (too many failures overall) is temporarily blocked. */
export async function isLoginBlocked(email: string, ip: string | null): Promise<boolean> {
  const since = new Date(Date.now() - WINDOW_MS);

  // Failures for this email since the last successful sign-in inside the window.
  const [lastOk] = await db
    .select({ at: loginAttempts.createdAt })
    .from(loginAttempts)
    .where(and(eq(loginAttempts.email, email), eq(loginAttempts.success, true), gte(loginAttempts.createdAt, since)))
    .orderBy(desc(loginAttempts.createdAt))
    .limit(1);
  const from = lastOk && lastOk.at > since ? lastOk.at : since;
  const [{ n }] = await db
    .select({ n: count() })
    .from(loginAttempts)
    .where(and(eq(loginAttempts.email, email), eq(loginAttempts.success, false), gte(loginAttempts.createdAt, from)));
  if (n >= MAX_FAILS_PER_EMAIL) return true;

  if (ip) {
    const [{ m }] = await db
      .select({ m: count() })
      .from(loginAttempts)
      .where(and(eq(loginAttempts.ipAddress, ip), eq(loginAttempts.success, false), gte(loginAttempts.createdAt, since)));
    if (m >= MAX_FAILS_PER_IP) return true;
  }
  return false;
}

export async function recordLoginAttempt(email: string, ip: string | null, success: boolean) {
  await db.insert(loginAttempts).values({ email: email.slice(0, 254), ipAddress: ip, success });
}

/** Clears the failure history for one email (used when an admin resets a password). */
export async function clearLoginFailures(email: string) {
  await db.delete(loginAttempts).where(eq(loginAttempts.email, email));
}
