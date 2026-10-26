import { PageHeader } from "@/components/approvals/PageHeader";
import { ExpenditureForm } from "@/components/approvals/RequestForms";
import { expenditureFormProps } from "@/lib/approvals/form-data";
import { requirePage } from "@/lib/approvals/guard";

export const metadata = { title: "Expenses · MCCIA Approvals" };

/**
 * The one expense form, for any amount, with the same fields. Below the threshold the first approver's decision is final; from the threshold
 * up the first approver recommends it to the Director General.
 */
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requirePage();
  const props = await expenditureFormProps("small", user, await searchParams);
  return (
    <>
      <PageHeader title="Expenses" />
      <ExpenditureForm {...props} byAmount />
    </>
  );
}
