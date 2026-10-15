import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { accessTemplateApps, accessTemplates, apps, branches, departments, teams, userAppAccess, users, type User } from "@/db/schema";
import type { DirectoryProps } from "@/components/people/PeopleDirectory";
import { domainsLabel } from "@/lib/domains";
import { getCatalog } from "@/lib/catalog";
import { listAudit } from "@/lib/audit";
import { getPerson, listPeople, parsePeopleFilters } from "@/lib/people";
import { canManageAccess, capabilities, isSuper } from "@/lib/rbac";

type SP = Record<string, string | string[] | undefined>;

/** The applications this person may hand out: all of them for the super administrator, only the ones they hold for a team manager. */
async function grantableCatalog(actor: Pick<User, "id" | "role">) {
  const catalog = await getCatalog();
  if (isSuper(actor)) return catalog;
  const own = new Set((await db.select({ appId: userAppAccess.appId }).from(userAppAccess).where(eq(userAppAccess.userId, actor.id))).map((r) => r.appId));
  const appsList = catalog.apps.filter((a) => own.has(a.id));
  const deps = new Set(appsList.map((a) => a.departmentId));
  return { departments: catalog.departments.filter((d) => deps.has(d.id)), apps: appsList };
}

const loadOptions = async () => {
  const [brs, deps, tms, appList] = await Promise.all([
    db.select({ id: branches.id, name: branches.name }).from(branches).orderBy(asc(branches.name)),
    db.select({ id: departments.id, name: departments.name }).from(departments).orderBy(asc(departments.sortOrder), asc(departments.name)),
    db.select({ id: teams.id, name: teams.name }).from(teams).orderBy(asc(teams.name)),
    db.select({ id: apps.id, name: apps.name }).from(apps).orderBy(asc(apps.name)),
  ]);
  return { branches: brs, departments: deps, teams: tms, apps: appList };
};

/** Who can be picked as a reporting manager: every active person. */
const loadManagers = () =>
  db.select({ id: users.id, name: users.name, email: users.email }).from(users).where(and(eq(users.isActive, true), eq(users.status, "approved"))).orderBy(asc(users.name)).limit(5000);

async function loadTemplates(allowed?: Set<string>) {
  const [list, rows] = await Promise.all([db.select().from(accessTemplates).orderBy(asc(accessTemplates.name)), db.select().from(accessTemplateApps)]);
  return list.map((t) => ({ id: t.id, name: t.name, appIds: rows.filter((x) => x.templateId === t.id && (!allowed || allowed.has(x.appId))).map((x) => x.appId) }));
}

/** Everything the directory screen needs, for the administrator (/administrator/users) or a team manager (/team). */
export async function loadDirectory(actor: User, sp: SP, base: string): Promise<DirectoryProps> {
  const filters = parsePeopleFilters(sp);
  const full = isSuper(actor);
  const [result, options, catalog, managers] = await Promise.all([
    listPeople(actor, filters),
    loadOptions(),
    grantableCatalog(actor),
    full ? loadManagers() : Promise.resolve([]),
  ]);
  const templates = await loadTemplates(full ? undefined : new Set(catalog.apps.map((a) => a.id)));
  return {
    base, result, filters, options: { ...options, managers }, catalog, templates, domains: domainsLabel(), meId: actor.id,
    caps: capabilities(actor),
  };
}

/** Everything the profile screen needs for one person, or null when this actor may not see them (the page then shows "not found"). */
export async function loadProfile(actor: User, id: string, base: string) {
  const person = await getPerson(actor, id);
  if (!person) return null;
  const full = isSuper(actor);
  const [options, managers, catalog, names, auditRows] = await Promise.all([
    loadOptions(),
    full ? loadManagers() : Promise.resolve([]),
    grantableCatalog(actor),
    db.select({ id: apps.id, name: apps.name }).from(apps),
    full ? listAudit({ page: 1, targetId: id }, 10) : Promise.resolve(null),
  ]);
  const templates = await loadTemplates(full ? undefined : new Set(catalog.apps.map((a) => a.id)));
  const inCatalog = new Set(catalog.apps.map((a) => a.id));
  const nameOf = new Map(names.map((a) => [a.id, a.name]));
  return {
    base, person, catalog, templates, meId: actor.id,
    options: { branches: options.branches, departments: options.departments, teams: options.teams, managers },
    caps: capabilities(actor),
    accessEditable: canManageAccess(actor, { id: person.id, role: person.role, teamId: person.teamId, reportingManagerId: person.managerId }),
    appNames: person.appIds.map((a) => nameOf.get(a) ?? "").filter(Boolean).sort(),
    otherApps: person.appIds.filter((a) => !inCatalog.has(a)).length,
    audit: auditRows ? auditRows.rows.map((r) => ({ id: r.id, at: r.at, actorName: r.actorName, action: r.action, details: r.details })) : null,
  };
}
