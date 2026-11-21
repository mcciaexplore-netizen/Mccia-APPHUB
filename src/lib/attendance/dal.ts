import "server-only";
import { notFound, redirect } from "next/navigation";
import { attEnabled } from "./flags";
import { HostError, logError, needsOwnPassword, resolveAccess, type AttUser } from "./host-adapter";
import { StorageError } from "./storage";
import { isAdmin, isMember, isSuperAdmin } from "./att.manifest";

/**
 * Role protection for Attendance. Pages use require*(), which redirect; server actions and route handlers use assert*(), which throw an
 * HttpError. Off (ATT_ENABLED unset) looks like a page that does not exist; not signed in goes to the hub's sign-in; signed in without the
 * role goes back to where they belong (someone without the Attendance tile sees /attendance/no-access).
 *   member: anyone with the Attendance tile, HR and the Support Admin
 *   admin:  HR (App Admins of Attendance Admin) and the Support Admin
 */

export type SessionUser = AttUser & { member: boolean; admin: boolean; superAdmin: boolean };

const withFlags = (u: AttUser): SessionUser => ({ ...u, member: isMember(u.roles), admin: isAdmin(u.roles), superAdmin: isSuperAdmin(u.roles) });

type Section = "member" | "admin";
const allowed = (u: SessionUser, s: Section) => (s === "member" ? u.member : u.admin);

async function page(section: Section): Promise<SessionUser> {
  if (!attEnabled()) notFound();
  const a = await resolveAccess();
  if (a.status === "anonymous") redirect("/login");
  if (await needsOwnPassword()) redirect("/change-password");
  const u = withFlags(a.user);
  if (!allowed(u, section)) redirect(u.member ? "/attendance" : "/attendance/no-access");
  return u;
}

export const requireMember = () => page("member");
export const requireAdmin = () => page("admin");

/** For the "no access" page: who is signed in, without any role check. */
export async function requireSignedIn(): Promise<SessionUser> {
  if (!attEnabled()) notFound();
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
  member: "Attendance is for people given the Attendance application.",
  admin: "HR (Attendance Admin) only.",
};

async function assert(section: Section): Promise<SessionUser> {
  if (!attEnabled()) throw new HttpError(404, "Not found");
  const a = await resolveAccess();
  if (a.status === "anonymous") throw new HttpError(401, "Please sign in again.");
  if (await needsOwnPassword()) throw new HttpError(403, "Choose your own password first: you are still using the temporary one.");
  const u = withFlags(a.user);
  if (!allowed(u, section)) throw new HttpError(403, REFUSED[section]);
  return u;
}

export const assertMember = () => assert("member");
export const assertAdmin = () => assert("admin");

/** A problem the person can fix or should know about (shown as is). */
export class AttError extends Error {}

/** For server actions: what the page gets back. */
export type ActionResult<T = void> = { ok: true; data: T; message?: string } | { ok: false; error: string };

/** Runs an action body, turning a thrown error into a message the page can show. Unknown errors are logged, not shown. */
export async function run<T>(fn: () => Promise<T>, message?: string): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fn(), message };
  } catch (e) {
    if (e instanceof HttpError || e instanceof AttError || e instanceof HostError || e instanceof StorageError) return { ok: false, error: e.message };
    logError("[attendance] action failed", e);
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}
