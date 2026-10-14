import { PageHeader } from "@/components/approvals/PageHeader";
import { HrForm } from "@/components/approvals/RequestForms";
import { hrFormProps } from "@/lib/approvals/form-data";
import { requirePage } from "@/lib/approvals/guard";

export const metadata = { title: "HR · MCCIA Approvals" };

export default async function Page() {
  const user = await requirePage();
  return (
    <>
      <PageHeader title="HR" />
      <HrForm {...await hrFormProps(user)} />
    </>
  );
}
