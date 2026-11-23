import { z } from "zod";

/**
 * The rules of "Forgot password?" (src/lib/password-reset.ts does the work). Pure, so the pages, the server and the unit tests share them.
 *
 *   - A link holds 32 random bytes as 64 hex characters, works for one hour, and works once.
 *   - At most 3 links an hour for one email, and 10 requests an hour from one network address; beyond that nothing is sent, and the person
 *     sees the same answer as always.
 *   - A link is only ever an https:// address (http only for this computer, in development).
 */
export const RESET_TTL_MS = 60 * 60 * 1000;
export const RESET_LIMITS = { perEmail: 3, perIp: 10, windowMs: 60 * 60 * 1000 } as const;

/** What a link's secret looks like: 64 lowercase hex characters. Anything else is refused before the database is asked. */
export const isResetToken = (t: unknown): t is string => typeof t === "string" && /^[0-9a-f]{64}$/.test(t);

/** Whether a request is over a limit, given how many came in the last hour INCLUDING this one. */
export const overResetLimit = (forEmail: number, fromIp: number) => forEmail > RESET_LIMITS.perEmail || fromIp > RESET_LIMITS.perIp;

/** The rules a new password must meet, as shown under the field (each ticks when met). */
export const PASSWORD_RULES = [
  { label: "Minimum 8 characters", test: (p: string) => p.length >= 8 },
  { label: "At least one uppercase letter", test: (p: string) => /[A-Z]/.test(p) },
  { label: "At least one number", test: (p: string) => /\d/.test(p) },
] as const;

export const resetPasswordSchema = z
  .string()
  .max(128, "Password must be at most 128 characters")
  .refine((p) => p.length >= 8, "Password must be at least 8 characters")
  .refine((p) => /[A-Z]/.test(p), "Password needs at least one uppercase letter")
  .refine((p) => /\d/.test(p), "Password needs at least one number");

/**
 * The link to put in the email, or null when the site address is not https:// (a reset link must never travel in the clear). Plain http is
 * accepted only for this computer (localhost, 127.0.0.1), for development and tests.
 */
export function resetLink(site: string, token: string): string | null {
  let u: URL;
  try {
    u = new URL("/reset-password", site);
  } catch {
    return null;
  }
  const local = u.protocol === "http:" && (u.hostname === "localhost" || u.hostname === "127.0.0.1");
  if (u.protocol !== "https:" && !local) return null;
  u.searchParams.set("token", token);
  return u.toString();
}

export const RESET_SUBJECT = "Reset your MCCIA AppHub password";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** The reset email, in the hub's email style (the same teal header as the sign-in details). */
export function resetEmailHtml(name: string, link: string): string {
  const p = (t: string) => `<p style="margin:0 0 14px;line-height:1.55">${t}</p>`;
  return `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#0f172a">
  <div style="background:#2a6b7c;color:#fff;padding:18px 22px;border-radius:12px 12px 0 0"><div style="font-size:12px;letter-spacing:2px;text-transform:uppercase;opacity:.85">MCCIA AppHub</div><div style="font-size:20px;font-weight:bold;margin-top:4px">Reset your password</div></div>
  <div style="border:1px solid #e2e8f0;border-top:0;border-radius:0 0 12px 12px;padding:20px 22px">
    ${p(`Hi ${esc(name)},`)}
    ${p("Someone requested a password reset for your MCCIA AppHub account.")}
    ${p("Click the link below to reset your password. This link expires in 1 hour.")}
    <p style="margin:4px 0 20px"><a href="${esc(link)}" style="background:#2a6b7c;color:#fff;text-decoration:none;padding:11px 20px;border-radius:8px;display:inline-block;font-weight:bold">Reset Password →</a></p>
    ${p(`If you didn't request this, ignore this email. Your password will not be changed.`)}
    <p style="margin:18px 0 0">MCCIA AppHub Team</p>
    <p style="color:#64748b;font-size:12px;margin:18px 0 0">If the button does not work, copy this address into your browser:<br><span style="word-break:break-all">${esc(link)}</span></p>
  </div></div>`;
}
