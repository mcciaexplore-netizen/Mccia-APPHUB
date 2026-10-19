import { notFound } from "next/navigation";
import { FormFieldsEditor } from "@/components/approvals/FormFieldsEditor";
import { approvalsEnabled } from "@/lib/approvals/flags";
import { getAllFormFields } from "@/lib/approvals/form-config";
import { requireHeadAdmin } from "@/lib/permissions";

export const metadata = { title: "Expenditure Form · MCCIA App Hub" };
export const dynamic = "force-dynamic";

/** Where the Support Admin edits the one expense form: the fields asked below ₹10,000, and those asked from ₹10,000 up. */
export default async function Page() {
  await requireHeadAdmin();
  if (!approvalsEnabled()) notFound();
  return <FormFieldsEditor initial={await getAllFormFields()} forms={["small", "large"]} title="Expenditure Form" intro="The one expense form switches by amount: below ₹10,000 it asks the first set of fields, from ₹10,000 the second. Edit each on its tab." />;
}
