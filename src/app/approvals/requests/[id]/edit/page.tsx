import { notFound } from "next/navigation";
import { PageHeader } from "@/components/approvals/PageHeader";
import { ExpenditureForm, HrForm } from "@/components/approvals/RequestForms";
import { expenditureEditProps, hrFormProps } from "@/lib/approvals/form-data";
import { requirePage } from "@/lib/approvals/guard";
import { getEditValues } from "@/lib/approvals/request-queries";
import { idSchema } from "@/lib/approvals/validation";

export const metadata = { title: "Correct request · MCCIA Approvals" };

/** The correction form for a request that was returned. Only the person who raised it can open it, and only while it is returned. */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePage();
  const { id } = await params;
  if (!idSchema.safeParse(id).success) notFound();
  const values = await getEditValues(id, user);
  if (!values) notFound();
  return (
    <>
      <PageHeader title={`Correct ${values.requestNo ?? "request"}`} intro="Change what the approver asked for and resubmit it." />
      {values.type === "hr" ? <HrForm {...await hrFormProps(user, { requestId: id, values })} /> : <ExpenditureForm {...await expenditureEditProps(user, id, values)} />}
    </>
  );
}
