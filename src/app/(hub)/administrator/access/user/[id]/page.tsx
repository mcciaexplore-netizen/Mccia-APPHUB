import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { accessTemplateApps, accessTemplates, userAppAccess, users } from "@/db/schema";
import { requireHeadAdmin } from "@/lib/permissions";
import { getCatalog } from "@/lib/catalog";
import { roleLabel } from "@/lib/format";
import { UserAccessEditor } from "./UserAccessEditor";

export const metadata = { title: "User access · MCCIA App Hub" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  await requireHeadAdmin();
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const [user] = await db.select().from(users).where(eq(users.id, id));
  if (!user) notFound();

  const [catalog, granted, templates, templateApps] = await Promise.all([
    getCatalog(),
    db.select({ appId: userAppAccess.appId }).from(userAppAccess).where(eq(userAppAccess.userId, id)),
    db.select().from(accessTemplates).orderBy(accessTemplates.name),
    db.select().from(accessTemplateApps),
  ]);

  return (
    <div className="space-y-6">
      <Link href="/administrator/access" className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-primary"><ArrowLeft size={14} /> All access</Link>
      <div>
        <h2 className="text-2xl">{user.name}</h2>
        <p className="text-sm text-muted">{user.email} · {roleLabel[user.role]}{user.isActive ? "" : " · inactive"}</p>
      </div>
      {user.role === "head_admin" ? (
        <div className="alert">Head admins automatically see every application. Access ticks only apply to users.</div>
      ) : (
        <UserAccessEditor
          userId={user.id}
          catalog={catalog}
          initial={granted.map((g) => g.appId)}
          templates={templates.map((t) => ({ id: t.id, name: t.name, appIds: templateApps.filter((x) => x.templateId === t.id).map((x) => x.appId) }))}
        />
      )}
    </div>
  );
}
