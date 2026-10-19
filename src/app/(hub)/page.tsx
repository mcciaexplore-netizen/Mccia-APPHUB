export const dynamic = "force-dynamic";

import { requireUser } from "@/lib/permissions";
import { getAccessibleApps, getVisibleDepartments } from "@/lib/access";
import { isSuper } from "@/lib/rbac";
import { HomeClient } from "./HomeClient";

export default async function HomePage() {
  const user = await requireUser();
  const [departments, apps] = await Promise.all([getVisibleDepartments(user), getAccessibleApps(user)]);
  // Only ids, names, descriptions and icons are sent. App URLs never leave the server except through /go.
  return <div className="page-enter"><HomeClient departments={departments.map((d) => ({ id: d.id, name: d.name }))} apps={apps} isAdmin={isSuper(user)} /></div>;
}
