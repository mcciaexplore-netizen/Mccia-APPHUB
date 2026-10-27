import "server-only";
import { and, eq, gt, or } from "drizzle-orm";
import { db } from "@/db";
import { loginAttempts } from "@/db/schema";
import { LIMITS, WINDOW_MS, refusedUntil, slowDownMs } from "@/lib/sign-in-rules";

/**
 * Applies the sign-in limits (the rules are in src/lib/sign-in-rules.ts) to the three password forms: signing in, unlocking
 * Administrator and changing one's password. Every attempt is recorded in login_attempts, and those rows decide the limits. A refused
 * try is recorded too (blocked = true) but does not count, so a refusal ends 15 minutes after the last wrong password that caused it.
 * The person is always shown the same message as for a wrong password.
 */
export type AttemptKind = "login" | "unlock" | "password";

const norm = (email: string) => email.trim().toLowerCase().slice(0, 320);
const ipKey = (ip: string | null) => (ip ?? "unknown").slice(0, 100);

/**
 * Checks the limits before a password is looked at. When refused, the try is recorded and true is returned: the caller then answers
 * exactly as for a wrong password. Otherwise it waits (when the email is being guessed from many places) and returns false.
 */
export async function refuseOrSlow(emailRaw: string, ipRaw: string | null, kind: AttemptKind, now = Date.now()): Promise<boolean> {
  const email = norm(emailRaw), ip = ipKey(ipRaw);
  // Two windows back: a refusal can still be running from wrong passwords made up to 30 minutes ago.
  const rows = await db.select({ email: loginAttempts.email, ip: loginAttempts.ipAddress, at: loginAttempts.createdAt }).from(loginAttempts)
    .where(and(gt(loginAttempts.createdAt, new Date(now - 2 * WINDOW_MS)), eq(loginAttempts.success, false), eq(loginAttempts.blocked, false),
      or(eq(loginAttempts.ipAddress, ip), email ? eq(loginAttempts.email, email) : undefined)));
  const at = (r: (typeof rows)[number]) => r.at.getTime();
  const fromIp = rows.filter((r) => r.ip === ip).map(at);
  const pair = rows.filter((r) => r.ip === ip && !!email && r.email === email).map(at);
  if (refusedUntil(pair, LIMITS.emailIp) > now || refusedUntil(fromIp, LIMITS.ip) > now) {
    await record(email, ip, kind, false, true);
    return true;
  }
  const wait = email ? slowDownMs(rows.filter((r) => r.email === email && at(r) > now - WINDOW_MS).length) : 0;
  if (wait) await new Promise((r) => setTimeout(r, wait));
  return false;
}

/** Records one attempt: its email (lower case), the IP, which form, whether the password was right, and whether the limits refused it. */
export async function record(emailRaw: string, ipRaw: string | null, kind: AttemptKind, success: boolean, blocked = false): Promise<void> {
  await db.insert(loginAttempts).values({ email: norm(emailRaw), ipAddress: ipKey(ipRaw), kind, success, blocked });
}
