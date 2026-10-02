import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { auth, testLoginEnabled } from "@/lib/auth";
import { db } from "@/db";
import { users, type User } from "@/db/schema";

/** Current user, re-read from the DB on every request so deactivation and role changes are immediate. */
export const getCurrentUser = cache(async (): Promise<User | null> => {
  // No sign-in: everyone acts as the head admin. Off unless OPEN_ACCESS=true is set (any environment), or locally
  // when NODE_ENV=development and DEV_AUTH_BYPASS=true. Anyone who can reach the site can do everything while it is on.
  if (process.env.OPEN_ACCESS === "true" || (process.env.NODE_ENV === "development" && process.env.DEV_AUTH_BYPASS === "true")) {
    const email = process.env.HEAD_ADMIN_EMAIL?.trim().toLowerCase();
    const [u] = await db
      .select()
      .from(users)
      .where(and(eq(users.role, "head_admin"), eq(users.isActive, true), email ? eq(users.email, email) : undefined))
      .limit(1);
    return u ? { ...u, mustChangePassword: false, status: "approved" } : null;
  }
  const session = await auth();
  const su = session?.user as { id?: string; test?: boolean } | undefined;
  if (!su?.id) return null;
  const [u] = await db.select().from(users).where(eq(users.id, su.id));
  // Only accepted, active people may use the hub (rejected or pending accounts are signed out).
  if (!u || !u.isActive || u.status !== "approved") return null;
  // The env test login is explicit and opt-in, so it is exempt from the first-login password change.
  return su.test && testLoginEnabled() ? { ...u, mustChangePassword: false } : u;
});

/** Signed in, but may still owe a first-login password change. Only the change-password flow uses this directly. */
export async function requireSessionUser(): Promise<User> {
  const u = await getCurrentUser();
  if (!u) redirect("/login");
  return u;
}

/** Signed in and past the forced password change. Use this for every page and route. */
export async function requireUser(): Promise<User> {
  const u = await requireSessionUser();
  if (u.mustChangePassword) redirect("/change-password");
  return u;
}

export async function requireHeadAdmin(): Promise<User> {
  const u = await requireUser();
  if (u.role !== "head_admin") redirect("/");
  return u;
}

/** Head admins and dept leads may view activity. */
export async function requireActivityViewer(): Promise<User> {
  const u = await requireUser();
  if (u.role === "member") redirect("/");
  return u;
}

/** For server actions: throw instead of redirecting so the client gets a clean error. */
export async function assertHeadAdmin(): Promise<User> {
  const u = await getCurrentUser();
  if (!u || u.mustChangePassword || u.status !== "approved" || u.role !== "head_admin") throw new Error("Not allowed");
  return u;
}
