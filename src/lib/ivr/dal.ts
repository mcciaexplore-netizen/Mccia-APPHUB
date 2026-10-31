import "server-only";
import { notFound, redirect } from "next/navigation";
import type { Role } from "@/db/ivr-schema";
import { ivrEnabled } from "./flags";
import { hasAnyRole, needsOwnPassword, resolveAccess } from "./host-adapter";
import { SECTION_ROLES, type IvrRole } from "./ivr.manifest";

/**
 * Role protection for the IVR-CRM module. Pages use require*(), which redirect; route handlers and server actions use assert*(), which
 * throw an HttpError. Off (IVR_ENABLED unset) looks like a page that does not exist; not signed in goes to the hub's sign-in; signed in
 * without the role goes back to where they belong (each section is a separate application in the hub).
 */

export type SessionUser = { id: string; name: string; email: string; role: Role; roles: IvrRole[] };

export const isAdminRole = (r: Role) => r === "admin" || r === "super_admin";

/** The signed-in person with their IVR-CRM role, or null when they hold none (or are not signed in). */
export async function getUser(): Promise<SessionUser | null> {
  if (!ivrEnabled()) return null;
  const a = await resolveAccess();
  if (a.status !== "ok" || !a.user.role) return null;
  return { id: a.user.id, name: a.user.name, email: a.user.email, role: a.user.role, roles: a.user.roles };
}

async function page(section: "agent" | "admin" | "super"): Promise<SessionUser> {
  if (!ivrEnabled()) notFound();
  const a = await resolveAccess();
  if (a.status === "anonymous") redirect("/login");
  if (await needsOwnPassword()) redirect("/change-password");
  const u = a.user;
  const isAdmin = hasAnyRole(u, SECTION_ROLES.admin);
  const allowed = section === "agent" ? hasAnyRole(u, SECTION_ROLES.agent) : section === "admin" ? isAdmin : u.roles.includes("ivr_super_admin");
  if (!allowed) redirect(section === "super" && isAdmin ? "/ivr/admin" : section === "admin" && hasAnyRole(u, SECTION_ROLES.agent) ? "/ivr" : section === "agent" && isAdmin ? "/ivr/admin" : "/");
  // In the agents' section everyone acts as an agent, admins included: every list there is their own members and their own calls only.
  return { id: u.id, name: u.name, email: u.email, role: section === "agent" ? "agent" : u.role!, roles: u.roles };
}

/** Pages of the agents' section (/ivr): needs ivr_agent. The person comes back acting as an agent (role "agent"), whatever else they hold. */
export const requireUser = () => page("agent");
/** Pages of the admin section (/ivr/admin): needs ivr_admin or ivr_super_admin. */
export const requireAdmin = () => page("admin");
/** Integrations: the Support Admin only. */
export const requireSuperAdmin = () => page("super");

/** For route handlers and server actions: throws instead of redirecting. */
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Anyone holding an IVR-CRM role. Which members and calls they reach is checked by each action (agents: only their own). */
export async function assertUser(): Promise<SessionUser> {
  if (!ivrEnabled()) throw new HttpError(404, "Not found");
  const a = await resolveAccess();
  if (a.status === "anonymous") throw new HttpError(401, "Not signed in");
  if (await needsOwnPassword()) throw new HttpError(403, "Choose your own password first: you are still using the temporary one.");
  if (!a.user.role) throw new HttpError(403, "You do not have IVR-CRM.");
  return { id: a.user.id, name: a.user.name, email: a.user.email, role: a.user.role, roles: a.user.roles };
}
export async function assertAdmin(): Promise<SessionUser> {
  const u = await assertUser();
  if (!isAdminRole(u.role)) throw new HttpError(403, "IVR admins only");
  return u;
}
export async function assertSuperAdmin(): Promise<SessionUser> {
  const u = await assertUser();
  if (u.role !== "super_admin") throw new HttpError(403, "The Support Admin only");
  return u;
}
