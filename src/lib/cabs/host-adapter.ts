import "server-only";
import { cache } from "react";
import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { branches, users } from "@/db/schema";
import { getCurrentUser as hostCurrentUser } from "@/lib/permissions";
import { CABS_ADMIN_URL_PATTERN, CABS_USER_URL_PATTERN, cabRolesFor, type CabRole } from "./cabs.manifest";

/**
 * The only file in the Cab Booking module that knows about the host: its session, its users and its application access. Everything else
 * asks here, the same way Inventory does (src/lib/inventory/host-adapter.ts).
 */

export type { CabRole };
/** `driverId`: their row in cab_drivers when they are a driver. `branchName`: their branch in the hub, copied onto the rides they book. */
export type CabUser = { id: string; name: string; email: string; roles: CabRole[]; hubRole: string; branchName: string | null; driverId: string | null };
export type Access = { status: "anonymous" } | { status: "ok"; user: CabUser };

type Standing = { userAccess: boolean; adminAppAdmin: boolean; driverId: string | null };

/**
 * One query: whether the person has been given the MCCIA Cabs application (URL /cabs), whether they are an App Admin of the Cabs Admin
 * application (URL /cabs/admin) and have been given it (being an App Admin does not give access, as everywhere in the hub), and the
 * driver row with their email (drivers are not tied to hub accounts otherwise). Only active applications in active categories count.
 */
async function cabsStanding(userId: string, email: string): Promise<Standing> {
  const res = (await db.execute(sql`
    select coalesce(bool_or(a.url ~ ${CABS_USER_URL_PATTERN} and ua.user_id is not null), false) as user_access,
      coalesce(bool_or(a.url ~ ${CABS_ADMIN_URL_PATTERN} and ua.user_id is not null and ad.user_id is not null), false) as admin_app_admin,
      (select id from cab_drivers where email = ${email.trim().toLowerCase()}) as driver_id
    from apps a
    join departments d on d.id = a.department_id
    left join user_app_access ua on ua.app_id = a.id and ua.user_id = ${userId}
    left join app_admins ad on ad.app_id = a.id and ad.user_id = ${userId}
    where a.is_active and d.is_active and (a.url ~ ${CABS_USER_URL_PATTERN} or a.url ~ ${CABS_ADMIN_URL_PATTERN})`)) as unknown as {
    rows: { user_access: boolean; admin_app_admin: boolean; driver_id: string | null }[];
  };
  const r = res.rows[0];
  return { userAccess: !!r?.user_access, adminAppAdmin: !!r?.admin_app_admin, driverId: r?.driver_id ?? null };
}

/** Who is asking and their roles here (see cabs.manifest.ts). Someone signed in with no role at all is still "ok", with no roles. */
export const resolveAccess = cache(async (): Promise<Access> => {
  const host = await hostCurrentUser();
  if (!host) return { status: "anonymous" };
  const [standing, [branch]] = await Promise.all([
    cabsStanding(host.id, host.email),
    host.branchId ? db.select({ name: branches.name }).from(branches).where(eq(branches.id, host.branchId)) : Promise.resolve([]),
  ]);
  const roles = cabRolesFor({ hubRole: host.role, userAccess: standing.userAccess, adminAppAdmin: standing.adminAppAdmin, isDriver: !!standing.driverId });
  return { status: "ok", user: { id: host.id, name: host.name, email: host.email, roles, hubRole: host.role, branchName: branch?.name ?? null, driverId: standing.driverId } };
});

/** Whether the person is still on the temporary password they were emailed: they must choose their own before using the module. */
export const needsOwnPassword = async () => !!(await hostCurrentUser())?.mustChangePassword;

export const hasRole = (user: Pick<CabUser, "roles"> | null | undefined, role: CabRole) => !!user && user.roles.includes(role);
export const hasAnyRole = (user: Pick<CabUser, "roles"> | null | undefined, roles: readonly CabRole[]) => !!user && roles.some((r) => user.roles.includes(r));

export type HubPerson = { id: string; name: string; email: string; phone: string | null };

/** Everyone who can sign in to the hub (active and approved): "Add driver" can fill in a driver's details from one of them. */
export async function listHubUsers(): Promise<HubPerson[]> {
  return db.select({ id: users.id, name: users.name, email: users.email, phone: users.phone }).from(users).where(and(eq(users.isActive, true), eq(users.status, "approved"))).orderBy(asc(users.name));
}

/** The active hub account with this email, if there is one: where a driver's bell notifications go (they also get the email). */
export async function hubUserIdByEmail(email: string): Promise<string | null> {
  const [u] = await db.select({ id: users.id }).from(users).where(and(sql`lower(${users.email}) = ${email.trim().toLowerCase()}`, eq(users.isActive, true)));
  return u?.id ?? null;
}

/** The hub's branch names, for the admin's rides filter. */
export async function listBranchNames(): Promise<string[]> {
  return (await db.select({ name: branches.name }).from(branches).orderBy(asc(branches.name))).map((b) => b.name);
}
