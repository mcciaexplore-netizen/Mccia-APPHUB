import { AccessManager } from "@/components/approvals/AccessManager";
import { PageHeader } from "@/components/approvals/PageHeader";
import { requirePage } from "@/lib/approvals/guard";
import { listRoleAssignments } from "@/lib/approvals/roles";

export const metadata = { title: "Roles and Access · MCCIA Approvals" };

export default async function Page() {
  await requirePage("approvals_admin");
  return (
    <>
      <PageHeader
        title="Roles and Access"
        intro="Who can open Approvals is decided in the App Hub (Administrator > Access). Here you choose who also oversees requests or manages this module. Approvers and the DG are set on the Approver Rules screen."
      />
      <AccessManager rows={await listRoleAssignments()} />
    </>
  );
}
