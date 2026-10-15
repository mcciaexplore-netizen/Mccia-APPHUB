import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { headers } from "next/headers";
import { db } from "@/db";
import { userInvites } from "@/db/schema";
import { isEnvAdmin } from "@/lib/auth";
import { escapeHtml, sendMail } from "@/lib/mail";
import { hashPassword } from "@/lib/passwords";
import { UserError } from "@/lib/user-error";

/**
 * Account set-up by invitation. Nobody types or hears another person's password: the person gets a one-time link, opens it and chooses
 * their own. The link holds a random 256-bit token; only its SHA-256 hash is stored, so even someone who can read the database cannot
 * rebuild a link. A link works once, for 72 hours, and sending a new one cancels the old one.
 */
export const INVITE_HOURS = 72;
export type Delivery = "sent" | "failed" | "manual";

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

/** The address of this site for links: APP_BASE_URL when set, otherwise the address this request came in on. */
async function siteBase(): Promise<string> {
  const fixed = (process.env.APP_BASE_URL ?? "").trim().replace(/\/$/, "");
  if (fixed) return fixed;
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
  return `${proto}://${host}`;
}

export type InviteTarget = { id: string; name: string; email: string; isActive: boolean };

/** Emails a link (when mail is set up) and records how it went. The link is returned only when it was NOT emailed, so it can be passed on by hand. */
export async function deliverInvite(target: { name: string; email: string }, token: string): Promise<{ delivery: Delivery; link: string | null }> {
  const link = `${await siteBase()}/set-password?token=${token}`;
  const result = await sendMail(
    target.email,
    "Set up your MCCIA App Hub password",
    `<div style="font-family:Arial,sans-serif;max-width:520px"><h2 style="margin:0 0 14px">Welcome to the MCCIA App Hub</h2>
     <p>Hello ${escapeHtml(target.name)},</p>
     <p>An account has been created for you. Choose your password with the button below. The link works once and expires in ${INVITE_HOURS} hours.</p>
     <p style="margin:18px 0"><a href="${escapeHtml(link)}" style="background:#2a6b7c;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px">Set my password</a></p>
     <p style="color:#555;font-size:13px">If you did not expect this email, you can ignore it.</p></div>`,
  );
  const delivery: Delivery = result === "sent" ? "sent" : result === "failed" ? "failed" : "manual";
  await db.update(userInvites).set({ delivery }).where(eq(userInvites.tokenHash, hashToken(token)));
  return { delivery, link: delivery === "sent" ? null : link };
}

/**
 * Makes a fresh link for a person and tries to email it. Returns how it was delivered; when it could not be emailed the link itself is
 * returned ONCE so the administrator can pass it on. It is never stored, logged, audited or put in a report.
 */
export async function sendInvite(target: InviteTarget, createdById: string): Promise<{ delivery: Delivery; link: string | null; expiresAt: Date }> {
  if (isEnvAdmin(target.email)) throw new UserError("The main admin's password is set in the environment settings.");
  if (!target.isActive) throw new UserError(`${target.name} is inactive. Activate the account first.`);

  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + INVITE_HOURS * 3600 * 1000);
  // Older links for this person stop working at once.
  await db.update(userInvites).set({ expiresAt: new Date() }).where(and(eq(userInvites.userId, target.id), isNull(userInvites.usedAt), gt(userInvites.expiresAt, new Date())));
  await db.insert(userInvites).values({ userId: target.id, tokenHash: hashToken(token), expiresAt, createdById });
  const { delivery, link } = await deliverInvite(target, token);
  return { delivery, link, expiresAt };
}

/** Who a link is for, or null when it is unknown, used, expired or the account is no longer usable. Reveals nothing else. */
export async function inviteInfo(token: string): Promise<{ name: string; email: string } | null> {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) return null;
  const res = (await db.execute(sql`
    select u.name, u.email from user_invites i join users u on u.id = i.user_id
    where i.token_hash = ${hashToken(token)} and i.used_at is null and i.expires_at > now() and u.is_active and u.status = 'approved' and u.signup_source is distinct from 'env'`)) as unknown as { rows: { name: string; email: string }[] };
  return res.rows[0] ?? null;
}

/** Uses a link to set the password. One statement: the link is used up and the password saved together, so a link can never be spent for nothing. */
export async function completeInvite(token: string, password: string): Promise<boolean> {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) return false;
  // Look the link up before the (deliberately slow) password hash, so guessing links cannot be used to burn the server's time.
  if (!(await inviteInfo(token))) return false;
  const hash = await hashPassword(password);
  const res = (await db.execute(sql`
    with inv as (
      update user_invites set used_at = now()
      where token_hash = ${hashToken(token)} and used_at is null and expires_at > now() returning user_id
    )
    update users set password_hash = ${hash}, must_change_password = false
    from inv where users.id = inv.user_id and users.is_active and users.status = 'approved' and users.signup_source is distinct from 'env'
    returning users.id`)) as unknown as { rows: unknown[] };
  return res.rows.length > 0;
}
