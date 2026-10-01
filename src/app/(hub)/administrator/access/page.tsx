import { asc, count, ne } from "drizzle-orm";
import { db } from "@/db";
import { accessTemplateApps, accessTemplates, userAppAccess, users } from "@/db/schema";
import { requireHeadAdmin } from "@/lib/permissions";
import { getCatalog } from "@/lib/catalog";
import { AccessManager } from "./AccessManager";

export const metadata = { title: "Access · MCCIA App Hub" };

export default async function Page({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  await requireHeadAdmin();
  const { tab } = await searchParams;
  const [catalog, people, perUser, perApp, templates, templateApps] = await Promise.all([
    getCatalog(),
    // Head admins see every app, so they have nothing to assign.
    db.select({ id: users.id, name: users.name, email: users.email, designation: users.designation, isActive: users.isActive, homeDepartmentId: users.homeDepartmentId })
      .from(users).where(ne(users.role, "head_admin")).orderBy(asc(users.name)),
    db.select({ id: userAppAccess.userId, n: count() }).from(userAppAccess).groupBy(userAppAccess.userId),
    db.select({ id: userAppAccess.appId, n: count() }).from(userAppAccess).groupBy(userAppAccess.appId),
    db.select().from(accessTemplates).orderBy(asc(accessTemplates.name)),
    db.select().from(accessTemplateApps),
  ]);
  const userCount = new Map(perUser.map((r) => [r.id, r.n]));
  const appCount = new Map(perApp.map((r) => [r.id, r.n]));

  return (
    <AccessManager
      initialTab={tab === "apps" || tab === "templates" ? tab : "users"}
      catalog={catalog}
      people={people.map((p) => ({ ...p, appCount: userCount.get(p.id) ?? 0 }))}
      appCounts={Object.fromEntries(appCount)}
      templates={templates.map((t) => ({ id: t.id, name: t.name, appIds: templateApps.filter((x) => x.templateId === t.id).map((x) => x.appId) }))}
    />
  );
}
