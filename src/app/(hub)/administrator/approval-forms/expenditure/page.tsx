import { notFound } from "next/navigation";
import { FormFieldsEditor } from "@/components/approvals/FormFieldsEditor";
import { approvalsEnabled } from "@/lib/approvals/flags";
import { getAllFormFields } from "@/lib/approvals/form-config";
import { requireHeadAdmin } from "@/lib/permissions";

export const metadata = { title: "Expenditure Form · MCCIA App Hub" };
export const dynamic = "force-dynamic";

/** Where the Support Admin edits the one expense form: the same fields for every amount (only the approvers change from ₹10,000 up). */
export default async function Page() {
  await requireHeadAdmin();
  if (!approvalsEnabled()) notFound();
  return <FormFieldsEditor initial={await getAllFormFields()} forms={["small"]} title="Expenditure Form" intro="The one expense form, with the same fields for every amount. From ₹10,000 it also goes to the Super Admin for the final decision." />;
}
