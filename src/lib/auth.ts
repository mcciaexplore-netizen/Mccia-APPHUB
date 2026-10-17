import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { activityLog, users, type User } from "@/db/schema";
import { burnPasswordCheck, verifyPassword } from "@/lib/passwords";

const digest = (v: string) => createHash("sha256").update(v).digest();
const same = (a: string, b: string) => timingSafeEqual(digest(a), digest(b));

/**
 * The four main accounts, whose email, name and password live in the environment settings, not in the database:
 *   Support Admin  SUPPORT_ADMIN_* (or the older HEAD_ADMIN_*)   everything
 *   Super Admin    SUPER_ADMIN_*                                 the DG: the final approver on all approvals
 *   HR             HR_ADMIN_*                                    the HR reviewer (approvals and their applications only)
 *   Expenditure    EXPENDITURE_ADMIN_*                           the expense approver (approvals and their applications only)
 * Each is set with <PREFIX>_EMAIL, <PREFIX>_NAME and <PREFIX>_PASSWORD. They sign in with the password from the settings, so changing it
 * there (and redeploying) changes it, and none of them can be locked out, deactivated, deleted or given another role from the screens.
 * An account counts only when its email AND its password are both set, so a half-filled setting never locks anyone out. The Support Admin
 * can be set by SUPPORT_ADMIN_* and by the older HEAD_ADMIN_* at the same time (both work, which makes changing over safe). An address can
 * belong to only one account: the first in the list above wins.
 */
export type EnvKey = "support" | "super" | "hr" | "expenditure";
type EnvAccount = { key: EnvKey; role: "head_admin" | "super_admin" | "member"; email: string; password: string; name: string };
const ENV_DEFS: { key: EnvKey; role: EnvAccount["role"]; prefix: string; name: string }[] = [
  { key: "support", role: "head_admin", prefix: "SUPPORT_ADMIN", name: "Admin" },
  { key: "support", role: "head_admin", prefix: "HEAD_ADMIN", name: "Admin" },
  { key: "super", role: "super_admin", prefix: "SUPER_ADMIN", name: "Super Admin" },
  { key: "hr", role: "member", prefix: "HR_ADMIN", name: "HR" },
  { key: "expenditure", role: "member", prefix: "EXPENDITURE_ADMIN", name: "Expenditure" },
];
const lower = (v: string | undefined) => v?.trim().toLowerCase() || "";

function envAccounts(): EnvAccount[] {
  const out: EnvAccount[] = [];
  for (const d of ENV_DEFS) {
    const email = lower(process.env[`${d.prefix}_EMAIL`]);
    // Spaces or a line break pasted around a password in the settings are not part of it.
    const password = (process.env[`${d.prefix}_PASSWORD`] ?? "").trim();
    if (!email || !password || out.some((a) => a.email === email)) continue;
    out.push({ key: d.key, role: d.role, email, password, name: process.env[`${d.prefix}_NAME`]?.trim() || d.name });
  }
  return out;
}
const envAccount = (email: string): EnvAccount | null => envAccounts().find((a) => a.email === email.trim().toLowerCase()) ?? null;

/** True for one of the four main accounts (an email and a password both set): it signs in with a password from the environment settings. */
export const isEnvAdmin = (email: string) => !!envAccount(email);

/** The address set for one of the main accounts, or null when it is not set. */
export const envAccountEmail = (key: EnvKey): string | null => envAccounts().find((a) => a.key === key)?.email ?? null;

/** Changes whenever the person's password changes, so older sign-ins stop working. */
export const userFingerprint = (u: Pick<User, "email" | "passwordHash">) =>
  createHash("sha256").update(isEnvAdmin(u.email) ? `env:${envAccount(u.email)?.password ?? ""}` : (u.passwordHash ?? "")).digest("base64url").slice(0, 12);

/**
 * Whether the settings decide an account's role for good: the Support Admin and the Super Admin are those roles by definition, so signing in
 * puts them back. HR and Expenditure start as ordinary users, and after that the Support Admin may give them another role.
 */
export const envRoleIsFixed = (email: string) => { const a = envAccount(email); return !!a && (a.key === "support" || a.key === "super"); };

/** Makes sure a main account has a row (the first sign-in creates it), holds its role if the settings fix it, and is active. */
async function ensureEnvAdmin(acc: EnvAccount): Promise<User> {
  const [u] = await db.select().from(users).where(eq(users.email, acc.email));
  if (!u) {
    await db
      .insert(users)
      .values({ name: acc.name, email: acc.email, role: acc.role, status: "approved", signupSource: "env" })
      .onConflictDoNothing();
    const [created] = await db.select().from(users).where(eq(users.email, acc.email));
    return created;
  }
  const fixedRole = acc.key === "support" || acc.key === "super";
  if ((fixedRole && u.role !== acc.role) || !u.isActive || u.status !== "approved") {
    const [fixed] = await db.update(users).set({ ...(fixedRole ? { role: acc.role, adminAreas: [] } : {}), isActive: true, status: "approved" }).where(eq(users.id, u.id)).returning();
    return fixed;
  }
  return u;
}

/**
 * Makes sure every main account that is set has a row, so the Support Admin can pick it (for example on the Approver Rules) before it has
 * ever signed in. Changes nothing for an account that already has a row.
 */
export async function ensureEnvAccounts(): Promise<void> {
  for (const acc of envAccounts()) {
    await db.insert(users).values({ name: acc.name, email: acc.email, role: acc.role, status: "approved", signupSource: "env" }).onConflictDoNothing();
  }
}

/** Returns the person if the email and password are right and the account may sign in; otherwise null. Never locks anyone out. */
export async function authenticate(emailRaw: string, password: string): Promise<User | null> {
  const email = emailRaw.trim().toLowerCase();
  if (!email || !password) return null;

  const env = envAccount(email);
  if (env) {
    if (!same(password, env.password)) return null;
    const me = await ensureEnvAdmin(env);
    await ensureEnvAccounts().catch((e) => console.error("[auth] could not create the other main accounts", e));
    return me;
  }

  const [u] = await db.select().from(users).where(eq(users.email, email));
  if (!u || !u.passwordHash || !u.isActive || u.status !== "approved") {
    await burnPasswordCheck(password);
    return null;
  }
  return (await verifyPassword(password, u.passwordHash)) ? u : null;
}

/** Checks a password for someone who is already signed in (unlocking Administrator, changing a password). */
export async function checkPassword(u: User, password: string): Promise<boolean> {
  const env = envAccount(u.email);
  if (env) return same(password, env.password);
  return !!u.passwordHash && verifyPassword(password, u.passwordHash);
}

export async function recordLogin(u: User, ip: string | null) {
  await Promise.all([
    db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, u.id)),
    db.insert(activityLog).values({ userId: u.id, action: "login", ipAddress: ip }),
  ]);
}
