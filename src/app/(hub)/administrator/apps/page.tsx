import { asc } from "drizzle-orm";
import { db } from "@/db";
import { apps, departments } from "@/db/schema";
import { requireHeadAdmin } from "@/lib/permissions";
import { AppsManager } from "./AppsManager";

export const metadata = { title: "Apps & departments · MCCIA App Hub" };

export default async function Page() {
  await requireHeadAdmin();
  const [deps, list] = await Promise.all([
    db.select().from(departments).orderBy(asc(departments.sortOrder), asc(departments.name)),
    db.select().from(apps).orderBy(asc(apps.sortOrder), asc(apps.name)),
  ]);
  return <AppsManager departments={deps} apps={list} />;
}
