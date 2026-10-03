import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users, type User } from "@/db/schema";
import { userFingerprint } from "@/lib/auth";
import { ADMIN_COOKIE, SESSION_COOKIE, verify } from "@/lib/session";

/**
 * The person signed in on this request, or null. The cookie only names them; the account is re-read from the database
 * every time, so deactivating someone or changing their password takes effect immediately.
 */
export const getCurrentUser = cache(async (): Promise<User | null> => {
  const session = verify((await cookies()).get(SESSION_COOKIE)?.value, "session");
  if (!session) return null;
  const [u] = await db.select().from(users).where(eq(users.id, session.u));
  if (!u || !u.isActive || u.status !== "approved") return null;
  if (userFingerprint(u) !== session.f) return null;
  return u;
});

/** Administrator is unlocked only with a recent password check by this same person (see src/proxy.ts for the re-lock). */
async function adminUnlocked(u: User): Promise<boolean> {
  const unlock = verify((await cookies()).get(ADMIN_COOKIE)?.value, "admin");
  return !!unlock && unlock.u === u.id;
}

export async function requireUser(): Promise<User> {
  const u = await getCurrentUser();
  if (!u) redirect("/login");
  return u;
}

/** Head admin who has unlocked Administrator. */
export async function requireHeadAdmin(): Promise<User> {
  const u = await requireUser();
  if (u.role !== "head_admin") redirect("/");
  if (!(await adminUnlocked(u))) redirect("/unlock");
  return u;
}

/** Department leads may view their department's activity. */
export async function requireActivityViewer(): Promise<User> {
  const u = await requireUser();
  if (u.role === "member") redirect("/");
  return u;
}

/** For server actions: throw instead of redirecting so the client gets a clean error. Every admin action calls this. */
export async function assertHeadAdmin(): Promise<User> {
  const u = await getCurrentUser();
  if (!u || u.role !== "head_admin" || !(await adminUnlocked(u))) throw new Error("Not allowed");
  return u;
}
