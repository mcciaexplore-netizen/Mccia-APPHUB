import { PageHeader } from "@/components/approvals/PageHeader";
import { ExpenditureForm } from "@/components/approvals/RequestForms";
import { getFormFields } from "@/lib/approvals/form-config";
import { expenditureFormProps } from "@/lib/approvals/form-data";
import { requirePage } from "@/lib/approvals/guard";

export const metadata = { title: "Expenses · MCCIA Approvals" };

/**
 * The one expense form, for any amount. Below the threshold it asks the expense fields and the first approver's decision is final; from the
 * threshold up it asks the ₹10,000+ fields and the first approver recommends it to the Director General.
 */
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requirePage();
  const [props, largeFields] = await Promise.all([expenditureFormProps("small", user, await searchParams), getFormFields("large")]);
  return (
    <>
      <PageHeader title="Expenses" />
      <ExpenditureForm {...props} largeFields={largeFields} />
    </>
  );
}
