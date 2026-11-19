import { notFound } from "next/navigation";
import { FormFieldsEditor } from "@/components/approvals/FormFieldsEditor";
import { approvalsEnabled } from "@/lib/approvals/flags";
import { getAllFormFields } from "@/lib/approvals/form-config";
import { requireHeadAdmin } from "@/lib/permissions";

export const metadata = { title: "Budget Form · MCCIA App Hub" };
export const dynamic = "force-dynamic";

/**
 * Where the Support Admin edits the Budget form: rename, move or hide its sections (income, expenses, vendors and the summary can be hidden;
 * the event, the amount and the approver cannot) and add fields of their own. A revision of a budget uses the same layout.
 */
export default async function Page() {
  await requireHeadAdmin();
  if (!approvalsEnabled()) notFound();
  return <FormFieldsEditor initial={await getAllFormFields()} forms={["budget"]} title="Budget Form" intro="The budget approval form for events, with income, expenses and revision tracking." />;
}
