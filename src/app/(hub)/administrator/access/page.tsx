import { asc, count } from "drizzle-orm";
import { db } from "@/db";
import { accessTemplateApps, accessTemplates, userAppAccess } from "@/db/schema";
import { requireArea } from "@/lib/permissions";
import { getCatalog } from "@/lib/catalog";
import { AccessManager } from "./AccessManager";

export const metadata = { title: "Access by application · MCCIA App Hub" };

/** Access by application, and access templates. Changing a person's access (one person or many) is done in Users & Access. */
export default async function Page({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  await requireArea("people");
  const { tab } = await searchParams;
  const [catalog, perApp, templates, templateApps] = await Promise.all([
    getCatalog(),
    db.select({ id: userAppAccess.appId, n: count() }).from(userAppAccess).groupBy(userAppAccess.appId),
    db.select().from(accessTemplates).orderBy(asc(accessTemplates.name)),
    db.select().from(accessTemplateApps),
  ]);
  const appCount = new Map(perApp.map((r) => [r.id, r.n]));

  return (
    <AccessManager
      initialTab={tab === "templates" ? "templates" : "apps"}
      catalog={catalog}
      appCounts={Object.fromEntries(appCount)}
      templates={templates.map((t) => ({ id: t.id, name: t.name, appIds: templateApps.filter((x) => x.templateId === t.id).map((x) => x.appId) }))}
    />
  );
}
