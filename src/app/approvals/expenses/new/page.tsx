import { PageHeader } from "@/components/approvals/PageHeader";
import { ExpenditureForm } from "@/components/approvals/RequestForms";
import { expenditureFormProps } from "@/lib/approvals/form-data";
import { requirePage } from "@/lib/approvals/guard";

export const metadata = { title: "Expenses · MCCIA Approvals" };

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requirePage();
  return (
    <>
      <PageHeader title="Expenses" />
      <ExpenditureForm {...await expenditureFormProps("small", user, await searchParams)} />
    </>
  );
}
