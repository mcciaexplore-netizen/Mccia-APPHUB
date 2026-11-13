import "server-only";
import { notFound, redirect } from "next/navigation";
import { eruEnabled } from "./flags";
import { logError, MembershipError, needsOwnPassword, resolveAccess, type EruUser } from "./host-adapter";
import { isAdmin, isMember, isSuperAdmin } from "./eru.manifest";

/**
 * Role protection for ERU. Pages use require*(), which redirect; server actions and route handlers use assert*(), which throw an HttpError.
 * Off (ERU_ENABLED unset) looks like a page that does not exist; not signed in goes to the hub's sign-in; signed in without the role goes
 * back to where they belong (someone given ERU but on neither of its lists sees /eru/no-access).
 *   member: the ERU team: App Staff (eru_member), App Admins (eru_admin) and the Support Admin
 *   admin:  the admins only (project management, reviewing tracked changes, members, settings)
 *   super:  the Support Admin only (delete all data)
 */

export type SessionUser = EruUser & { member: boolean; admin: boolean; superAdmin: boolean };

const withFlags = (u: EruUser): SessionUser => ({ ...u, member: isMember(u.roles), admin: isAdmin(u.roles), superAdmin: isSuperAdmin(u.roles) });

type Section = "member" | "admin" | "super";

const allowed = (u: SessionUser, s: Section) => (s === "member" ? u.member : s === "admin" ? u.admin : u.superAdmin);

async function page(section: Section): Promise<SessionUser> {
  if (!eruEnabled()) notFound();
  const a = await resolveAccess();
  if (a.status === "anonymous") redirect("/login");
  if (await needsOwnPassword()) redirect("/change-password");
  const u = withFlags(a.user);
  if (!allowed(u, section)) redirect(u.member ? "/eru" : "/eru/no-access");
  return u;
}

export const requireMember = () => page("member");
export const requireAdmin = () => page("admin");

/** For the "not on the team" page: who is signed in, without any role check. */
export async function requireSignedIn(): Promise<SessionUser> {
  if (!eruEnabled()) notFound();
  const a = await resolveAccess();
  if (a.status === "anonymous") redirect("/login");
  return withFlags(a.user);
}

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

const REFUSED: Record<Section, string> = {
  member: "ERU is for the Economic Research Unit's team only.",
  admin: "ERU admins only.",
  super: "The Support Admin only.",
};

async function assert(section: Section): Promise<SessionUser> {
  if (!eruEnabled()) throw new HttpError(404, "Not found");
  const a = await resolveAccess();
  if (a.status === "anonymous") throw new HttpError(401, "Please sign in again.");
  if (await needsOwnPassword()) throw new HttpError(403, "Choose your own password first: you are still using the temporary one.");
  const u = withFlags(a.user);
  if (!allowed(u, section)) throw new HttpError(403, REFUSED[section]);
  return u;
}

export const assertMember = () => assert("member");
export const assertAdmin = () => assert("admin");
export const assertSuperAdmin = () => assert("super");

/** A problem the person can fix or should know about (shown as is). */
export class EruError extends Error {}

/** For server actions: what the page gets back. */
export type ActionResult<T = void> = { ok: true; data: T; message?: string } | { ok: false; error: string };

/** Runs an action body, turning a thrown error into a message the page can show. Unknown errors are logged, not shown. */
export async function run<T>(fn: () => Promise<T>, message?: string): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fn(), message };
  } catch (e) {
    if (e instanceof HttpError || e instanceof EruError || e instanceof MembershipError) return { ok: false, error: e.message };
    logError("[eru] action failed", e);
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}
