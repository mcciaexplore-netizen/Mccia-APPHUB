import { notFound } from "next/navigation";
import { FormFieldsEditor } from "@/components/approvals/FormFieldsEditor";
import { approvalsEnabled } from "@/lib/approvals/flags";
import { getAllFormFields } from "@/lib/approvals/form-config";
import { requireHeadAdmin } from "@/lib/permissions";

export const metadata = { title: "Approval Forms · MCCIA App Hub" };
export const dynamic = "force-dynamic";

/** Where the Support Admin edits the forms everyone uses to raise a request. */
export default async function Page() {
  await requireHeadAdmin();
  if (!approvalsEnabled()) notFound();
  return <FormFieldsEditor initial={await getAllFormFields()} />;
}
