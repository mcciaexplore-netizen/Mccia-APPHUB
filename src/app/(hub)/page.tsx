export const dynamic = "force-dynamic";

import { requireUser } from "@/lib/permissions";
import { getAccessibleApps, getVisibleDepartments } from "@/lib/access";
import { isSuper } from "@/lib/rbac";
import { ApprovalFormCards } from "@/components/ApprovalFormCards";
import { approvalsEnabled } from "@/lib/approvals/flags";
import { HomeClient } from "./HomeClient";

export default async function HomePage() {
  const user = await requireUser();
  const [departments, apps] = await Promise.all([getVisibleDepartments(user), getAccessibleApps(user)]);
  // Only ids, names, descriptions and icons are sent. App URLs never leave the server except through /go.
  return (
    <>
      {approvalsEnabled() && <ApprovalFormCards />}
      <HomeClient departments={departments.map((d) => ({ id: d.id, name: d.name }))} apps={apps} isAdmin={isSuper(user)} />
    </>
  );
}
