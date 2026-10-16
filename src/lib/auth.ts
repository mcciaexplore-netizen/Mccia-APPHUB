import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { activityLog, users, type User } from "@/db/schema";
import { burnPasswordCheck, verifyPassword } from "@/lib/passwords";

const digest = (v: string) => createHash("sha256").update(v).digest();
const same = (a: string, b: string) => timingSafeEqual(digest(a), digest(b));

/**
 * The accounts whose email and password live in the environment settings, not in the database: the Support Admin (HEAD_ADMIN_*) and,
 * when set, the Super Admin (SUPER_ADMIN_*). They sign in with the password from the settings, so changing it there (and redeploying)
 * changes it, and neither can be locked out from the screens. One address cannot be both: the Support Admin wins.
 */
type EnvAccount = { role: "head_admin" | "super_admin"; email: string; password: string | undefined; name: string };
const lower = (v: string | undefined) => v?.trim().toLowerCase() || "";

function envAccounts(): EnvAccount[] {
  const head: EnvAccount = { role: "head_admin", email: lower(process.env.HEAD_ADMIN_EMAIL), password: process.env.HEAD_ADMIN_PASSWORD, name: process.env.HEAD_ADMIN_NAME?.trim() || "Admin" };
  const sup: EnvAccount = { role: "super_admin", email: lower(process.env.SUPER_ADMIN_EMAIL), password: process.env.SUPER_ADMIN_PASSWORD, name: process.env.SUPER_ADMIN_NAME?.trim() || "Super Admin" };
  return [head, sup].filter((a, i, all) => a.email && all.findIndex((b) => b.email === a.email) === i);
}
const envAccount = (email: string): EnvAccount | null => envAccounts().find((a) => a.email === email.trim().toLowerCase()) ?? null;

/** True for an account that signs in with a password from the environment (the Support Admin, and the Super Admin when SUPER_ADMIN_EMAIL is set). */
export const isEnvAdmin = (email: string) => !!envAccount(email);

/** Changes whenever the person's password changes, so older sign-ins stop working. */
export const userFingerprint = (u: Pick<User, "email" | "passwordHash">) =>
  createHash("sha256").update(isEnvAdmin(u.email) ? `env:${envAccount(u.email)?.password ?? ""}` : (u.passwordHash ?? "")).digest("base64url").slice(0, 12);

/** Makes sure an environment account has a row (the first sign-in creates it), holds its role, and is active. */
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
    const [fixed] = await db.update(users).set({ role: acc.role, isActive: true, status: "approved" }).where(eq(users.id, u.id)).returning();
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
    if (!env.password || !same(password, env.password)) return null;
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
  if (env) return !!env.password && same(password, env.password);
  return !!u.passwordHash && verifyPassword(password, u.passwordHash);
}

export async function recordLogin(u: User, ip: string | null) {
  await Promise.all([
    db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, u.id)),
    db.insert(activityLog).values({ userId: u.id, action: "login", ipAddress: ip }),
  ]);
}
