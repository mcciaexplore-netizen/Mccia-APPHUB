import { PageHeader } from "@/components/approvals/PageHeader";
import { HrForm } from "@/components/approvals/RequestForms";
import { hrFormProps } from "@/lib/approvals/form-data";
import { requireApp } from "@/lib/approvals/guard";

export const metadata = { title: "HR · MCCIA Approvals" };

export default async function Page() {
  const user = await requireApp("hr");
  return (
    <>
      <PageHeader title="HR" />
      <HrForm {...await hrFormProps(user)} />
    </>
  );
}
