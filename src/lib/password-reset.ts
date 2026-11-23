import "server-only";
import { randomBytes } from "node:crypto";
import { and, count, eq, gt, isNull, lt, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { hubPasswordResetTokens, loginAttempts, userInvites, users } from "@/db/schema";
import { writeAudit } from "@/lib/audit";
import { isEnvAdmin } from "@/lib/auth";
import { hashToken } from "@/lib/invites";
import { logError } from "@/lib/log-error";
import { sendMail } from "@/lib/mail";
import { hashPassword } from "@/lib/passwords";
import { RESET_LIMITS, RESET_SUBJECT, RESET_TTL_MS, isResetToken, overResetLimit, resetEmailHtml, resetLink } from "@/lib/password-reset-rules";
import { siteUrl } from "@/lib/site-url";

/**
 * "Forgot password?": a person asks for a link by email, and the link lets them choose a new password. The rules are in
 * password-reset-rules.ts. What is kept, and how:
 *
 *   - hub_password_reset_tokens holds the SHA-256 of each link's secret (never the secret) with its expiry, so a copy of the database
 *     resets nobody's password. Asking again replaces the earlier link; using a link deletes every link of that person.
 *   - Each request is counted in login_attempts (kind "reset", for the per-email and per-address limits). They are written as
 *     success = true, so they never count towards the sign-in limits, which count only wrong passwords.
 *   - Only an active, approved account with a password of its own gets an email. The Support Admin account (password in the environment
 *     settings) cannot be reset here. Nobody is ever told whether an email has an account.
 *   - The new password signs the person out everywhere: every sign-in carries a fingerprint of the password (src/lib/auth.ts).
 */

const norm = (email: string) => email.trim().toLowerCase().slice(0, 320);

/**
 * Handles one "Send reset link". Runs after the answer has gone back (see the action), so how long it takes says nothing about the email.
 * Never throws: whatever happens, the person has already been told the same thing.
 */
export async function requestPasswordReset(emailRaw: string, ip: string | null): Promise<"sent" | "limited" | "no_account" | "not_sent"> {
  try {
    const email = norm(emailRaw);
    const ipKey = (ip ?? "unknown").slice(0, 100);
    if (!email) return "no_account";
    await db.insert(loginAttempts).values({ email, ipAddress: ipKey, kind: "reset", success: true });
    const since = new Date(Date.now() - RESET_LIMITS.windowMs);
    const [byEmail] = await db.select({ n: count() }).from(loginAttempts).where(and(eq(loginAttempts.kind, "reset"), eq(loginAttempts.email, email), gt(loginAttempts.createdAt, since)));
    const [byIp] = await db.select({ n: count() }).from(loginAttempts).where(and(eq(loginAttempts.kind, "reset"), eq(loginAttempts.ipAddress, ipKey), gt(loginAttempts.createdAt, since)));
    if (overResetLimit(byEmail.n, byIp.n)) return "limited";

    if (isEnvAdmin(email)) return "no_account";
    const [u] = await db.select({ id: users.id, name: users.name, email: users.email }).from(users)
      .where(and(eq(users.email, email), eq(users.isActive, true), eq(users.status, "approved"), sql`${users.signupSource} is distinct from 'env'`));
    if (!u) return "no_account";

    const token = randomBytes(32).toString("hex");
    let link: string | null = null;
    try {
      link = resetLink(siteUrl(), token);
    } catch (e) {
      logError("[reset] site address not set", e);
    }
    if (!link) {
      console.error("[reset] not sent: the site address (APP_BASE_URL) must start with https://");
      return "not_sent";
    }
    // A new link replaces the earlier ones; expired links of anyone are tidied away at the same time.
    await db.delete(hubPasswordResetTokens).where(or(eq(hubPasswordResetTokens.userId, u.id), lt(hubPasswordResetTokens.expiresAt, new Date())));
    await db.insert(hubPasswordResetTokens).values({ userId: u.id, token: hashToken(token), expiresAt: new Date(Date.now() + RESET_TTL_MS) });
    const sent = await sendMail(u.email, RESET_SUBJECT, resetEmailHtml(u.name, link));
    if (sent !== "sent") console.error(`[reset] email not sent (${sent})`);
    return sent === "sent" ? "sent" : "not_sent";
  } catch (e) {
    logError("[reset] request failed", e);
    return "not_sent";
  }
}

/** Whether a link can still be used: known, not expired, and its account still able to sign in. Reveals nothing else. */
export async function resetLinkValid(token: unknown): Promise<boolean> {
  if (!isResetToken(token)) return false;
  const res = (await db.execute(sql`
    select 1 from hub_password_reset_tokens t join users u on u.id = t.user_id
    where t.token = ${hashToken(token)} and t.expires_at > now() and u.is_active and u.status = 'approved' and u.signup_source is distinct from 'env'`)) as unknown as { rows: unknown[] };
  return res.rows.length > 0;
}

/**
 * Uses a link: one statement deletes the link and saves the password together, so a link is used once and never spent for nothing. Then
 * every other link of that person is deleted, and any temporary password they were sent stops working. Returns false for a link that
 * cannot be used.
 */
export async function completePasswordReset(token: unknown, password: string): Promise<boolean> {
  if (!isResetToken(token)) return false;
  // Looked up before the (deliberately slow) password hash, so guessing links cannot be used to burn the server's time.
  if (!(await resetLinkValid(token))) return false;
  const hash = await hashPassword(password);
  const res = (await db.execute(sql`
    with t as (
      delete from hub_password_reset_tokens where token = ${hashToken(token)} and expires_at > now() returning user_id
    )
    update users set password_hash = ${hash}, must_change_password = false
    from t where users.id = t.user_id and users.is_active and users.status = 'approved' and users.signup_source is distinct from 'env'
    returning users.id, users.name`)) as unknown as { rows: { id: string; name: string }[] };
  const who = res.rows[0];
  if (!who) return false;
  await db.delete(hubPasswordResetTokens).where(eq(hubPasswordResetTokens.userId, who.id));
  await db.update(userInvites).set({ usedAt: new Date() }).where(and(eq(userInvites.userId, who.id), isNull(userInvites.usedAt)));
  await writeAudit({ id: who.id, name: who.name }, [{ action: "user.password_reset", targetType: "user", targetId: who.id, targetLabel: who.name, details: { via: "email link" } }]).catch((e) => logError("[reset] audit failed", e));
  return true;
}
