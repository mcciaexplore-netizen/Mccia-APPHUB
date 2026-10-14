export const dynamic = "force-dynamic";

import { requireUser } from "@/lib/permissions";
import { getAccessibleApps, getVisibleDepartments } from "@/lib/access";
import { HomeClient } from "./HomeClient";

export default async function HomePage() {
  const user = await requireUser();
  const [departments, apps] = await Promise.all([getVisibleDepartments(user), getAccessibleApps(user)]);
  // Only ids, names, descriptions and icons are sent. App URLs never leave the server except through /go.
  return <HomeClient departments={departments.map((d) => ({ id: d.id, name: d.name }))} apps={apps} isAdmin={user.role === "head_admin"} />;
}
