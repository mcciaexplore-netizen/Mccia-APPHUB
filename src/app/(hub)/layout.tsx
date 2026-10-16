import { requireUser } from "@/lib/permissions";
import { getVisibleDepartments } from "@/lib/access";
import { HubShell } from "@/components/HubShell";
import { approvalsEnabled } from "@/lib/approvals/flags";

export const dynamic = "force-dynamic";

export default async function HubLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const departments = await getVisibleDepartments(user);

  return (
    <HubShell user={{ name: user.name, role: user.role, adminAreas: user.adminAreas }} departments={departments} showApprovals={approvalsEnabled()}>
      {children}
    </HubShell>
  );
}
