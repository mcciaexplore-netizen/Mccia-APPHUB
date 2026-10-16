import { PageHeader } from "@/components/approvals/PageHeader";
import { ExpenditureForm } from "@/components/approvals/RequestForms";
import { expenditureFormProps } from "@/lib/approvals/form-data";
import { requireApp } from "@/lib/approvals/guard";

export const metadata = { title: "Expenditure · MCCIA Approvals" };

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireApp("hr");
  return (
    <>
      <PageHeader title="Expenditure" />
      <ExpenditureForm {...await expenditureFormProps("large", user, await searchParams)} />
    </>
  );
}
