import "server-only";
import { and, eq, gt, ne, or } from "drizzle-orm";
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
 * Starts one attempt, before the password is looked at. The try is recorded FIRST, as a wrong password, and only then are the earlier
 * ones counted (like the Approval System's limiter): a burst of simultaneous guesses each sees the others already written, so no more
 * than the limit get their password checked. Refused: the row is marked blocked and `refused` is true; the caller then answers exactly as
 * for a wrong password. Otherwise it waits (when the email is being guessed from many places). When the password turns out right, the
 * caller says so with attemptSucceeded(id).
 */
export async function startAttempt(emailRaw: string, ipRaw: string | null, kind: AttemptKind, now = Date.now()): Promise<{ id: number; refused: boolean }> {
  const email = norm(emailRaw), ip = ipKey(ipRaw);
  const [mine] = await db.insert(loginAttempts).values({ email, ipAddress: ip, kind, success: false }).returning({ id: loginAttempts.id });
  // Two windows back: a refusal can still be running from wrong passwords made up to 30 minutes ago. This try itself is not counted.
  const rows = await db.select({ email: loginAttempts.email, ip: loginAttempts.ipAddress, at: loginAttempts.createdAt }).from(loginAttempts)
    .where(and(gt(loginAttempts.createdAt, new Date(now - 2 * WINDOW_MS)), eq(loginAttempts.success, false), eq(loginAttempts.blocked, false),
      ne(loginAttempts.id, mine.id), or(eq(loginAttempts.ipAddress, ip), email ? eq(loginAttempts.email, email) : undefined)));
  const at = (r: (typeof rows)[number]) => r.at.getTime();
  const fromIp = rows.filter((r) => r.ip === ip).map(at);
  const pair = rows.filter((r) => r.ip === ip && !!email && r.email === email).map(at);
  if (refusedUntil(pair, LIMITS.emailIp) > now || refusedUntil(fromIp, LIMITS.ip) > now) {
    await db.update(loginAttempts).set({ blocked: true }).where(eq(loginAttempts.id, mine.id));
    return { id: mine.id, refused: true };
  }
  const wait = email ? slowDownMs(rows.filter((r) => r.email === email && at(r) > now - WINDOW_MS).length) : 0;
  if (wait) await new Promise((r) => setTimeout(r, wait));
  return { id: mine.id, refused: false };
}

/** The password of an attempt started with startAttempt was right: it no longer counts as a wrong one. */
export async function attemptSucceeded(id: number): Promise<void> {
  await db.update(loginAttempts).set({ success: true }).where(eq(loginAttempts.id, id));
}
