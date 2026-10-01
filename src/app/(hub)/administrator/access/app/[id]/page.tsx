import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { and, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { apps, departments, userAppAccess, users } from "@/db/schema";
import { requireHeadAdmin } from "@/lib/permissions";
import { AppAccessEditor } from "./AppAccessEditor";

export const metadata = { title: "App access · MCCIA App Hub" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  await requireHeadAdmin();
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const [app] = await db
    .select({ id: apps.id, name: apps.name, department: departments.name })
    .from(apps).innerJoin(departments, eq(departments.id, apps.departmentId)).where(eq(apps.id, id));
  if (!app) notFound();

  const [people, granted] = await Promise.all([
    // Head admins already see every app, so they are not listed.
    db.select({ id: users.id, name: users.name, email: users.email, designation: users.designation, isActive: users.isActive })
      .from(users).where(and(ne(users.role, "head_admin"))).orderBy(users.name),
    db.select({ userId: userAppAccess.userId }).from(userAppAccess).where(eq(userAppAccess.appId, id)),
  ]);

  return (
    <div className="space-y-6">
      <Link href="/administrator/access?tab=apps" className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-primary"><ArrowLeft size={14} /> All access</Link>
      <div>
        <h2 className="text-2xl">{app.name}</h2>
        <p className="text-sm text-muted">{app.department}</p>
      </div>
      <AppAccessEditor appId={app.id} people={people} initial={granted.map((g) => g.userId)} />
    </div>
  );
}
