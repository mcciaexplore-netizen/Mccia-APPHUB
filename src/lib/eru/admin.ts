import "server-only";
import { eq, sql } from "drizzle-orm";
import { db, rowsOf } from "./db";
import { domains, files, settings } from "@/db/eru-schema";
import { EruError, type SessionUser } from "./dal";
import { audit } from "./audit";
import { removeObjects } from "./storage";
import { can, DOMAIN_COLORS, DOMAIN_ICONS, isUuid } from "./eru.manifest";
import { removeFromTeam, setTeamRole } from "./host-adapter";

/** What ERU admins change: domains, general settings, the team; and the Support Admin's "Delete all data". */

export type DomainPatch = { name: string; description: string; color: string; icon: string; sortOrder: number; isActive: boolean };

export async function updateDomain(u: SessionUser, id: string, patch: DomainPatch): Promise<void> {
  if (!can.manageSettings(u.roles)) throw new EruError("ERU admins only.");
  if (!isUuid(id)) throw new EruError("That domain no longer exists.");
  const name = String(patch.name ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
  if (name.length < 2) throw new EruError("Give the domain a name.");
  const description = String(patch.description ?? "").replace(/\s+/g, " ").trim().slice(0, 400);
  if (!(DOMAIN_COLORS as readonly string[]).includes(patch.color)) throw new EruError("Choose a colour.");
  if (!(DOMAIN_ICONS as readonly string[]).includes(patch.icon)) throw new EruError("Choose an icon.");
  const sortOrder = Math.max(0, Math.min(999, Math.floor(Number(patch.sortOrder) || 0)));
  const [d] = await db
    .update(domains)
    .set({ name, description, color: patch.color, icon: patch.icon, sortOrder, isActive: !!patch.isActive })
    .where(eq(domains.id, id))
    .returning({ key: domains.key });
  if (!d) throw new EruError("That domain no longer exists.");
  await audit(null, u.id, "domain.update", { key: d.key, name, active: !!patch.isActive });
}

export async function saveGeneral(u: SessionUser, input: { trackChangesDefault: boolean }): Promise<void> {
  if (!can.manageSettings(u.roles)) throw new EruError("ERU admins only.");
  await db.update(settings).set({ trackChangesDefault: !!input.trackChangesDefault, updatedAt: new Date() }).where(eq(settings.id, 1));
  await audit(null, u.id, "settings.update", { trackChangesDefault: !!input.trackChangesDefault });
}

export async function setMemberRole(u: SessionUser, userId: string, role: "admin" | "member"): Promise<string> {
  if (!can.manageMembers(u.roles)) throw new EruError("ERU admins only.");
  if (!isUuid(userId)) throw new EruError("That person could not be found.");
  if (role !== "admin" && role !== "member") throw new EruError("Choose member or admin.");
  if (userId === u.id && role !== "admin") throw new EruError("You cannot take away your own admin role. Ask another ERU admin.");
  const { name } = await setTeamRole({ id: u.id, name: u.name }, userId, role);
  return name;
}

export async function removeMember(u: SessionUser, userId: string): Promise<string> {
  if (!can.manageMembers(u.roles)) throw new EruError("ERU admins only.");
  if (!isUuid(userId)) throw new EruError("That person could not be found.");
  if (userId === u.id) throw new EruError("You cannot remove yourself. Ask another ERU admin.");
  const { name } = await removeFromTeam({ id: u.id, name: u.name }, userId);
  return name;
}

/** Everything ERU holds: projects (with their documents, comments, change records and history), files, back to the five domains. */
export async function deleteAllData(u: SessionUser, confirm: string): Promise<{ projects: number }> {
  if (!can.deleteAllData(u.roles)) throw new EruError("The Support Admin only.");
  if (confirm !== "DELETE ALL ERU DATA") throw new EruError('Type DELETE ALL ERU DATA to confirm.');
  const keys = (await db.select({ key: files.storageKey }).from(files)).map((f) => f.key);
  const n = rowsOf<{ n: string }>(await db.execute(sql`select count(*) as n from eru_projects`))[0];
  await db.execute(sql`delete from eru_files`);
  await db.execute(sql`delete from eru_projects`);
  await db.execute(sql`delete from eru_audit_logs`);
  for (let i = 0; i < keys.length; i += 500) await removeObjects(keys.slice(i, i + 500));
  await audit(null, u.id, "data.delete_all", { projects: Number(n?.n ?? 0) });
  return { projects: Number(n?.n ?? 0) };
}
