import { requireUser } from "@/lib/permissions";
import { getVisibleDepartments } from "@/lib/access";
import { HubShell } from "@/components/HubShell";
import { APPROVALS_ENTRY, directApprovalsDepartments } from "@/lib/approvals/hub-link";

export const dynamic = "force-dynamic";

export default async function HubLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const [visible, direct] = await Promise.all([getVisibleDepartments(user), directApprovalsDepartments(user)]);
  // A department that is only the Approvals module opens it straight away (see hub-link.ts).
  const departments = visible.map((d) => ({ ...d, href: direct.has(d.id) ? APPROVALS_ENTRY : undefined }));

  return (
    <HubShell user={{ name: user.name, role: user.role }} departments={departments}>
      {children}
    </HubShell>
  );
}
