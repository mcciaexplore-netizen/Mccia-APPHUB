import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import { db } from "@/db";
import { apps, departments, userAppAccess, users } from "@/db/schema";
import { Icon } from "@/components/Icon";
import { roleBadge, roleLabel } from "@/lib/format";
import { requireHeadAdmin } from "@/lib/permissions";
import { uuid } from "@/lib/validation";
import { DepartmentApps } from "./DepartmentApps";

export const metadata = { title: "Department · MCCIA App Hub" };

export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  await requireHeadAdmin();
  const { id } = await params;
  const { tab } = await searchParams;
  if (!uuid.safeParse(id).success) notFound();

  const [dept] = await db.select().from(departments).where(eq(departments.id, id));
  if (!dept) notFound();

  const [deptApps, members, grants] = await Promise.all([
    db.select().from(apps).where(eq(apps.departmentId, id)).orderBy(asc(apps.sortOrder), asc(apps.name)),
    db.select().from(users).where(eq(users.homeDepartmentId, id)).orderBy(asc(users.name)),
    // Which of this department's apps each user can open.
    db.select({ userId: userAppAccess.userId, appId: apps.id, name: apps.name })
      .from(userAppAccess).innerJoin(apps, and(eq(apps.id, userAppAccess.appId), eq(apps.departmentId, id))),
  ]);
  const byUser = new Map<string, string[]>();
  for (const g of grants) byUser.set(g.userId, [...(byUser.get(g.userId) ?? []), g.name]);

  const active = tab === "users" ? "users" : "apps";
  const tabs = [
    { key: "apps", label: "Applications", n: deptApps.length },
    { key: "users", label: "Users", n: members.length },
  ] as const;

  return (
    <div className="space-y-6">
      <Link href="/administrator/departments" className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-primary"><ArrowLeft size={14} /> All departments</Link>
      <div className="flex items-center gap-3">
        <span className="icon-tile"><Icon name={dept.icon} size={20} /></span>
        <div>
          <h2 className="text-2xl">{dept.name}</h2>
          {!dept.isActive && <span className="badge badge-red">Inactive</span>}
        </div>
      </div>

      <div className="flex gap-2 border-b border-line pb-3" role="tablist" aria-label="Department sections">
        {tabs.map((t) => (
          <Link key={t.key} href={`/administrator/departments/${id}?tab=${t.key}`} role="tab" aria-selected={active === t.key}
            className={`rounded-md px-4 py-2 text-sm font-medium transition-all duration-200 ${active === t.key ? "bg-blue-tint text-primary" : "text-muted hover:bg-blue-tint hover:text-primary"}`}>
            {t.label} <span className="badge badge-neutral ml-1">{t.n}</span>
          </Link>
        ))}
      </div>

      {active === "apps" ? (
        <DepartmentApps
          department={{ id: dept.id, name: dept.name }}
          apps={deptApps.map((a) => ({ id: a.id, name: a.name, description: a.description, url: a.url, icon: a.icon, appToken: a.appToken, isActive: a.isActive }))}
        />
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-muted">People whose home department is {dept.name}. A user’s department comes from the <code>department</code> column of the CSV import.</p>
          <div className="table-wrap">
            <table>
              <thead><tr><th>User</th><th>Role</th><th>Applications in {dept.name}</th><th className="text-right">Access</th></tr></thead>
              <tbody>
                {members.map((u) => {
                  const list = byUser.get(u.id) ?? [];
                  return (
                    <tr key={u.id} className={u.isActive ? "" : "opacity-60"}>
                      <td><b>{u.name}</b>{u.designation && <span className="text-xs text-muted"> · {u.designation}</span>}<span className="block text-xs text-muted">{u.email}</span></td>
                      <td><span className={roleBadge[u.role]}>{roleLabel[u.role]}</span></td>
                      <td>
                        {u.role === "head_admin" ? <span className="text-xs text-muted">All applications</span>
                          : list.length ? <span className="flex flex-wrap gap-1.5">{list.map((n) => <span key={n} className="badge">{n}</span>)}</span>
                          : <span className="text-subtle">None</span>}
                      </td>
                      <td>
                        <div className="flex justify-end gap-1.5">
                          {u.role !== "head_admin" && (
                            <Link className="chip !p-1.5 text-muted" aria-label={`Manage access for ${u.name}`} title="Manage access" href={`/administrator/access/user/${u.id}`}><ShieldCheck size={14} /></Link>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {members.length === 0 && <tr><td colSpan={4} className="text-subtle">No users belong to {dept.name} yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
