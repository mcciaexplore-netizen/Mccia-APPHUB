import "server-only";
import { notFound, redirect } from "next/navigation";
import { aistudioEnabled } from "./flags";
import { logError, needsOwnPassword, resolveAccess, type AiUser } from "./host-adapter";
import { isLead, isMember, isRequester } from "./aistudio.manifest";

/**
 * Role protection for AI Studio. Pages use require*(), which redirect; server actions and route handlers use assert*(), which throw an
 * HttpError. Off (AISTUDIO_ENABLED unset) looks like a page that does not exist; not signed in goes to the hub's sign-in; signed in without
 * the role goes back to where they belong.
 *   requester: AI Studio (aistudio_requester), or anyone in the AI Studio team
 *   team:      the AI Studio team: App Staff (aistudio_member), App Admins (aistudio_lead) and the Support Admin
 *   lead:      the leads only (accept/decline, assign, delete, settings)
 *   super:     the Support Admin only (delete all data)
 */

export type SessionUser = AiUser & { requester: boolean; member: boolean; lead: boolean; superAdmin: boolean };

const withFlags = (u: AiUser): SessionUser => ({ ...u, requester: isRequester(u.roles), member: isMember(u.roles), lead: isLead(u.roles), superAdmin: u.roles.includes("aistudio_super_admin") });

type Section = "requester" | "team" | "lead" | "super";

const allowed = (u: SessionUser, s: Section) => (s === "requester" ? u.requester : s === "team" ? u.member : s === "lead" ? u.lead : u.superAdmin);

async function page(section: Section): Promise<SessionUser> {
  if (!aistudioEnabled()) notFound();
  const a = await resolveAccess();
  if (a.status === "anonymous") redirect("/login");
  if (await needsOwnPassword()) redirect("/change-password");
  const u = withFlags(a.user);
  if (!allowed(u, section)) redirect(u.member ? "/aistudio/admin" : u.requester ? "/aistudio/request" : "/");
  return u;
}

export const requireRequester = () => page("requester");
export const requireTeam = () => page("team");
export const requireLead = () => page("lead");
export const requireSuperAdmin = () => page("super");

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

const REFUSED: Record<Section, string> = {
  requester: "You do not have AI Studio.",
  team: "AI Studio Admin is for its App Staff and App Admins only.",
  lead: "AI Studio leads (App Admins of AI Studio Admin) only.",
  super: "The Support Admin only.",
};

async function assert(section: Section): Promise<SessionUser> {
  if (!aistudioEnabled()) throw new HttpError(404, "Not found");
  const a = await resolveAccess();
  if (a.status === "anonymous") throw new HttpError(401, "Please sign in again.");
  if (await needsOwnPassword()) throw new HttpError(403, "Choose your own password first: you are still using the temporary one.");
  const u = withFlags(a.user);
  if (!allowed(u, section)) throw new HttpError(403, REFUSED[section]);
  return u;
}

export const assertRequester = () => assert("requester");
export const assertTeam = () => assert("team");
export const assertLead = () => assert("lead");
export const assertSuperAdmin = () => assert("super");

/** A problem the person can fix or should know about (shown as is). */
export class AiStudioError extends Error {}

/** For server actions: what the page gets back. */
export type ActionResult<T = void> = { ok: true; data: T; message?: string } | { ok: false; error: string };

/** Runs an action body, turning a thrown error into a message the page can show. Unknown errors are logged, not shown. */
export async function run<T>(fn: () => Promise<T>, message?: string): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fn(), message };
  } catch (e) {
    if (e instanceof HttpError || e instanceof AiStudioError) return { ok: false, error: e.message };
    logError("[aistudio] action failed", e);
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}
