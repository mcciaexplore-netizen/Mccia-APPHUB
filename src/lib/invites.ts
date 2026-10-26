import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { headers } from "next/headers";
import { db } from "@/db";
import { userInvites, users } from "@/db/schema";
import { isEnvAdmin } from "@/lib/auth";
import { escapeHtml, sendMail } from "@/lib/mail";
import { hashPassword } from "@/lib/passwords";
import { UserError } from "@/lib/user-error";

/**
 * New accounts, and password resets, by a temporary password sent by email (through the hub's mail settings: the Support Admin's Zoho
 * mailbox). It is random, works for INVITE_HOURS (7 days), and the person must choose their own password the first time they sign in.
 * Only scrambled copies are kept: as the account's password (scrypt) and on the invitation record (SHA-256), which carries the expiry.
 * When the email cannot be sent, the temporary password is shown ONCE to the administrator to pass on; it is never stored, logged or audited.
 */
export const INVITE_HOURS = 7 * 24;
export type Delivery = "sent" | "failed" | "manual";

/** 12 characters without look-alikes (no 0/O, 1/l/I), with an upper, a lower, a digit and a symbol. */
export function tempPassword(): string {
  const sets = ["ABCDEFGHJKLMNPQRSTUVWXYZ", "abcdefghijkmnopqrstuvwxyz", "23456789", "#@$%&*!?"];
  const all = sets.join("");
  const pick = (s: string) => s[randomBytes(1)[0] % s.length];
  const chars = [...sets.map(pick), ...Array.from({ length: 8 }, () => pick(all))];
  for (let i = chars.length - 1; i > 0; i--) { const j = randomBytes(1)[0] % (i + 1); [chars[i], chars[j]] = [chars[j], chars[i]]; }
  return chars.join("");
}

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

/** Emails the sign-in details (when mail is set up) and records how it went. The temporary password is returned only when it was NOT emailed. */
export async function deliverInvite(target: { name: string; email: string }, temp: string): Promise<{ delivery: Delivery; link: string | null }> {
  const site = await siteBase();
  const result = await sendMail(
    target.email,
    "Your MCCIA App Hub account",
    `<div style="font-family:Arial,sans-serif;max-width:520px"><h2 style="margin:0 0 14px">Welcome to the MCCIA App Hub</h2>
     <p>Hello ${escapeHtml(target.name)},</p>
     <p>An account has been made for you. Sign in with these details. The first time you sign in you will be asked to choose your own password.</p>
     <table style="margin:14px 0;border-collapse:collapse">
       <tr><td style="padding:6px 14px 6px 0;color:#555">Sign-in (email)</td><td style="padding:6px 0"><b>${escapeHtml(target.email)}</b></td></tr>
       <tr><td style="padding:6px 14px 6px 0;color:#555">Temporary password</td><td style="padding:6px 0"><b style="font-family:Consolas,monospace;font-size:16px">${escapeHtml(temp)}</b></td></tr>
     </table>
     <p style="margin:18px 0"><a href="${escapeHtml(site)}/login" style="background:#2a6b7c;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px">Sign in to the App Hub</a></p>
     <p style="color:#555;font-size:13px">The temporary password works for ${INVITE_HOURS / 24} days. Do not share it. If you did not expect this email, you can ignore it.</p></div>`,
  );
  const delivery: Delivery = result === "sent" ? "sent" : result === "failed" ? "failed" : "manual";
  await db.update(userInvites).set({ delivery }).where(eq(userInvites.tokenHash, hashToken(temp)));
  return { delivery, link: delivery === "sent" ? null : temp };
}

/**
 * A fresh temporary password for a person (a new account's first one, or a reset): it replaces their password at once, they must choose their
 * own when they next sign in, and it is emailed to them. When it could not be emailed it is returned ONCE so the administrator can pass it on.
 */
export async function sendInvite(target: InviteTarget, createdById: string): Promise<{ delivery: Delivery; link: string | null; expiresAt: Date }> {
  if (isEnvAdmin(target.email)) throw new UserError("This account's password is set in the environment settings.");
  if (!target.isActive) throw new UserError(`${target.name} is inactive. Activate the account first.`);

  const temp = tempPassword();
  const expiresAt = new Date(Date.now() + INVITE_HOURS * 3600 * 1000);
  // Older temporary passwords and links for this person stop working at once.
  await db.update(userInvites).set({ expiresAt: new Date() }).where(and(eq(userInvites.userId, target.id), isNull(userInvites.usedAt), gt(userInvites.expiresAt, new Date())));
  await db.update(users).set({ passwordHash: await hashPassword(temp), mustChangePassword: true }).where(eq(users.id, target.id)); // also signs them out
  await db.insert(userInvites).values({ userId: target.id, tokenHash: hashToken(temp), expiresAt, createdById });
  const { delivery, link } = await deliverInvite(target, temp);
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
