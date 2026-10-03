import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { activityLog, users, type User } from "@/db/schema";
import { burnPasswordCheck, verifyPassword } from "@/lib/passwords";

const adminEmail = () => process.env.HEAD_ADMIN_EMAIL?.trim().toLowerCase() || null;
const digest = (v: string) => createHash("sha256").update(v).digest();
const same = (a: string, b: string) => timingSafeEqual(digest(a), digest(b));

/** The main admin (HEAD_ADMIN_EMAIL) signs in with HEAD_ADMIN_PASSWORD from the environment, not a stored password. */
export const isEnvAdmin = (email: string) => !!adminEmail() && email.trim().toLowerCase() === adminEmail();

/** Changes whenever the person's password changes, so older sign-ins stop working. */
export const userFingerprint = (u: Pick<User, "email" | "passwordHash">) =>
  createHash("sha256").update(isEnvAdmin(u.email) ? `env:${process.env.HEAD_ADMIN_PASSWORD ?? ""}` : (u.passwordHash ?? "")).digest("base64url").slice(0, 12);

/** Makes sure the main admin has a row (the first sign-in creates it) and is an active head admin. */
async function ensureEnvAdmin(email: string): Promise<User> {
  const [u] = await db.select().from(users).where(eq(users.email, email));
  if (!u) {
    await db
      .insert(users)
      .values({ name: process.env.HEAD_ADMIN_NAME?.trim() || "Admin", email, role: "head_admin", status: "approved", signupSource: "env" })
      .onConflictDoNothing();
    const [created] = await db.select().from(users).where(eq(users.email, email));
    return created;
  }
  if (u.role !== "head_admin" || !u.isActive || u.status !== "approved") {
    const [fixed] = await db.update(users).set({ role: "head_admin", isActive: true, status: "approved" }).where(eq(users.id, u.id)).returning();
    return fixed;
  }
  return u;
}

/** Returns the person if the email and password are right and the account may sign in; otherwise null. Never locks anyone out. */
export async function authenticate(emailRaw: string, password: string): Promise<User | null> {
  const email = emailRaw.trim().toLowerCase();
  if (!email || !password) return null;

  if (isEnvAdmin(email)) {
    const envPassword = process.env.HEAD_ADMIN_PASSWORD;
    if (!envPassword || !same(password, envPassword)) return null;
    return ensureEnvAdmin(email);
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
  if (isEnvAdmin(u.email)) {
    const envPassword = process.env.HEAD_ADMIN_PASSWORD;
    return !!envPassword && same(password, envPassword);
  }
  return !!u.passwordHash && verifyPassword(password, u.passwordHash);
}

export async function recordLogin(u: User, ip: string | null) {
  await Promise.all([
    db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, u.id)),
    db.insert(activityLog).values({ userId: u.id, action: "login", ipAddress: ip }),
  ]);
}
