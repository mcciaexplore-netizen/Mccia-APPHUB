import "server-only";
import { notFound, redirect } from "next/navigation";
import { logError } from "@/lib/log-error";
import { designEnabled } from "./flags";
import { needsOwnPassword, resolveAccess, type DesignUser } from "./host-adapter";
import { isLead, isMember } from "./design.manifest";

/**
 * Role protection for DesignDesk. Pages use require*(), which redirect; server actions and route handlers use assert*(), which throw an
 * HttpError. Off (DESIGN_ENABLED unset) looks like a page that does not exist; not signed in goes to the hub's sign-in; signed in without
 * the role goes back to where they belong.
 *   requester: any signed-in hub user (the request pages)
 *   team:      Design Team (design_member), or a lead (who may open any ticket page; their own lists still show only their own tickets)
 *   admin:     Design Team Admin (design_lead) or the Support Admin
 *   super:     the Support Admin only
 */

export type SessionUser = DesignUser & { lead: boolean; member: boolean; superAdmin: boolean };

const withFlags = (u: DesignUser): SessionUser => ({ ...u, lead: isLead(u.roles), member: isMember(u.roles), superAdmin: u.roles.includes("design_super_admin") });

type Section = "requester" | "team" | "admin" | "super";

async function page(section: Section): Promise<SessionUser> {
  if (!designEnabled()) notFound();
  const a = await resolveAccess();
  if (a.status === "anonymous") redirect("/login");
  if (await needsOwnPassword()) redirect("/change-password");
  const u = withFlags(a.user);
  const allowed = section === "requester" || (section === "team" ? u.member || u.lead : section === "admin" ? u.lead : u.superAdmin);
  if (!allowed) redirect(section === "super" && u.lead ? "/design/admin" : section === "admin" && u.member ? "/design" : "/design/request");
  return u;
}

export const requireRequester = () => page("requester");
export const requireTeam = () => page("team");
export const requireLead = () => page("admin");
export const requireSuperAdmin = () => page("super");

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function assert(section: Section): Promise<SessionUser> {
  if (!designEnabled()) throw new HttpError(404, "Not found");
  const a = await resolveAccess();
  if (a.status === "anonymous") throw new HttpError(401, "Please sign in again.");
  if (await needsOwnPassword()) throw new HttpError(403, "Choose your own password first: you are still using the temporary one.");
  const u = withFlags(a.user);
  if (section === "team" && !(u.member || u.lead)) throw new HttpError(403, "You do not have Design Team.");
  if (section === "admin" && !u.lead) throw new HttpError(403, "Design leads only.");
  if (section === "super" && !u.superAdmin) throw new HttpError(403, "The Support Admin only.");
  return u;
}

export const assertRequester = () => assert("requester");
export const assertTeam = () => assert("team");
export const assertLead = () => assert("admin");
export const assertSuperAdmin = () => assert("super");

/** For server actions: what the page gets back. */
export type ActionResult<T = void> = { ok: true; data: T; message?: string } | { ok: false; error: string };

/** Runs an action body, turning a thrown error into a message the page can show. Unknown errors are logged, not shown. */
export async function run<T>(fn: () => Promise<T>, message?: string): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fn(), message };
  } catch (e) {
    if (e instanceof HttpError || e instanceof DesignError) return { ok: false, error: e.message };
    logError("[design] action failed", e);
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}

/** A problem the person can fix or should know about (shown as is). */
export class DesignError extends Error {}
