import "server-only";
import { cache } from "react";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { users, type User } from "@/db/schema";

/**
 * The hub has no sign-in: everyone who opens it acts as the head admin (the one named by HEAD_ADMIN_EMAIL when set,
 * otherwise the first active head admin). Anyone who can reach the site can therefore do everything.
 */
export const getCurrentUser = cache(async (): Promise<User | null> => {
  const email = process.env.HEAD_ADMIN_EMAIL?.trim().toLowerCase();
  const [u] = await db
    .select()
    .from(users)
    .where(and(eq(users.role, "head_admin"), eq(users.isActive, true), email ? eq(users.email, email) : undefined))
    .limit(1);
  return u ?? null;
});

export async function requireUser(): Promise<User> {
  const u = await getCurrentUser();
  if (!u) throw new Error("No active head admin exists. Run the seed script (npm run db:seed) with HEAD_ADMIN_EMAIL set.");
  return u;
}

/** Everyone is the head admin, so these simply return that user. They stay as named gates for the admin pages. */
export async function requireHeadAdmin(): Promise<User> {
  return requireUser();
}

export async function requireActivityViewer(): Promise<User> {
  return requireUser();
}

/** For server actions: throw so the client gets a clean error. */
export async function assertHeadAdmin(): Promise<User> {
  const u = await getCurrentUser();
  if (!u) throw new Error("Not allowed");
  return u;
}
