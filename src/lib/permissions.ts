import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users, type User } from "@/db/schema";
import { userFingerprint } from "@/lib/auth";
import { canAdminister, hasArea, isSuper, isTeamManager, type AdminArea } from "@/lib/rbac";
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

/**
 * The signed-in person, or off to sign in. Someone still on a temporary password (sent by email) is sent to choose their own first;
 * the change-password page itself passes `{ allowTemporary: true }`.
 */
export async function requireUser(opts: { allowTemporary?: boolean } = {}): Promise<User> {
  const u = await getCurrentUser();
  if (!u) redirect("/login");
  if (u.mustChangePassword && !opts.allowTemporary) redirect("/change-password");
  return u;
}

/** The Support Admin or the Super Admin, who has unlocked Administrator. For what only the two top roles may open. */
export async function requireHeadAdmin(): Promise<User> {
  const u = await requireUser();
  if (!isSuper(u)) redirect("/");
  if (!(await adminUnlocked(u))) redirect("/unlock");
  return u;
}

/** Anyone who may open Administrator at all (a top role, or an Admin with at least one area), who has unlocked it. */
export async function requireAdministrator(): Promise<User> {
  const u = await requireUser();
  if (!canAdminister(u)) redirect("/");
  if (!(await adminUnlocked(u))) redirect("/unlock");
  return u;
}

/** One area of Administrator: the two top roles always, an Admin only when it is switched on for them. Anyone else goes back to where they may be. */
export async function requireArea(area: AdminArea): Promise<User> {
  const u = await requireAdministrator();
  if (!hasArea(u, area)) redirect("/administrator");
  return u;
}

/** Department leads may view their department's activity; so may an Admin who has been given the Activity log. */
export async function requireActivityViewer(): Promise<User> {
  const u = await requireUser();
  if (!(isSuper(u) || isTeamManager(u) || hasArea(u, "activity"))) redirect("/");
  return u;
}

/** For server actions: throw instead of redirecting so the client gets a clean error. Every admin action calls this. */
export async function assertHeadAdmin(): Promise<User> {
  const u = await getCurrentUser();
  if (!u || !isSuper(u) || !(await adminUnlocked(u))) throw new Error("Not allowed");
  return u;
}

/** The same for one area of Administrator (see requireArea). */
export async function assertArea(area: AdminArea): Promise<User> {
  const u = await getCurrentUser();
  if (!u || !hasArea(u, area) || !(await adminUnlocked(u))) throw new Error("Not allowed");
  return u;
}

/**
 * For actions open to team managers as well as the administrators: a top role or an Admin with Users & access must have unlocked
 * Administrator; a team manager needs nothing more.
 */
export async function assertStaff(): Promise<User> {
  const u = await getCurrentUser();
  if (!u) throw new Error("Not allowed");
  if (isSuper(u) || hasArea(u, "people")) {
    if (!(await adminUnlocked(u))) throw new Error("Not allowed");
    return u;
  }
  if (isTeamManager(u)) return u;
  throw new Error("Not allowed");
}

/** Pages for team managers (the administrators use Administrator instead). */
export async function requireTeamManager(): Promise<User> {
  const u = await requireUser();
  if (!isTeamManager(u)) redirect("/");
  return u;
}
