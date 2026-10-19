import { notFound } from "next/navigation";
import { FormFieldsEditor } from "@/components/approvals/FormFieldsEditor";
import { approvalsEnabled } from "@/lib/approvals/flags";
import { getAllFormFields } from "@/lib/approvals/form-config";
import { requireHeadAdmin } from "@/lib/permissions";

export const metadata = { title: "HR Form · MCCIA App Hub" };
export const dynamic = "force-dynamic";

/** Where the Support Admin edits the HR form. */
export default async function Page() {
  await requireHeadAdmin();
  if (!approvalsEnabled()) notFound();
  return <FormFieldsEditor initial={await getAllFormFields()} forms={["hr"]} title="HR Form" intro="The form staff fill in to raise an HR request." />;
}
