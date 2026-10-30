import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { appAdmins, apps, users, type User } from "@/db/schema";
import { writeAudit } from "@/lib/audit";
import { isSuper } from "@/lib/rbac";
import { UserError } from "@/lib/user-error";

/**
 * App Admins: who is an admin of each application (the "App Admins" section of its Edit form). Only the Support Admin changes them.
 * Being an App Admin does not give access: the person still needs the application itself to open it. What it means is up to the
 * application: role "admin" in the single sign-on token, or Inventory admin for the Inventory module.
 */

/** Every application's App Admins: app id → their user ids. */
export async function appAdminsByApp(): Promise<Map<string, string[]>> {
  const rows = await db.select({ appId: appAdmins.appId, userId: appAdmins.userId }).from(appAdmins);
  const out = new Map<string, string[]>();
  for (const r of rows) out.set(r.appId, [...(out.get(r.appId) ?? []), r.userId]);
  return out;
}

/**
 * Makes `userIds` exactly the App Admins of one application, in ONE statement (the ones left out are removed, the new ones added).
 * Support Admin only; every person must be an active hub user. Recorded in the audit log as app.admins, with who was added and removed.
 */
export async function setAppAdmins(actor: Pick<User, "id" | "name" | "role">, appId: string, userIds: string[]) {
  if (!isSuper(actor)) throw new UserError("Only the Support Admin can change an application's admins.");
  const ids = [...new Set(userIds)];
  const [[app], people] = await Promise.all([
    db.select({ name: apps.name }).from(apps).where(eq(apps.id, appId)),
    ids.length ? db.select({ id: users.id, name: users.name }).from(users).where(and(inArray(users.id, ids), eq(users.isActive, true))) : Promise.resolve([]),
  ]);
  if (!app) throw new UserError("That application no longer exists. Reload and try again.");
  if (people.length !== ids.length) throw new UserError("Someone on the list is no longer an active user. Reload and try again.");
  const list = ids.length ? sql`array[${sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `)}]` : sql`array[]::uuid[]`;
  const res = (await db.execute(sql`
    with removed as (
      delete from app_admins where app_id = ${appId} and not (user_id = any(${list})) returning user_id
    ), added as (
      insert into app_admins (app_id, user_id, added_by_id) select ${appId}, u, ${actor.id} from unnest(${list}) as u
      on conflict (app_id, user_id) do nothing returning user_id
    )
    select (select coalesce(array_agg(u.name order by u.name), '{}') from removed r join users u on u.id = r.user_id) as removed,
      (select coalesce(array_agg(u.name order by u.name), '{}') from added a join users u on u.id = a.user_id) as added`)) as unknown as { rows: { removed: string[] | string; added: string[] | string }[] };
  // node-postgres returns text[] as an array; read a literal "{a,b}" too, in case a driver hands it back as text.
  const names = (v: string[] | string) => (Array.isArray(v) ? v : v.replace(/^\{|\}$/g, "").split(",").filter(Boolean).map((x) => x.replace(/^"|"$/g, "")));
  const added = names(res.rows[0].added), removed = names(res.rows[0].removed);
  if (added.length || removed.length) await writeAudit(actor, [{ action: "app.admins", targetType: "app", targetId: appId, targetLabel: app.name, details: { added, removed } }]);
  return { added, removed };
}
