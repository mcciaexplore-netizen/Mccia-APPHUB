import { asc, count, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { appChecks, apps, departments, userAppAccess } from "@/db/schema";
import { isApprovalsUrl } from "@/lib/approvals/approvals.manifest";
import { requireArea } from "@/lib/permissions";
import { InventoryView } from "./InventoryView";

export const metadata = { title: "Applications · MCCIA App Hub" };
// "Check all" visits each external address, a few at a time.
export const maxDuration = 60;

export default async function Page() {
  await requireArea("apps");
  const [list, latest, access, deps] = await Promise.all([
    db.select({
      id: apps.id, name: apps.name, description: apps.description, url: apps.url, icon: apps.icon, status: apps.status, isActive: apps.isActive,
      department: departments.name, departmentActive: departments.isActive,
    }).from(apps).innerJoin(departments, eq(departments.id, apps.departmentId)).orderBy(asc(departments.sortOrder), asc(apps.sortOrder), asc(apps.name)),
    db.selectDistinctOn([appChecks.appId], { appId: appChecks.appId, ok: appChecks.ok, detail: appChecks.detail, httpStatus: appChecks.httpStatus, durationMs: appChecks.durationMs, checkedAt: appChecks.checkedAt })
      .from(appChecks).orderBy(appChecks.appId, desc(appChecks.checkedAt)),
    db.select({ appId: userAppAccess.appId, n: count() }).from(userAppAccess).groupBy(userAppAccess.appId),
    db.select({ id: departments.id, name: departments.name }).from(departments).where(eq(departments.kind, "application")).orderBy(asc(departments.sortOrder), asc(departments.name)),
  ]);
  const check = new Map(latest.map((c) => [c.appId, c]));
  const people = new Map(access.map((a) => [a.appId, a.n]));
  return (
    <InventoryView
      departments={deps}
      rows={list.filter((a) => !isApprovalsUrl(a.url)).map((a) => {
        const c = check.get(a.id);
        return {
          id: a.id, name: a.name, description: a.description, url: a.url, department: a.department, status: a.status, visible: a.isActive && a.departmentActive,
          builtIn: a.url.startsWith("/"), people: people.get(a.id) ?? 0,
          check: c ? { ok: c.ok, detail: c.detail, httpStatus: c.httpStatus, durationMs: c.durationMs, at: c.checkedAt.toISOString() } : null,
        };
      })}
    />
  );
}
