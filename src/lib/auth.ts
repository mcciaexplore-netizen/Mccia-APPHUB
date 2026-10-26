import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { activityLog, users, type User } from "@/db/schema";
import { burnPasswordCheck, verifyPassword } from "@/lib/passwords";

const digest = (v: string) => createHash("sha256").update(v).digest();
const same = (a: string, b: string) => timingSafeEqual(digest(a), digest(b));

/**
 * The Support Admin, whose email, name and password live in the environment settings (SUPPORT_ADMIN_*, or the older HEAD_ADMIN_*), not in
 * the database: <PREFIX>_EMAIL, <PREFIX>_NAME and <PREFIX>_PASSWORD. It signs in with that password, so it can never be locked out, and
 * signing in puts its role back. It counts only when the email AND the password are both set. Both prefixes work at the same time, which
 * makes changing over safe. Everyone else is added in the app by the Support Admin.
 */
// Only the Support Admin is set in the environment; everyone else (the Super Admin, the HR and Expense Admins, Admins, users) is added in the app.
type EnvKey = "support";
type EnvAccount = { key: EnvKey; role: "head_admin"; email: string; password: string; name: string };
const ENV_DEFS: { key: EnvKey; role: EnvAccount["role"]; prefix: string; name: string }[] = [
  { key: "support", role: "head_admin", prefix: "SUPPORT_ADMIN", name: "Admin" },
  { key: "support", role: "head_admin", prefix: "HEAD_ADMIN", name: "Admin" },
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

/** True for the Support Admin account set in the environment (an email and a password both set): it signs in with that password. */
export const isEnvAdmin = (email: string) => !!envAccount(email);

/** Changes whenever the person's password changes, so older sign-ins stop working. */
export const userFingerprint = (u: Pick<User, "email" | "passwordHash">) =>
  createHash("sha256").update(isEnvAdmin(u.email) ? `env:${envAccount(u.email)?.password ?? ""}` : (u.passwordHash ?? "")).digest("base64url").slice(0, 12);

/** Whether the settings decide an account's role for good: the Support Admin account is that role by definition, so signing in puts it back. */
export const envRoleIsFixed = (email: string) => !!envAccount(email);

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
  if (u.role !== acc.role || !u.isActive || u.status !== "approved") {
    const [fixed] = await db.update(users).set({ role: acc.role, adminAreas: [], isActive: true, status: "approved" }).where(eq(users.id, u.id)).returning();
    return fixed;
  }
  return u;
}

/** Returns the person if the email and password are right and the account may sign in; otherwise null. Never locks anyone out. */
export async function authenticate(emailRaw: string, password: string): Promise<User | null> {
  const email = emailRaw.trim().toLowerCase();
  if (!email || !password) return null;

  const env = envAccount(email);
  if (env) {
    if (!same(password, env.password)) return null;
    return ensureEnvAdmin(env);
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
